# Contributing

## Setup

Node 22+ (`.nvmrc` pins it).

```bash
npm ci
```

Use `npm ci`, not `npm install`. `ci` installs exactly what the lockfile specifies; `install` can resolve something else and rewrite it.

## Source of truth

`.claude/` is authored. `.github/` is generated from it by `scripts/sync.mjs`, except `workflows/`, `dependabot.yml` and `CODEOWNERS`, which are hand-written. Generated files carry a `GENERATED` header.

After editing anything in `.claude/` or `AGENTS.md`:

```bash
npm run sync
```

CI verifies freshness and fails on drift. It does not regenerate.

## Commands

| Command | Does |
|---|---|
| `npm run sync` | Regenerate `.github/` |
| `npm run sync:check` | Fail if `.github/` is stale |
| `npm test` | Run the validation suite |
| `npm run validate` | `sync:check` + tests + `npm audit` |

`/done` runs all of it plus a docs and coverage audit, then opens the PR.

## Adding things

**Skills** are the preferred unit — the only primitive both tools load natively. Create `.claude/skills/<name>/SKILL.md`, then `npm run sync && npm test`. Frontmatter rules: [docs/authoring.md](docs/authoring.md).

**Subagents** go in `.claude/agents/<name>.md` with `name` and `description`. Less portable than skills; use only when isolated context is genuinely needed.

**Hooks** execute on anyone who installs this config. Read [.claude/hooks/README.md](.claude/hooks/README.md) and [docs/security.md](docs/security.md) first. Requires review under `CODEOWNERS`.

Do not add `.claude/commands/`. Claude Code exposes skills as `/<name>` already, and Copilot never reads that directory.

## Dependencies

`npm ls --all` should show `js-yaml` and `argparse`, nothing else. Adding a dependency requires a PR justification explaining why the standard library and existing dependency cannot cover it. `node:test` is built in — do not add a test framework.

## What CI enforces

| Check | Enforced by |
|---|---|
| Skill frontmatter matches the Agent Skills spec | `tests/skills.test.mjs` |
| Subagents have `name` and `description` | `tests/agents.test.mjs` |
| `.github/` is current, stubs stay trivial | `tests/sync.test.mjs` |
| No home paths, denied terms, credential shapes, unsafe hooks | `tests/hygiene.test.mjs` |
| Relative links resolve | `tests/links.test.mjs` |
| Installer guards reject traversal | `tests/install.test.mjs` |
| Dependency tree ≤ 2 packages | `.github/workflows/validate.yml` |
| Every action pinned to a 40-char SHA | `.github/workflows/validate.yml` |
| No high or critical advisories | `npm audit` |

## Conventions

Lowercase kebab-case filenames, except `SKILL.md`, `README.md` and root metadata files. Markdown only under the skill, agent and generated directories. No absolute home paths and no employer-specific content — `tests/denylist.txt` holds the term list.

Skill bodies must work in both runtimes. Claude Code can spawn parallel subagents; Copilot CLI cannot. State what to do in each case rather than assuming one.
