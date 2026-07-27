#!/usr/bin/env node
/**
 * Generate the Copilot-facing `.github/` tree from the canonical `.claude/`
 * tree plus AGENTS.md.
 *
 *   node scripts/sync.mjs           write the generated files
 *   node scripts/sync.mjs --check   verify they are current; exit 1 on drift
 *
 * `--check` never writes. CI runs `--check` only, so a stale tree fails the
 * build rather than being silently fixed by a bot commit. See docs/portability.md.
 */
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontmatter, stringifyFrontmatter } from './lib/frontmatter.mjs';
import {
  SKILLS_DIR,
  AGENTS_DIR,
  AGENTS_MD,
  GH_PROMPTS_DIR,
  GH_AGENTS_DIR,
  GH_INSTRUCTIONS,
  GENERATED_MARKER,
  generatedHeader,
  rel,
} from './lib/paths.mjs';

/** Read a directory, treating "does not exist" as empty. */
async function listDir(dir, options = {}) {
  try {
    return await readdir(dir, options);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Read a file, returning null if absent. */
async function readIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Rewrite repo-root-relative markdown links so they still resolve one
 * directory deeper. AGENTS.md links to `docs/portability.md`; the copy at
 * `.github/copilot-instructions.md` needs `../docs/portability.md`.
 */
function reparentLinks(markdown) {
  return markdown.replace(
    /\]\((?!https?:|mailto:|#|\/|\.\.?\/)([^)\s]+)/g,
    '](../$1',
  );
}

/** Collect every skill: { name, dir, data }. */
async function loadSkills() {
  const entries = await listDir(SKILLS_DIR, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    const source = await readIfExists(file);
    if (source === null) continue;

    const { data } = parseFrontmatter(source);
    skills.push({ name: entry.name, file, data });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Collect every subagent: { name, file, data }. */
async function loadAgents() {
  const entries = await listDir(AGENTS_DIR, { withFileTypes: true });
  const agents = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name === 'README.md') continue;

    const file = path.join(AGENTS_DIR, entry.name);
    const { data } = parseFrontmatter(await readFile(file, 'utf8'));
    agents.push({ name: entry.name.replace(/\.md$/, ''), file, data });
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the full generated tree as a Map of absolute path -> content.
 *
 * Stubs deliberately carry no substance beyond `name`/`description` — they
 * point at the canonical file rather than copying it, so the two cannot
 * semantically diverge. Only staleness is possible, and `--check` catches that.
 */
async function buildOutputs() {
  const outputs = new Map();

  for (const skill of await loadSkills()) {
    const source = rel(skill.file);
    const frontmatter = stringifyFrontmatter({
      description: skill.data.description ?? '',
      agent: 'agent',
    });

    outputs.set(
      path.join(GH_PROMPTS_DIR, `${skill.name}.prompt.md`),
      `${generatedHeader(source)}${frontmatter}\n` +
        `Read \`${source}\` and follow it exactly.\n\n` +
        `That file is the canonical definition of this workflow. This prompt ` +
        `exists only so the skill is reachable as \`/${skill.name}\` in ` +
        `Copilot for VS Code, which does not load skills as slash commands.\n`,
    );
  }

  for (const agent of await loadAgents()) {
    const source = rel(agent.file);
    // Only name/description carry over: Claude Code uses `tools`/`model`,
    // Copilot uses `prompt`/`tools`/`mcp-servers`. The schemas do not map.
    const frontmatter = stringifyFrontmatter({
      name: agent.data.name ?? agent.name,
      description: agent.data.description ?? '',
    });

    outputs.set(
      path.join(GH_AGENTS_DIR, `${agent.name}.md`),
      `${generatedHeader(source)}${frontmatter}\n` +
        `Read \`${source}\` and follow it exactly. That file is the canonical ` +
        `definition of this agent.\n`,
    );
  }

  // Full copy, not a pointer: Copilot in VS Code reads this file directly and
  // will not follow a reference out of it.
  const agentsMd = await readIfExists(AGENTS_MD);
  if (agentsMd !== null) {
    outputs.set(
      GH_INSTRUCTIONS,
      `${generatedHeader('AGENTS.md')}\n${reparentLinks(agentsMd)}`,
    );
  }

  return outputs;
}

/**
 * Generated files that no longer have a source — e.g. a deleted skill.
 * Identified by the generated marker, so a hand-written file in these
 * directories is never deleted.
 */
async function findOrphans(outputs) {
  const orphans = [];

  for (const dir of [GH_PROMPTS_DIR, GH_AGENTS_DIR]) {
    for (const entry of await listDir(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(dir, entry.name);
      if (outputs.has(file)) continue;

      const existing = await readIfExists(file);
      if (existing?.includes(GENERATED_MARKER)) orphans.push(file);
    }
  }

  return orphans;
}

async function main() {
  const check = process.argv.includes('--check');
  const outputs = await buildOutputs();
  const orphans = await findOrphans(outputs);
  const drift = [];

  for (const [file, content] of outputs) {
    const existing = await readIfExists(file);
    if (existing === content) continue;
    drift.push({ file, reason: existing === null ? 'missing' : 'stale' });

    if (!check) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
    }
  }

  for (const file of orphans) {
    drift.push({ file, reason: 'orphaned' });
    if (!check) await rm(file);
  }

  if (check) {
    if (drift.length === 0) {
      console.log(`sync: up to date (${outputs.size} generated files)`);
      return;
    }
    console.error('sync: generated files are out of date\n');
    for (const { file, reason } of drift) {
      console.error(`  ${reason.padEnd(9)} ${rel(file)}`);
    }
    console.error('\nRun `npm run sync` and commit the result.');
    process.exitCode = 1;
    return;
  }

  if (drift.length === 0) {
    console.log(`sync: already up to date (${outputs.size} generated files)`);
    return;
  }
  for (const { file, reason } of drift) {
    console.log(`  ${reason === 'orphaned' ? 'removed' : 'wrote'.padEnd(7)} ${rel(file)}`);
  }
  console.log(`sync: ${drift.length} file(s) updated`);
}

await main();
