import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT, SKILLS_DIR, AGENTS_DIR } from '../scripts/lib/paths.mjs';

/**
 * Compatibility claims must stay in docs/portability.md.
 *
 * Files that a runtime loads as instructions — AGENTS.md, skills, subagents —
 * are read back as authority and passed to subagents as premise. A wrong claim
 * in one of them does not sit inert; it propagates. This repo shipped four
 * such errors (hooks support, user-scope agent directories, subagent spawning,
 * and .claude/agents support) before that pattern was noticed.
 *
 * Keeping the claims in one sourced document means there is one file to
 * correct, and it is not auto-loaded as instruction.
 */

const CANONICAL = 'docs/portability.md';

/** Instruction-carrying files: loaded by a runtime, not just read by a human. */
async function instructionFiles() {
  const files = ['AGENTS.md'];

  for (const entry of await readdir(SKILLS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(`.claude/skills/${entry.name}/SKILL.md`);
  }
  for (const entry of await readdir(AGENTS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
      files.push(`.claude/agents/${entry.name}`);
    }
  }

  return files;
}

const files = await instructionFiles();

/** Paths that only make sense as part of a support claim. */
const RUNTIME_PATHS = [
  /\.github\/skills/,
  /\.github\/agents/,
  /\.github\/prompts/,
  /\.github\/hooks/,
  /\.agents\/skills/,
  /~\/\.copilot/,
  /\.copilot\/(agents|skills|hooks)/,
];

/** Assertions about what a runtime can or cannot do. */
const CAPABILITY_CLAIMS = [
  /\b(Copilot|Claude Code|VS Code)\b[^.\n]*\b(cannot|can't|does not support|doesn't support|has no|lacks)\b/i,
  /\b(cannot|does not|has no)\b[^.\n]*\b(Copilot|Claude Code|VS Code)\b/i,
  /\b(Copilot|Claude Code|VS Code)\b[^.\n]*\bonly (reads|loads|supports)\b/i,
];

describe('compatibility claims are centralized', () => {
  for (const file of files) {
    test(`${file} states no runtime file paths`, async () => {
      const content = await readFile(path.join(REPO_ROOT, file), 'utf8');
      const hits = RUNTIME_PATHS.filter((p) => p.test(content)).map(String);

      assert.deepEqual(
        hits,
        [],
        `${file} names another runtime's directories. Move the claim to ${CANONICAL} and link to it — ` +
          'instruction files get read back as authority and propagate their errors.',
      );
    });

    test(`${file} makes no capability claim`, async () => {
      const content = await readFile(path.join(REPO_ROOT, file), 'utf8');

      // AGENTS.md documents this rule, so it necessarily contains the words.
      // Exempt only the section that states the policy itself.
      const body = file === 'AGENTS.md'
        ? content.replace(/## Compatibility claims belong in one file[\s\S]*?(?=\n## )/, '')
        : content;

      for (const pattern of CAPABILITY_CLAIMS) {
        const match = body.match(pattern);
        assert.equal(
          match,
          null,
          `${file} asserts a runtime capability: "${match?.[0]?.trim()}". ` +
            `Move it to ${CANONICAL} with the source that establishes it.`,
        );
      }
    });
  }
});

describe('the canonical document carries sources', () => {
  test('portability.md links to primary documentation', async () => {
    const content = await readFile(path.join(REPO_ROOT, CANONICAL), 'utf8');
    const links = [...content.matchAll(/https:\/\/(docs\.github\.com|code\.visualstudio\.com)\/[^\s)]+/g)];

    assert.ok(
      links.length >= 5,
      `${CANONICAL} should cite primary documentation for its claims; found ${links.length} links`,
    );
  });

  test('portability.md states the negative-claim rule', async () => {
    const agents = await readFile(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    assert.match(
      agents,
      /A documentation page that simply does not mention a feature is not evidence/,
      'AGENTS.md must keep the rule about inferring absence from silence',
    );
  });
});
