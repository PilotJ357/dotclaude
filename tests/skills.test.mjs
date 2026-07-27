import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { SKILLS_DIR } from '../scripts/lib/paths.mjs';

/**
 * Skill frontmatter, validated against the Agent Skills specification.
 * https://agentskills.io/specification
 */

// Spec-allowed keys. Anything else is silently ignored at runtime, which means
// a typo fails quietly — so it fails loudly here instead.
const ALLOWED_KEYS = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
]);

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
const skillNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);

test('at least one skill exists', () => {
  assert.ok(skillNames.length > 0, 'no skills found in .claude/skills/');
});

for (const name of skillNames) {
  describe(`skill: ${name}`, () => {
    const file = path.join(SKILLS_DIR, name, 'SKILL.md');

    test('has a SKILL.md with parseable frontmatter', async () => {
      const source = await readFile(file, 'utf8');
      assert.doesNotThrow(() => parseFrontmatter(source));

      const { data, raw } = parseFrontmatter(source);
      assert.notEqual(raw, null, 'SKILL.md has no frontmatter block');
      assert.equal(typeof data, 'object');
    });

    test('name matches the directory name', async () => {
      const { data } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.equal(
        data.name,
        name,
        `frontmatter name "${data.name}" must equal directory name "${name}" or the skill will not load`,
      );
    });

    test('name is kebab-case and within length limits', async () => {
      const { data } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.match(data.name, NAME_PATTERN, 'name must be lowercase kebab-case');
      assert.ok(
        data.name.length <= MAX_NAME_LENGTH,
        `name is ${data.name.length} chars, limit is ${MAX_NAME_LENGTH}`,
      );
    });

    test('description is present and within the length limit', async () => {
      const { data } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.equal(typeof data.description, 'string', 'description is required');
      assert.ok(data.description.trim().length > 0, 'description must not be empty');
      assert.ok(
        data.description.length <= MAX_DESCRIPTION_LENGTH,
        `description is ${data.description.length} chars, limit is ${MAX_DESCRIPTION_LENGTH}`,
      );
    });

    test('frontmatter contains no angle brackets', async () => {
      const { raw } = parseFrontmatter(await readFile(file, 'utf8'));
      // Angle brackets in frontmatter can inject unintended instructions into
      // the system prompt when the skill is loaded.
      assert.doesNotMatch(raw, /[<>]/, 'frontmatter must not contain < or >');
    });

    test('frontmatter uses only specification keys', async () => {
      const { data } = parseFrontmatter(await readFile(file, 'utf8'));
      const unknown = Object.keys(data).filter((key) => !ALLOWED_KEYS.has(key));
      assert.deepEqual(
        unknown,
        [],
        `unknown frontmatter keys: ${unknown.join(', ')}`,
      );
    });

    test('has a non-empty body', async () => {
      const { body } = parseFrontmatter(await readFile(file, 'utf8'));
      assert.ok(body.trim().length > 0, 'SKILL.md body is empty');
    });
  });
}

describe('frontmatter parser', () => {
  test('extracts data and body', () => {
    const { data, body } = parseFrontmatter('---\nname: a\n---\nhello\n');
    assert.deepEqual(data, { name: 'a' });
    assert.equal(body, 'hello\n');
  });

  test('tolerates CRLF line endings', () => {
    const { data } = parseFrontmatter('---\r\nname: a\r\n---\r\nbody\r\n');
    assert.equal(data.name, 'a');
  });

  test('returns null raw when there is no frontmatter', () => {
    const { data, raw } = parseFrontmatter('# just markdown\n');
    assert.equal(raw, null);
    assert.deepEqual(data, {});
  });

  test('rejects frontmatter that is not a mapping', () => {
    assert.throws(() => parseFrontmatter('---\n- one\n- two\n---\nbody\n'), /mapping/);
  });
});
