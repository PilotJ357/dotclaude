# Contributing

## Setup

Node 22+ required (`.nvmrc` pins it).

```bash
npm ci
```

**`npm ci`, never `npm install`.** `ci` installs exactly what the lockfile says; `install` can resolve something else and rewrite it.

## The one rule

**`.claude/` is the source of truth. `.github/` is generated.**

Never hand-edit files under `.github/` except `workflows/`, `dependabot.yml` and `CODEOWNERS`. Everything else there carries a `GENERATED` header and will be overwritten.

After editing anything in `.claude/` or `AGENTS.md`:

```bash
npm run sync
```

CI verifies freshness and fails on drift. It never regenerates for you.

## Workflow

```bash
npm run sync       # regenerate .github/
npm run validate   # sync:check + tests + npm audit
```

Or just run `/done`, which does all of it plus a docs and test-coverage audit, then opens the PR.

## Adding things

**A skill** — the preferred unit, because skills are the only primitive both tools load natively:

```bash
mkdir -p .claude/skills/my-skill
$EDITOR .claude/skills/my-skill/SKILL.md
npm run sync && npm test
```

Frontmatter rules, description guidance and cross-runtime portability requirements are in [docs/authoring.md](docs/authoring.md).

**A subagent** — `.claude/agents/<name>.md`, needs `name` + `description`. Less portable than a skill; only reach for one when you genuinely need isolated context.

**A hook** — read [docs/security.md](docs/security.md) first. Hooks execute automatically on anyone who installs this config, so hook changes are privileged changes and require review under `CODEOWNERS`.

Do **not** add `.claude/commands/`. Claude Code already exposes skills as `/<name>`; a command file duplicates a skill for no benefit, and Copilot never reads that directory.

## Dependencies

The tree is **two packages**. `npm ls --all` should show `js-yaml` and its only child `argparse`, and nothing else.

Adding a dependency needs a justification in the PR describing why the standard library and the existing dependency cannot cover it. Test frameworks in particular: `node:test` is built in and sufficient here.

## What CI enforces

| Check | Enforced by |
|---|---|
| Skill frontmatter matches the Agent Skills spec | `tests/skills.test.mjs` |
| Subagents have `name` + `description` | `tests/agents.test.mjs` |
| Generated `.github/` tree is current | `tests/sync.test.mjs` |
| No home paths, no work-internal content, no unsafe hook patterns | `tests/hygiene.test.mjs` |
| Relative references inside skills resolve | `tests/links.test.mjs` |
| No high or critical advisories | `npm audit` |

## Style

- Lowercase kebab-case file names.
- Markdown only under the skill, agent and generated directories.
- No absolute home directory paths and no employer-specific or work-internal content anywhere. This repo is public and general-purpose; `hygiene.test.mjs` enforces it.
- Skill bodies must work in both Claude Code and Copilot. Don't assume parallel subagents exist — say what to do in each case.
