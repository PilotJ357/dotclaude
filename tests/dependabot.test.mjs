import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

import { REPO_ROOT } from '../scripts/lib/paths.mjs';
import { MIN_AGE_FLOOR_DAYS } from '../scripts/lib/dep-age.mjs';

/**
 * `dependabot.yml` is hand-written, not generated, and it is the file that
 * decides whether a security fix ever reaches a pull request. The claims it
 * is built on — cooldown covering version updates only, `update-types`
 * constraining version updates only — are sourced in docs/security.md.
 *
 * What is checked here is the shape that follows from those claims: the
 * security path stays configured, and nothing in this file quietly implies a
 * wait shorter than the floor the gate enforces.
 */

const config = yaml.load(
  await readFile(path.join(REPO_ROOT, '.github', 'dependabot.yml'), 'utf8'),
);

const ecosystems = config.updates.map((entry) => [entry['package-ecosystem'], entry]);

describe('dependabot configuration', () => {
  test('is version 2 and covers npm and Actions', () => {
    assert.equal(config.version, 2);
    assert.deepEqual(
      ecosystems.map(([name]) => name).sort(),
      ['github-actions', 'npm'],
    );
  });

  for (const [name, entry] of ecosystems) {
    test(`${name} routes security updates into a group`, () => {
      const groups = Object.values(entry.groups ?? {});
      const security = groups.filter((group) => group['applies-to'] === 'security-updates');

      assert.equal(
        security.length,
        1,
        `${name} needs exactly one group with applies-to: security-updates — ` +
          'without it, security fixes arrive one pull request per package.',
      );
      assert.deepEqual(
        security[0].patterns,
        ['*'],
        `${name} security group must cover every dependency`,
      );
    });

    test(`${name} cooldown never implies a wait below the floor`, () => {
      // Cooldown is the longer, routine wait. A value under the floor would
      // read as the real policy while enforcing nothing — the gate is what
      // holds 48 hours, and it holds it whatever this file says.
      for (const [option, days] of Object.entries(entry.cooldown ?? {})) {
        assert.ok(
          days >= MIN_AGE_FLOOR_DAYS,
          `${name} cooldown.${option} is ${days} day(s), below the ` +
            `${MIN_AGE_FLOOR_DAYS}-day floor in docs/security.md`,
        );
      }
    });

    test(`${name} ignores nothing outright`, () => {
      // An entry without `update-types` suppresses the dependency entirely.
      // With it, the entry constrains version updates and leaves the security
      // path alone, which is the only form allowed here.
      for (const entryToIgnore of entry.ignore ?? []) {
        assert.ok(
          Array.isArray(entryToIgnore['update-types']) &&
            entryToIgnore['update-types'].length > 0,
          `${name} ignores ${entryToIgnore['dependency-name']} with no update-types, ` +
            'which withholds it from every update path. Scope it to version updates.',
        );
      }
    });
  }
});
