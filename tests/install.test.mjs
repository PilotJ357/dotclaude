import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  resolveWithin,
  isSafeSkillName,
  collectSkillFiles,
  ALLOWED_EXTENSIONS,
} from '../scripts/lib/install-plan.mjs';
import { REPO_ROOT } from '../scripts/lib/paths.mjs';

/**
 * The installer writes into the user's home directory, so its guards get
 * direct tests rather than being trusted by inspection. Fixtures live in a
 * temp directory; the real repository tree is never mutated.
 */

describe('resolveWithin', () => {
  const root = path.resolve('/tmp/root');

  test('accepts a plain child path', () => {
    assert.equal(resolveWithin(root, 'skill'), path.join(root, 'skill'));
  });

  test('accepts a nested child path', () => {
    assert.equal(
      resolveWithin(root, 'skill/references/notes.md'),
      path.join(root, 'skill', 'references', 'notes.md'),
    );
  });

  test('rejects parent traversal', () => {
    assert.throws(() => resolveWithin(root, '../escaped'), /refusing to write outside/);
  });

  test('rejects deep parent traversal', () => {
    assert.throws(
      () => resolveWithin(root, 'a/../../../../etc/passwd'),
      /refusing to write outside/,
    );
  });

  test('rejects an absolute path', () => {
    assert.throws(() => resolveWithin(root, '/etc/passwd'), /refusing to write outside/);
  });

  test('rejects the root itself', () => {
    assert.throws(() => resolveWithin(root, '.'), /refusing to write outside/);
  });
});

describe('isSafeSkillName', () => {
  test('accepts kebab-case names', () => {
    assert.ok(isSafeSkillName('done'));
    assert.ok(isSafeSkillName('my-long-skill-name'));
    assert.ok(isSafeSkillName('skill2'));
  });

  test('rejects traversal and separators', () => {
    for (const name of ['..', '../x', 'a/b', 'a\\b', '/abs']) {
      assert.equal(isSafeSkillName(name), false, `should reject "${name}"`);
    }
  });

  test('rejects non-kebab-case', () => {
    for (const name of ['Done', 'my_skill', '-lead', 'trail-', 'a--b', '']) {
      assert.equal(isSafeSkillName(name), false, `should reject "${name}"`);
    }
  });

  test('rejects names over 64 characters', () => {
    assert.equal(isSafeSkillName('a'.repeat(65)), false);
    assert.ok(isSafeSkillName('a'.repeat(64)));
  });
});

describe('installer covers what the done skill depends on', () => {
  test('every subagent the done skill names is installable', async () => {
    // The skill spawns these by name. Installing skills without them leaves it
    // silently falling back to the inline path on a globally installed setup.
    const skill = await readFile(
      path.join(REPO_ROOT, '.claude/skills/done/SKILL.md'),
      'utf8',
    );
    const named = [...skill.matchAll(/`([a-z]+-auditor)`/g)].map((m) => m[1]);
    assert.ok(named.length > 0, 'expected the done skill to name subagents');

    const installed = (await readdir(path.join(REPO_ROOT, '.claude/agents')))
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => f.replace(/\.md$/, ''));

    for (const agent of new Set(named)) {
      assert.ok(
        installed.includes(agent),
        `done names "${agent}" but .claude/agents/${agent}.md does not exist`,
      );
    }
  });
});

describe('installer output plan', () => {
  /** Run the installer in dry-run and return the printed plan. */
  async function plan(...flags) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['scripts/install.mjs', '--dry-run', ...flags],
      { cwd: REPO_ROOT },
    );
    return stdout;
  }

  test('installs agents to both runtimes by default', async () => {
    const out = await plan();
    // Both have a user-scope agents directory; Copilot CLI's agent-creation
    // docs specify the .agent.md extension for it.
    assert.match(out, /~\/\.claude\/agents\/docs-auditor\.md/);
    assert.match(out, /~\/\.copilot\/agents\/docs-auditor\.agent\.md/);
  });

  test('--no-agents skips them', async () => {
    assert.doesNotMatch(await plan('--no-agents'), /agents\//);
  });

  test('target restrictions apply to agents', async () => {
    const claude = await plan('--claude-only');
    assert.match(claude, /~\/\.claude\/agents\//);
    assert.doesNotMatch(claude, /~\/\.copilot\//);

    const copilot = await plan('--copilot-only');
    assert.match(copilot, /~\/\.copilot\/agents\//);
    assert.doesNotMatch(copilot, /~\/\.claude\//);
  });

  test('plan leaks no absolute home path', async () => {
    const out = await plan();
    assert.doesNotMatch(out, /\/Users\/|\/home\//);
  });

  test('--uninstall plans removals in both runtimes', async () => {
    const out = await plan('--uninstall');
    // Verb varies with what the host has installed; the targets must not.
    assert.match(out, /~\/\.claude\/skills\/done/);
    assert.match(out, /~\/\.copilot\/skills\/done/);
    assert.match(out, /~\/\.claude\/agents\/docs-auditor\.md/);
    assert.match(out, /~\/\.copilot\/agents\/docs-auditor\.agent\.md/);
  });

  test('--uninstall respects --no-agents and target restrictions', async () => {
    const noAgents = await plan('--uninstall', '--no-agents');
    assert.doesNotMatch(noAgents, /agents\//);

    const claude = await plan('--uninstall', '--claude-only');
    assert.match(claude, /~\/\.claude\/skills\//);
    assert.doesNotMatch(claude, /\.copilot\//);
  });

  test('--uninstall rejects --force and --link', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');

    for (const flag of ['--force', '--link']) {
      await assert.rejects(
        promisify(execFile)(
          process.execPath,
          ['scripts/install.mjs', '--uninstall', flag],
          { cwd: REPO_ROOT },
        ),
        /does not combine/,
      );
    }
  });
});

describe('agent instructions stay accurate', () => {
  test('test-auditor names the real test command', async () => {
    // A hardcoded inventory in an agent file drifts silently. This one already
    // did: it listed five test files when there were seven.
    const [agent, pkg] = await Promise.all([
      readFile(path.join(REPO_ROOT, '.claude/agents/test-auditor.md'), 'utf8'),
      readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    ]);

    const command = JSON.parse(pkg).scripts.test.replace(/\\"/g, '"');
    assert.ok(
      agent.includes(command),
      `test-auditor should reference the actual test command: ${command}`,
    );
  });

  test('no agent file hardcodes a test-file inventory', async () => {
    const dir = path.join(REPO_ROOT, '.claude/agents');
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      const content = await readFile(path.join(dir, name), 'utf8');
      const listed = [...content.matchAll(/tests\/[a-z-]+\.test\.mjs/g)];
      assert.deepEqual(
        listed.map((m) => m[0]),
        [],
        `${name} hardcodes test filenames, which go stale — tell the agent to list tests/ instead`,
      );
    }
  });
});

describe('collectSkillFiles', () => {
  let fixture;

  test('setup', async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'dotclaude-test-'));
  });

  test('collects allowed files and skips the rest', async () => {
    const skill = path.join(fixture, 'sample');
    await mkdir(path.join(skill, 'references'), { recursive: true });

    await writeFile(path.join(skill, 'SKILL.md'), '---\nname: sample\n---\nbody\n');
    await writeFile(path.join(skill, 'references', 'notes.md'), 'notes');
    await writeFile(path.join(skill, 'data.json'), '{}');
    // Executable content must never be copied onto someone else's machine.
    await writeFile(path.join(skill, 'run.sh'), '#!/bin/sh\necho hi\n');
    await symlink('/etc/passwd', path.join(skill, 'sneaky.md'));

    const { files, skipped } = await collectSkillFiles(skill);

    assert.deepEqual(files.sort(), ['SKILL.md', 'data.json', 'references/notes.md']);
    assert.ok(skipped.some((s) => s.startsWith('run.sh')), 'should skip .sh');
    assert.ok(skipped.some((s) => s.includes('symlink')), 'should skip symlinks');
  });

  test('allowed extensions exclude executables', () => {
    for (const ext of ['.sh', '.bash', '.mjs', '.js', '.py', '.exe']) {
      assert.equal(ALLOWED_EXTENSIONS.has(ext), false, `${ext} must not be installable`);
    }
    assert.ok(ALLOWED_EXTENSIONS.has('.md'));
  });

  test('cleanup', async () => {
    await rm(fixture, { recursive: true, force: true });
  });
});
