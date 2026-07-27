# Authoring guide

## Adding a skill

```bash
mkdir -p .claude/skills/my-skill
$EDITOR .claude/skills/my-skill/SKILL.md
npm run sync
npm test
```

`sync` generates the Copilot-side stub; `test` validates the frontmatter.

### Frontmatter

Skills follow the [Agent Skills specification](https://agentskills.io/specification). Only `name` and `description` are required.

```yaml
---
name: my-skill
description: Does the thing. Use when the user asks for the thing, mentions related-term, or is about to do adjacent-activity.
---
```

Enforced by `tests/skills.test.mjs`:

| Rule | Why |
|---|---|
| `name` equals the parent directory name | The skill silently fails to load otherwise |
| `name` is kebab-case, ≤64 chars, no leading/trailing hyphen | Spec requirement |
| `description` present, ≤1024 chars | Spec requirement |
| No `<` or `>` anywhere in frontmatter | Angle brackets can inject unintended instructions into the system prompt |
| Only spec keys: `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility` | Unknown keys are silently ignored by runtimes, so a typo fails quietly |

### Writing a good description

The description is the *only* thing a runtime sees when deciding whether to load your skill. It must answer both "what does this do" and "when should it fire". Include the words a user would actually type.

Weak: `Handles session cleanup.`
Strong: `Wraps up a work session: audits docs and test coverage for the session's changes, runs validation, then opens a pull request. Use when the user says they are done, finished, wrapping up, or invokes /done.`

### Bodies must degrade across runtimes

Claude Code can spawn subagents in parallel. Copilot CLI cannot. Do not assume either — say what to do in both cases:

```markdown
Run both audits. If your runtime supports parallel subagents, spawn them
concurrently. Otherwise perform each audit inline, in sequence.
```

Same for tool names. Prefer describing the action ("read the file", "run the test command") over naming a specific tool that only one runtime has.

### Bundled resources

A skill may ship supporting files alongside `SKILL.md` — `references/`, `scripts/`, `templates/`, `assets/`. Reference them by path relative to the skill directory. `tests/links.test.mjs` verifies every relative reference resolves on disk, so a typo fails the build rather than silently producing a dead pointer.

## Adding a subagent

Subagents live at `.claude/agents/<name>.md` and need `name` + `description` frontmatter. Claude Code additionally understands `tools` and `model`; Copilot understands `prompt`, `tools` and `mcp-servers`. The schemas do not overlap cleanly, so `sync` copies only `name` and `description` into the `.github/agents/` stub and points the body back at the canonical file.

Subagents are strictly less portable than skills. Reach for one only when you genuinely need isolated context — otherwise write a skill.

## Adding a hook

Read [docs/security.md](security.md) first. Hooks are shell that runs automatically on anyone who installs this config, which makes every hook change a privileged change.

`tests/hygiene.test.mjs` rejects hooks that pipe network fetches into a shell, `eval` fetched content, or reference absolute paths outside the repo. That is a floor, not a substitute for review.

## Checklist before opening a PR

Just run `/done` — it covers all of this. Manually, the equivalent is:

```bash
npm run sync && npm run validate
```

Plus: no absolute home paths, no work-internal content, docs updated to match behaviour.

