# Authoring

## Adding a skill

```bash
mkdir -p .claude/skills/my-skill
$EDITOR .claude/skills/my-skill/SKILL.md
npm run sync && npm test
```

`sync` generates the Copilot stub, `test` validates the frontmatter.

## Frontmatter

Skills follow the [Agent Skills specification](https://agentskills.io/specification). Only `name` and `description` are required.

```yaml
---
name: my-skill
description: Does the thing. Use when the user asks for the thing, mentions a related term, or is about to do an adjacent activity.
---
```

`tests/skills.test.mjs` enforces:

| Rule | Reason |
|---|---|
| `name` equals the parent directory name | The skill silently fails to load otherwise |
| `name` kebab-case, ≤64 chars, no leading or trailing hyphen | Spec |
| `description` present, ≤1024 chars | Spec |
| No `<` or `>` anywhere in frontmatter | Angle brackets can inject into the system prompt |
| Only `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility` | Runtimes ignore unknown keys, so a typo would fail silently |

## Descriptions

The description is the only thing a runtime sees when deciding whether to load the skill. It must cover what the skill does and when it should fire, using words a user would actually type.

Weak: `Handles session cleanup.`

Strong: `Wraps up a work session: audits docs and test coverage for the session's changes, runs validation, then opens a pull request. Use when the user says they are done, finished, wrapping up, or invokes /done.`

## Cross-runtime bodies

Claude Code can spawn subagents in parallel; Copilot CLI cannot. State both paths rather than assuming one:

```markdown
Run both audits. If your runtime supports parallel subagents, spawn them
concurrently. Otherwise perform each inline, in sequence.
```

The same applies to tool names — describe the action ("read the file", "run the test command") rather than naming a tool only one runtime has.

## Bundled resources

A skill may ship supporting files beside `SKILL.md` in `references/`, `scripts/`, `templates/` or `assets/`, referenced by path relative to the skill directory. `tests/links.test.mjs` verifies every relative reference resolves, so a typo fails the build instead of producing a dead pointer at runtime.

Note that `scripts/install.mjs` copies only `.md`, `.txt`, `.json`, `.yaml` and `.yml`. Executable bundled resources will not be installed.

## Subagents

`.claude/agents/<name>.md`, with `name` matching the filename and a `description`. Claude Code also understands `tools` and `model`; Copilot understands `prompt`, `tools` and `mcp-servers`. Because the schemas do not overlap, `sync` copies only `name` and `description` into the `.github/agents/` stub and points the body at the canonical file.

Subagents are less portable than skills. Use one only when isolated context is genuinely required.

## Hooks

Read [.claude/hooks/README.md](../.claude/hooks/README.md) and [docs/security.md](security.md) first. Hooks run automatically on anyone who installs this config, so changes there require review under `CODEOWNERS` and must pass the checks in `tests/hygiene.test.mjs`.

## Before a PR

`/done` covers this. Manually:

```bash
npm run sync && npm run validate
```

Plus: no absolute home paths, no employer-specific content, docs updated to match behaviour.
