/**
 * Pure logic for the dependency minimum-age gate, split out so it can be
 * tested without touching the network. See docs/security.md.
 */

/**
 * The floor, in days: 48 hours. Nothing installs younger than this.
 *
 * It is the only thing standing between the lockfile and a freshly published
 * package, because the layer above it does not cover every case — Dependabot
 * `cooldown` holds back version updates but not security updates, and it
 * cannot see a hand-edited lockfile at all.
 */
export const MIN_AGE_FLOOR_DAYS = 2;

/** Threshold applied when nothing overrides it. The floor, by policy. */
export const DEFAULT_MIN_AGE_DAYS = MIN_AGE_FLOOR_DAYS;

const MS_PER_DAY = 86_400_000;

/**
 * Extract installed packages from an npm lockfile (lockfileVersion 2 or 3).
 *
 * Skips the root project, workspace links and anything resolved from disk —
 * none of those come from the registry, so none has a publish time.
 *
 * @param {object} lock Parsed package-lock.json.
 * @returns {{ name: string, version: string, path: string }[]}
 */
export function collectLockPackages(lock) {
  const packages = [];

  for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
    if (lockPath === '') continue;
    if (entry.link) continue;
    if (entry.resolved && !entry.resolved.startsWith('http')) continue;
    if (!entry.version) continue;

    // "node_modules/a/node_modules/@scope/b" -> "@scope/b"
    const name = lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
    packages.push({ name, version: entry.version, path: lockPath });
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * Age of a published version, in days, at a given moment.
 *
 * @param {string} publishedAt ISO timestamp from the registry.
 * @param {Date} now
 * @returns {number}
 */
export function ageInDays(publishedAt, now = new Date()) {
  return (now.getTime() - new Date(publishedAt).getTime()) / MS_PER_DAY;
}

/**
 * Decide whether a package version has aged enough to be installable.
 *
 * @returns {{ ok: boolean, ageDays: number }}
 */
export function evaluateAge(publishedAt, minAgeDays, now = new Date()) {
  const ageDays = ageInDays(publishedAt, now);
  return { ok: ageDays >= minAgeDays, ageDays };
}

/**
 * Resolve a configured threshold against the floor.
 *
 * An override may raise the wait, never shorten it. A knob that reaches below
 * 48 hours is the gate switched off, and the urgent case it would be reached
 * for — a security patch published an hour ago — is the one case where the
 * gate is doing its job: a compromised release looks exactly like that too.
 *
 * @param {string|number|undefined|null} raw
 * @returns {{ ok: true, minAgeDays: number } | { ok: false, error: string }}
 */
export function resolveMinAgeDays(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, minAgeDays: DEFAULT_MIN_AGE_DAYS };
  }

  const minAgeDays = Number(raw);

  if (!Number.isFinite(minAgeDays)) {
    return { ok: false, error: `invalid minimum age: ${raw}` };
  }

  if (minAgeDays < MIN_AGE_FLOOR_DAYS) {
    return {
      ok: false,
      error:
        `minimum age ${minAgeDays} is below the ${MIN_AGE_FLOOR_DAYS}-day floor. ` +
        'The floor is not configurable — see docs/security.md.',
    };
  }

  return { ok: true, minAgeDays };
}

/** Registry URL for a package's full document, which is the only one carrying `.time`. */
export function packumentUrl(name) {
  // Scoped names must keep the "@" but encode the slash.
  return `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
}
