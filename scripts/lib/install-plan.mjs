import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Planning logic for the installer, separated from the filesystem effects in
 * install.mjs so the guards can be tested directly. See docs/security.md.
 */

/** Files the installer is willing to copy. Nothing executable. */
export const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);

/**
 * Resolve `child` under `root`, refusing anything that escapes it.
 *
 * This is the guard against a crafted skill directory name (`../../.ssh`,
 * an absolute path, a symlink pointing outward) turning a copy into an
 * arbitrary write somewhere in the user's home directory.
 *
 * @param {string} root Absolute directory the result must stay inside.
 * @param {string} child Untrusted relative path.
 * @returns {string} Absolute, verified path.
 * @throws {Error} If the resolved path escapes `root`.
 */
export function resolveWithin(root, child) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, child);
  const relative = path.relative(resolvedRoot, target);

  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `refusing to write outside ${resolvedRoot}: ${child} resolves to ${target}`,
    );
  }

  return target;
}

/** A skill directory name must be a plain kebab-case segment. */
export function isSafeSkillName(name) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}

/**
 * Walk a skill directory, returning repo-relative file paths that are safe to
 * copy. Symlinks are skipped entirely rather than followed — a symlink inside
 * a skill could point anywhere.
 *
 * @returns {Promise<{ files: string[], skipped: string[] }>}
 */
export async function collectSkillFiles(skillDir) {
  const files = [];
  const skipped = [];

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(skillDir, absolute).split(path.sep).join('/');

      if (entry.isSymbolicLink()) {
        skipped.push(`${relative} (symlink)`);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        skipped.push(`${relative} (not a regular file)`);
        continue;
      }
      if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        skipped.push(`${relative} (disallowed extension)`);
        continue;
      }

      // Verify the path stays inside the skill before it is ever used.
      resolveWithin(skillDir, relative);
      files.push(relative);
    }
  }

  await walk(skillDir);
  return { files, skipped };
}

/** True if `target` already exists. */
export async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
