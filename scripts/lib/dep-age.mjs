/**
 * Pure logic for the dependency minimum-age gate, split out so it can be
 * tested without touching the network. See docs/security.md.
 */

export const DEFAULT_MIN_AGE_DAYS = 3;
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
 * Parse deliberate exceptions, e.g. "js-yaml@4.3.0,@scope/pkg@1.0.0".
 *
 * Exceptions are exact name@version pairs — a bare package name would exempt
 * that dependency forever, which defeats the gate.
 *
 * @param {string|undefined} value
 * @returns {Set<string>}
 */
export function parseAllowlist(value) {
  if (!value) return new Set();

  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.lastIndexOf('@') > 0),
  );
}

/** Registry URL for a package's full document, which is the only one carrying `.time`. */
export function packumentUrl(name) {
  // Scoped names must keep the "@" but encode the slash.
  return `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
}
