import yaml from 'js-yaml';

/**
 * Split a markdown document into its YAML frontmatter and body.
 *
 * Deliberately not `gray-matter` — that pulls three transitive dependencies to
 * do what a regex and `js-yaml` already do. See docs/security.md.
 *
 * `yaml.load` in js-yaml v4 uses the safe default schema and will not construct
 * arbitrary types. Do not swap it for a custom schema.
 *
 * @param {string} source Raw file contents.
 * @returns {{ data: Record<string, unknown>, body: string, raw: string|null }}
 */
export function parseFrontmatter(source) {
  // Tolerate a BOM and CRLF line endings; Windows checkouts produce both.
  const text = source.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);

  if (!match) {
    return { data: {}, body: text, raw: null };
  }

  const raw = match[1];
  const parsed = yaml.load(raw);

  if (parsed !== null && parsed !== undefined && typeof parsed !== 'object') {
    throw new Error('frontmatter must be a mapping');
  }
  if (Array.isArray(parsed)) {
    throw new Error('frontmatter must be a mapping, not a list');
  }

  return {
    data: parsed ?? {},
    body: text.slice(match[0].length),
    raw,
  };
}

/**
 * Serialize a mapping as a YAML frontmatter block.
 *
 * Only used for generated stubs, whose frontmatter is a couple of scalar
 * fields. `lineWidth: -1` prevents js-yaml from wrapping long descriptions,
 * which would otherwise make generated output churn on unrelated edits.
 *
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function stringifyFrontmatter(data) {
  const yamlText = yaml.dump(data, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${yamlText}\n---\n`;
}
