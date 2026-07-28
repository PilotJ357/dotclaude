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
  SKILLS_DIR,
  AGENTS_DIR,
  GENERATED_MARKER,
} from '../scripts/lib/paths.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';

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
    const files = [];
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

  test('generated files carry the full body, not a pointer', async () => {
    // A pointer costs an extra file read and breaks wherever the relative
    // path does not resolve. These are generated and freshness-checked, so a
    // full copy cannot drift.
    for (const dir of [GH_PROMPTS_DIR, GH_AGENTS_DIR]) {
      for (const name of await readdir(dir)) {
        const content = await readFile(path.join(dir, name), 'utf8');
        assert.doesNotMatch(
          content,
          /Read `\.claude\/[^`]+` and follow it/,
          `${name} still points at .claude/ instead of carrying the content`,
        );
      }
    }
  });

  test('prompt bodies match their skill bodies exactly', async () => {
    for (const entry of await readdir(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const skill = await readFile(
        path.join(SKILLS_DIR, entry.name, 'SKILL.md'),
        'utf8',
      );
      const generated = await readFile(
        path.join(GH_PROMPTS_DIR, `${entry.name}.prompt.md`),
        'utf8',
      );

      const { body } = parseFrontmatter(skill);
      const { body: generatedBody } = parseFrontmatter(
        generated.replace(/^<!--[^\n]*-->\n/, ''),
      );
      assert.equal(
        generatedBody.trim(),
        body.trim(),
        `.github/prompts/${entry.name}.prompt.md body diverges from the skill`,
      );
    }
  });

  test('every skill is also emitted as a Copilot agent', async () => {
    // Copilot CLI has no prompt-file support but does have `/agent NAME`,
    // so this is what makes a skill explicitly invocable there.
    const stubs = await readdir(GH_AGENTS_DIR);

    for (const entry of await readdir(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      assert.ok(
        stubs.includes(`${entry.name}.agent.md`),
        `missing .github/agents/${entry.name}.agent.md — skill unreachable via /agent in Copilot CLI`,
      );
    }
  });

  test('skill and subagent names do not collide', async () => {
    const skills = (await readdir(SKILLS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const agents = (await readdir(AGENTS_DIR, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
      .map((e) => e.name.replace(/\.md$/, ''));

    const collisions = skills.filter((name) => agents.includes(name));
    assert.deepEqual(collisions, [], 'both are emitted into .github/agents/');
  });

  test('agent bodies match their canonical bodies exactly', async () => {
    for (const entry of await readdir(AGENTS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      if (entry.name === 'README.md') continue;

      const canonical = await readFile(path.join(AGENTS_DIR, entry.name), 'utf8');
      const generated = await readFile(
        path.join(GH_AGENTS_DIR, entry.name.replace(/\.md$/, '.agent.md')),
        'utf8',
      );

      const { body } = parseFrontmatter(canonical);
      const { body: generatedBody } = parseFrontmatter(
        generated.replace(/^<!--[^\n]*-->\n/, ''),
      );
      assert.equal(
        generatedBody.trim(),
        body.trim(),
        `.github/agents/${entry.name} body diverges from the canonical file`,
      );
    }
  });

  test('generated frontmatter drops runtime-specific fields', async () => {
    for (const name of await readdir(GH_AGENTS_DIR)) {
      const content = await readFile(path.join(GH_AGENTS_DIR, name), 'utf8');
      const { data } = parseFrontmatter(content.replace(/^<!--[^\n]*-->\n/, ''));

      // Claude Code's `tools`/`model` and Copilot's agent frontmatter overlap
      // in keys but not value vocabularies. Only the shared fields carry over.
      assert.deepEqual(
        Object.keys(data).sort(),
        ['description', 'name'],
        `${name} should carry only name and description`,
      );
    }
  });

  test('generated dirs contain only markdown', async () => {
    for (const dir of [GH_PROMPTS_DIR, GH_AGENTS_DIR]) {
      for (const name of await readdir(dir)) {
        assert.ok(name.endsWith('.md'), `unexpected non-markdown file: ${name}`);
      }
    }
  });
});
