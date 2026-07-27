import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  resolveWithin,
  isSafeSkillName,
  collectSkillFiles,
  ALLOWED_EXTENSIONS,
} from '../scripts/lib/install-plan.mjs';

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
