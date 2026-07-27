import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MIN_AGE_DAYS,
  collectLockPackages,
  ageInDays,
  evaluateAge,
  parseAllowlist,
  packumentUrl,
} from '../scripts/lib/dep-age.mjs';

/** Offline by design — the network call lives in check-dep-age.mjs, not here. */

const NOW = new Date('2026-07-27T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('collectLockPackages', () => {
  test('extracts registry packages and skips the root entry', () => {
    const packages = collectLockPackages({
      packages: {
        '': { name: 'dotclaude', version: '0.1.0' },
        'node_modules/js-yaml': {
          version: '4.3.0',
          resolved: 'https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.0.tgz',
        },
        'node_modules/argparse': {
          version: '2.0.1',
          resolved: 'https://registry.npmjs.org/argparse/-/argparse-2.0.1.tgz',
        },
      },
    });

    assert.deepEqual(packages.map((p) => `${p.name}@${p.version}`), [
      'argparse@2.0.1',
      'js-yaml@4.3.0',
    ]);
  });

  test('resolves nested and scoped names from the lock path', () => {
    const packages = collectLockPackages({
      packages: {
        'node_modules/a/node_modules/@scope/b': {
          version: '1.2.3',
          resolved: 'https://registry.npmjs.org/@scope/b/-/b-1.2.3.tgz',
        },
      },
    });

    assert.equal(packages[0].name, '@scope/b');
    assert.equal(packages[0].version, '1.2.3');
  });

  test('skips workspace links and file-resolved packages', () => {
    const packages = collectLockPackages({
      packages: {
        'node_modules/linked': { version: '1.0.0', link: true },
        'node_modules/local': { version: '1.0.0', resolved: 'file:../local' },
        'node_modules/no-version': { resolved: 'https://registry.npmjs.org/x' },
      },
    });

    assert.deepEqual(packages, []);
  });

  test('tolerates a lockfile with no packages key', () => {
    assert.deepEqual(collectLockPackages({}), []);
  });
});

describe('ageInDays', () => {
  test('computes whole days', () => {
    assert.equal(ageInDays(daysAgo(5), NOW), 5);
  });

  test('computes fractional days', () => {
    assert.equal(ageInDays(daysAgo(0.5), NOW), 0.5);
  });

  test('returns a negative age for a future timestamp', () => {
    assert.ok(ageInDays(daysAgo(-2), NOW) < 0);
  });
});

describe('evaluateAge', () => {
  test('rejects a version younger than the threshold', () => {
    const { ok, ageDays } = evaluateAge(daysAgo(1), 3, NOW);
    assert.equal(ok, false);
    assert.equal(ageDays, 1);
  });

  test('accepts a version older than the threshold', () => {
    assert.equal(evaluateAge(daysAgo(10), 3, NOW).ok, true);
  });

  test('accepts a version exactly at the threshold', () => {
    assert.equal(evaluateAge(daysAgo(3), 3, NOW).ok, true);
  });

  test('rejects a version published moments ago', () => {
    assert.equal(evaluateAge(daysAgo(0.01), 3, NOW).ok, false);
  });

  test('default threshold is three days', () => {
    assert.equal(DEFAULT_MIN_AGE_DAYS, 3);
    assert.equal(evaluateAge(daysAgo(2), DEFAULT_MIN_AGE_DAYS, NOW).ok, false);
    assert.equal(evaluateAge(daysAgo(4), DEFAULT_MIN_AGE_DAYS, NOW).ok, true);
  });
});

describe('parseAllowlist', () => {
  test('parses exact name@version pairs', () => {
    const allow = parseAllowlist('js-yaml@4.3.0, @scope/pkg@1.0.0');
    assert.ok(allow.has('js-yaml@4.3.0'));
    assert.ok(allow.has('@scope/pkg@1.0.0'));
  });

  test('is empty when unset', () => {
    assert.equal(parseAllowlist(undefined).size, 0);
    assert.equal(parseAllowlist('').size, 0);
  });

  test('ignores bare package names', () => {
    // A bare name would exempt the dependency at every future version.
    assert.equal(parseAllowlist('js-yaml').size, 0);
    assert.equal(parseAllowlist('@scope/pkg').size, 0);
  });
});

describe('packumentUrl', () => {
  test('builds an unscoped URL', () => {
    assert.equal(packumentUrl('js-yaml'), 'https://registry.npmjs.org/js-yaml');
  });

  test('encodes the slash in a scoped name', () => {
    assert.equal(packumentUrl('@scope/pkg'), 'https://registry.npmjs.org/@scope%2fpkg');
  });
});
