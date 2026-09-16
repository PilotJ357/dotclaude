#!/usr/bin/env node
/**
 * Refuse dependency versions published within the last N days, where N is
 * never below 48 hours. Enforces the floor against the lockfile — Dependabot
 * cooldown only stops proposals, does not cover security updates at all, and
 * cannot see a hand-edited lockfile. Rationale: docs/security.md.
 *
 *   node scripts/check-dep-age.mjs             warn if the registry is unreachable
 *   node scripts/check-dep-age.mjs --strict    treat registry failure as an error
 *
 * Options:
 *   --min-age-days=N   Raise the threshold (env: MIN_DEP_AGE_DAYS). The
 *                      48-hour floor cannot be lowered, including for an
 *                      urgent security patch: a fresh release is exactly what
 *                      a compromised one looks like.
 *   --strict           Fail if the registry cannot be reached
 *   --json             Machine-readable output
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT } from './lib/paths.mjs';
import {
  collectLockPackages,
  evaluateAge,
  resolveMinAgeDays,
  packumentUrl,
} from './lib/dep-age.mjs';

const REQUEST_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const flag = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

  const resolved = resolveMinAgeDays(flag('min-age-days') ?? process.env.MIN_DEP_AGE_DAYS);

  if (!resolved.ok) {
    console.error(`dep-age: ${resolved.error}`);
    process.exit(2);
  }

  return {
    minAgeDays: resolved.minAgeDays,
    strict: argv.includes('--strict'),
    json: argv.includes('--json'),
  };
}

/** Fetch a package's publish times. Returns null if the registry is unreachable. */
async function fetchPublishTimes(name) {
  const response = await fetch(packumentUrl(name), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`registry returned ${response.status} for ${name}`);
  }

  const document = await response.json();
  return document.time ?? {};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lock = JSON.parse(await readFile(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  const packages = collectLockPackages(lock);

  if (packages.length === 0) {
    console.log('dep-age: no registry dependencies to check');
    return;
  }

  const now = new Date();
  const violations = [];
  const unknown = [];

  // Fetch once per distinct name, not once per package entry.
  const names = [...new Set(packages.map((pkg) => pkg.name))];
  const times = new Map();

  for (const name of names) {
    try {
      times.set(name, await fetchPublishTimes(name));
    } catch (error) {
      const message = `could not check ${name}: ${error.message}`;
      if (options.strict) {
        console.error(`dep-age: ${message}`);
        process.exitCode = 1;
        return;
      }
      console.warn(`dep-age: ${message} (non-strict, skipping)`);
      times.set(name, null);
    }
  }

  for (const pkg of packages) {
    const publishedAt = times.get(pkg.name)?.[pkg.version];

    if (!publishedAt) {
      unknown.push(pkg);
      continue;
    }

    const { ok, ageDays } = evaluateAge(publishedAt, options.minAgeDays, now);
    if (ok) continue;

    violations.push({ ...pkg, publishedAt, ageDays });
  }

  if (options.json) {
    console.log(JSON.stringify(
      { minAgeDays: options.minAgeDays, checked: packages.length, violations, unknown },
      null,
      2,
    ));
  }

  if (unknown.length > 0 && options.strict) {
    console.error('dep-age: no publish time found for:');
    for (const pkg of unknown) console.error(`  ${pkg.name}@${pkg.version}`);
    process.exitCode = 1;
    return;
  }

  if (violations.length > 0) {
    console.error(
      `dep-age: ${violations.length} dependency version(s) younger than ` +
        `${options.minAgeDays} day(s):\n`,
    );
    for (const pkg of violations) {
      console.error(
        `  ${pkg.name}@${pkg.version} — published ${pkg.publishedAt} ` +
          `(${pkg.ageDays.toFixed(1)}d ago)`,
      );
    }
    console.error(
      '\nWait for the version to age, or pin to an older one. A security ' +
        'patch waits out the 48 hours like anything else.',
    );
    process.exitCode = 1;
    return;
  }

  if (!options.json) {
    const skipped = unknown.length > 0 ? `, ${unknown.length} with no publish time` : '';
    console.log(
      `dep-age: ${packages.length} package(s) checked, all at least ` +
        `${options.minAgeDays} day(s) old${skipped}`,
    );
  }
}

await main();
