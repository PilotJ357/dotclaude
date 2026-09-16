import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MIN_AGE_DAYS,
  MIN_AGE_FLOOR_DAYS,
  collectLockPackages,
  ageInDays,
  evaluateAge,
  resolveMinAgeDays,
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

  test('default threshold is 48 hours', () => {
    assert.equal(DEFAULT_MIN_AGE_DAYS, 2);
    assert.equal(evaluateAge(daysAgo(1.9), DEFAULT_MIN_AGE_DAYS, NOW).ok, false);
    assert.equal(evaluateAge(daysAgo(2.1), DEFAULT_MIN_AGE_DAYS, NOW).ok, true);
  });
});

describe('resolveMinAgeDays', () => {
  test('falls back to the default when nothing is configured', () => {
    for (const raw of [undefined, null, '']) {
      assert.deepEqual(resolveMinAgeDays(raw), { ok: true, minAgeDays: DEFAULT_MIN_AGE_DAYS });
    }
  });

  test('accepts an override that raises the threshold', () => {
    assert.deepEqual(resolveMinAgeDays('7'), { ok: true, minAgeDays: 7 });
    assert.deepEqual(resolveMinAgeDays(14), { ok: true, minAgeDays: 14 });
  });

  test('accepts an override sitting exactly on the floor', () => {
    assert.deepEqual(resolveMinAgeDays(MIN_AGE_FLOOR_DAYS), {
      ok: true,
      minAgeDays: MIN_AGE_FLOOR_DAYS,
    });
  });

  test('refuses an override below the floor', () => {
    // The floor is the whole gate. A knob that reaches under it is the gate
    // switched off, and it would be reached for exactly when it matters.
    for (const raw of ['0', '1', '1.99', -5]) {
      const resolved = resolveMinAgeDays(raw);
      assert.equal(resolved.ok, false);
      assert.match(resolved.error, /below the 2-day floor/);
    }
  });

  test('refuses a value that is not a number', () => {
    for (const raw of ['soon', 'NaN', {}]) {
      const resolved = resolveMinAgeDays(raw);
      assert.equal(resolved.ok, false);
      assert.match(resolved.error, /invalid minimum age/);
    }
  });

  test('the floor is 48 hours', () => {
    assert.equal(MIN_AGE_FLOOR_DAYS, 2);
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
