#!/usr/bin/env node
/**
 * Install this repository's skills into the user's home directory so they are
 * available to Claude Code and GitHub Copilot in every project.
 *
 *   node scripts/install.mjs --dry-run    print the plan, write nothing
 *   node scripts/install.mjs              copy skills into both targets
 *
 * This runs on other people's machines, so it copies data files only, never
 * executes repository content, and refuses to write outside the two target
 * roots. See docs/security.md.
 */
import { readdir, mkdir, copyFile, rm, symlink, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { SKILLS_DIR, AGENTS_DIR, HOOKS_DIR, rel } from './lib/paths.mjs';
import {
  resolveWithin,
  isSafeSkillName,
  collectSkillFiles,
  exists,
} from './lib/install-plan.mjs';

const HOME = homedir();
const TARGETS = {
  claude: path.join(HOME, '.claude'),
  copilot: path.join(HOME, '.copilot'),
};

const USAGE = `
Usage: node scripts/install.mjs [options]

  --dry-run        Print exactly what would be written, change nothing
  --link           Symlink instead of copy (needs Developer Mode on Windows)
  --force          Overwrite skills that are already installed
  --no-agents      Skip subagents (they go to ~/.claude/agents, Claude Code only)
  --with-hooks     Also install .claude/hooks/ — these EXECUTE on your machine
  --claude-only    Install to ~/.claude only
  --copilot-only   Install to ~/.copilot only
  -h, --help       Show this message
`.trim();

function parseArgs(argv) {
  const known = new Set([
    '--dry-run', '--link', '--force', '--with-hooks', '--no-agents',
    '--claude-only', '--copilot-only', '-h', '--help',
  ]);

  for (const arg of argv) {
    if (!known.has(arg)) {
      console.error(`unknown option: ${arg}\n\n${USAGE}`);
      process.exit(2);
    }
  }

  const has = (flag) => argv.includes(flag);
  if (has('-h') || has('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  if (has('--claude-only') && has('--copilot-only')) {
    console.error('--claude-only and --copilot-only are mutually exclusive');
    process.exit(2);
  }

  const targets = [];
  if (!has('--copilot-only')) targets.push(TARGETS.claude);
  if (!has('--claude-only')) targets.push(TARGETS.copilot);

  return {
    dryRun: has('--dry-run'),
    link: has('--link'),
    force: has('--force'),
    withHooks: has('--with-hooks'),
    // Copilot reads subagents from .github/agents/ in a repository only — it
    // has no user-scope agents directory — so these go to ~/.claude/ alone.
    agents: !has('--no-agents') && targets.includes(TARGETS.claude),
    targets,
  };
}

async function listSkills() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (!isSafeSkillName(entry.name)) {
      console.error(`skipping unsafe skill directory name: ${entry.name}`);
      continue;
    }
    const dir = path.join(SKILLS_DIR, entry.name);
    const { files, skipped } = await collectSkillFiles(dir);

    if (!files.includes('SKILL.md')) {
      console.error(`skipping ${entry.name}: no SKILL.md`);
      continue;
    }
    skills.push({ name: entry.name, dir, files, skipped });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Subagent definitions. The `done` skill spawns `docs-auditor` and
 * `test-auditor` by name, so installing skills without these leaves the skill
 * silently falling back to its inline path.
 */
async function listAgents() {
  const entries = await readdir(AGENTS_DIR, { withFileTypes: true });

  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => e.name)
    .sort();
}

/** Build every write this run would perform, with each target verified in-bounds. */
async function buildPlan(skills, options) {
  const actions = [];

  for (const target of options.targets) {
    const skillsRoot = path.join(target, 'skills');

    for (const skill of skills) {
      // Guard first: this is what stops a crafted name escaping the target root.
      const destination = resolveWithin(skillsRoot, skill.name);
      const already = await exists(destination);

      if (already && !options.force) {
        actions.push({ kind: 'skip', destination, reason: 'already installed' });
        continue;
      }

      if (options.link) {
        actions.push({ kind: 'link', source: skill.dir, destination, replace: already });
        continue;
      }

      for (const file of skill.files) {
        actions.push({
          kind: 'copy',
          source: path.join(skill.dir, file),
          destination: resolveWithin(destination, file),
          replace: already,
        });
      }
    }
  }

  return actions;
}

async function collectHookFiles() {
  const { files } = await collectSkillFiles(HOOKS_DIR);
  return files.filter((file) => file !== 'README.md');
}

async function warnAboutHooks(options) {
  const files = await collectHookFiles();

  if (files.length === 0) {
    console.log('\nhooks: nothing to install (.claude/hooks/ contains no hook files)');
    return [];
  }

  console.log(
    '\n' +
      'WARNING: hooks are shell that your agent runtime executes automatically.\n' +
      'You are about to install the following onto this machine:\n',
  );
  for (const file of files) console.log(`  ${file}`);
  console.log('\nRead .claude/hooks/ before trusting this. See docs/security.md.\n');

  const actions = [];
  for (const target of options.targets.filter((t) => t === TARGETS.claude)) {
    const hooksRoot = path.join(target, 'hooks');
    for (const file of files) {
      actions.push({
        kind: 'copy',
        source: path.join(HOOKS_DIR, file),
        destination: resolveWithin(hooksRoot, file),
        replace: true,
      });
    }
  }
  return actions;
}

async function apply(actions, options) {
  let written = 0;

  for (const action of actions) {
    if (action.kind === 'skip') continue;

    if (options.dryRun) {
      written += 1;
      continue;
    }

    await mkdir(path.dirname(action.destination), { recursive: true });

    if (action.kind === 'link') {
      if (action.replace) await rm(action.destination, { recursive: true, force: true });
      await symlink(action.source, action.destination, 'dir');
    } else {
      await copyFile(action.source, action.destination);
    }
    written += 1;
  }

  return written;
}

/** Render a path with the home directory abbreviated, so output is portable. */
function display(target) {
  return target.startsWith(HOME) ? `~${target.slice(HOME.length)}` : target;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const skills = await listSkills();

  if (skills.length === 0) {
    console.error('no installable skills found in .claude/skills/');
    process.exitCode = 1;
    return;
  }

  console.log(
    `${options.dryRun ? 'DRY RUN — nothing will be written\n\n' : ''}` +
      `Installing ${skills.length} skill(s) from ${rel(SKILLS_DIR)}:`,
  );
  for (const skill of skills) {
    console.log(`  ${skill.name} (${skill.files.length} file(s))`);
    for (const item of skill.skipped) console.log(`    skipped ${item}`);
  }
  console.log(`\nTargets: ${options.targets.map(display).join(', ')}\n`);

  const actions = await buildPlan(skills, options);

  if (options.agents) {
    const agentsRoot = path.join(TARGETS.claude, 'agents');
    for (const fileName of await listAgents()) {
      actions.push({
        kind: 'copy',
        source: path.join(AGENTS_DIR, fileName),
        destination: resolveWithin(agentsRoot, fileName),
        replace: true,
      });
    }
  }

  if (options.withHooks) actions.push(...(await warnAboutHooks(options)));

  for (const action of actions) {
    const verb = action.kind === 'skip'
      ? `skip     ${display(action.destination)} — ${action.reason}`
      : `${action.kind === 'link' ? 'link' : 'copy'}     ${display(action.destination)}`;
    console.log(`  ${verb}`);
  }

  const skipped = actions.filter((a) => a.kind === 'skip').length;
  const written = await apply(actions, options);

  console.log(
    `\n${options.dryRun ? 'Would write' : 'Wrote'} ${written} file(s)` +
      `${skipped > 0 ? `, skipped ${skipped} existing skill(s) — use --force to overwrite` : ''}.`,
  );

  if (options.dryRun) {
    console.log('\nRe-run without --dry-run to apply.');
  } else if (!options.withHooks) {
    console.log('\nHooks were not installed. Pass --with-hooks to include them.');
  }
}

await main();
