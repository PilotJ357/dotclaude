import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

import {
  REPO_ROOT,
  GH_PROMPTS_DIR,
  GH_AGENTS_DIR,
  GH_INSTRUCTIONS,
  SKILLS_DIR,
  AGENTS_DIR,
  GENERATED_MARKER,
} from '../scripts/lib/paths.mjs';

const run = promisify(execFile);

/**
 * The generated `.github/` tree must match the canonical `.claude/` tree.
 * CI runs `--check` only; it never regenerates, so drift fails the build.
 */

describe('sync --check', () => {
  test('reports no drift', async () => {
    const result = await run(
      process.execPath,
      ['scripts/sync.mjs', '--check'],
      { cwd: REPO_ROOT },
    ).catch((error) => error);

    assert.equal(
      result.code,
      undefined,
      `generated files are out of date — run \`npm run sync\`:\n${result.stderr ?? ''}`,
    );
    assert.match(result.stdout, /up to date/);
  });
});

describe('generated tree', () => {
  test('every skill has a prompt stub', async () => {
    const skills = (await readdir(SKILLS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const prompts = await readdir(GH_PROMPTS_DIR);

    for (const skill of skills) {
      assert.ok(
        prompts.includes(`${skill}.prompt.md`),
        `missing .github/prompts/${skill}.prompt.md`,
      );
    }
  });

  test('every agent has a stub', async () => {
    const agents = (await readdir(AGENTS_DIR, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
      .map((e) => e.name);
    const stubs = await readdir(GH_AGENTS_DIR);

    for (const agent of agents) {
      // Copilot CLI documents the .agent.md extension; VS Code accepts any
      // .md in .github/agents, so .agent.md is the form both load.
      const expected = agent.replace(/\.md$/, '.agent.md');
      assert.ok(stubs.includes(expected), `missing .github/agents/${expected}`);
    }
  });

  test('agent stubs use the .agent.md extension', async () => {
    for (const name of await readdir(GH_AGENTS_DIR)) {
      assert.match(
        name,
        /\.agent\.md$/,
        `${name} must end in .agent.md — Copilot CLI will not load a bare .md agent`,
      );
    }
  });

  test('all generated files carry the generated marker', async () => {
    const files = [GH_INSTRUCTIONS];
    for (const dir of [GH_PROMPTS_DIR, GH_AGENTS_DIR]) {
      for (const name of await readdir(dir)) files.push(path.join(dir, name));
    }

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      assert.ok(
        content.includes(GENERATED_MARKER),
        `${path.relative(REPO_ROOT, file)} lacks the generated marker`,
      );
    }
  });

  test('stubs point at their canonical source and carry no substance', async () => {
    for (const dir of [GH_PROMPTS_DIR, GH_AGENTS_DIR]) {
      for (const name of await readdir(dir)) {
        const content = await readFile(path.join(dir, name), 'utf8');
        assert.match(
          content,
          /Read `\.claude\/[^`]+` and follow it exactly\./,
          `${name} must point at its canonical .claude/ source`,
        );
        // A stub that grows real content can drift. Keep them trivial.
        assert.ok(
          content.split('\n').length < 20,
          `${name} is too long to be a pointer stub — content belongs in .claude/`,
        );
      }
    }
  });

  test('generated dirs contain only markdown', async () => {
    for (const dir of [GH_PROMPTS_DIR, GH_AGENTS_DIR]) {
      for (const name of await readdir(dir)) {
        assert.ok(name.endsWith('.md'), `unexpected non-markdown file: ${name}`);
      }
    }
  });

  test('copilot-instructions reparents relative links', async () => {
    const content = await readFile(GH_INSTRUCTIONS, 'utf8');
    // AGENTS.md sits at the repo root and links to `docs/...`; the copy lives
    // one level deeper, so those links must have been rewritten.
    assert.doesNotMatch(
      content,
      /\]\(docs\//,
      'links to docs/ must be reparented to ../docs/',
    );
    assert.match(content, /\]\(\.\.\/docs\//);
  });
});
