import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { AGENTS_DIR } from '../scripts/lib/paths.mjs';

/**
 * Subagent definitions. Claude Code and Copilot disagree on the optional
 * fields, so only `name` and `description` — the two both understand, and the
 * two that sync.mjs carries into the generated stub — are enforced.
 */

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const entries = await readdir(AGENTS_DIR, { withFileTypes: true });
const agentFiles = entries
  .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
  .map((e) => e.name);

for (const fileName of agentFiles) {
  describe(`agent: ${fileName}`, () => {
    const file = path.join(AGENTS_DIR, fileName);
    const stem = fileName.replace(/\.md$/, '');

    test('has parseable frontmatter', async () => {
      const { raw } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.notEqual(raw, null, 'agent file has no frontmatter block');
    });

    test('name is present and matches the filename', async () => {
      const { data } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.equal(typeof data.name, 'string', 'name is required');
      assert.equal(data.name, stem, 'frontmatter name must match the filename');
      assert.match(data.name, NAME_PATTERN, 'name must be lowercase kebab-case');
    });

    test('description is present and non-empty', async () => {
      const { data } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.equal(typeof data.description, 'string', 'description is required');
      assert.ok(data.description.trim().length > 0, 'description must not be empty');
    });

    test('frontmatter contains no angle brackets', async () => {
      const { raw } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.doesNotMatch(raw, /[<>]/, 'frontmatter must not contain < or >');
    });

    test('has a non-empty body', async () => {
      const { body } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.ok(body.trim().length > 0, 'agent body is empty');
    });
  });
}
