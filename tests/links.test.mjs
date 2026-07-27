import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT, SKILLS_DIR, AGENTS_DIR, HOOKS_DIR } from '../scripts/lib/paths.mjs';

/**
 * Relative markdown links must resolve on disk. A skill that references a
 * bundled resource by a typo'd path fails silently at runtime — the model just
 * cannot find the file — so it fails here instead.
 */

/** Markdown files worth checking: the docs a human or agent actually follows. */
async function markdownFiles() {
  const files = [];

  for (const name of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    files.push(path.join(REPO_ROOT, name));
  }

  for (const name of await readdir(path.join(REPO_ROOT, 'docs'))) {
    if (name.endsWith('.md')) files.push(path.join(REPO_ROOT, 'docs', name));
  }

  for (const entry of await readdir(SKILLS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(path.join(SKILLS_DIR, entry.name, 'SKILL.md'));
    }
  }

  for (const entry of await readdir(AGENTS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(AGENTS_DIR, entry.name));
    }
  }

  for (const entry of await readdir(HOOKS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(HOOKS_DIR, entry.name));
    }
  }

  return files;
}

/** Extract relative link targets, ignoring external URLs and pure anchors. */
function relativeLinks(markdown) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g;

  for (const match of markdown.matchAll(pattern)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    links.push(target.split('#')[0]);
  }

  return links.filter((target) => target.length > 0);
}

const files = await markdownFiles();

describe('relative links resolve', () => {
  for (const file of files) {
    const label = path.relative(REPO_ROOT, file).split(path.sep).join('/');

    test(label, async () => {
      const content = await readFile(file, 'utf8');
      const missing = [];

      for (const target of relativeLinks(content)) {
        const resolved = path.resolve(path.dirname(file), target);
        try {
          await stat(resolved);
        } catch {
          missing.push(target);
        }
      }

      assert.deepEqual(missing, [], `${label} has broken link(s): ${missing.join(', ')}`);
    });
  }
});

describe('link extraction', () => {
  test('ignores external URLs and anchors', () => {
    const found = relativeLinks(
      '[a](https://example.com) [b](#section) [c](docs/x.md) [d](mailto:a@b.c)',
    );
    assert.deepEqual(found, ['docs/x.md']);
  });

  test('strips fragments from relative targets', () => {
    assert.deepEqual(relativeLinks('[a](docs/x.md#heading)'), ['docs/x.md']);
  });
});
