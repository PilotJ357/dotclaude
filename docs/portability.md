# Portability matrix

What actually loads where, and what it means for how this repo is laid out.

## Support matrix

| Primitive | Claude Code reads | GitHub Copilot reads | Shared? |
|---|---|---|---|
| **Agent skills** | `.claude/skills/<name>/SKILL.md` | `.github/skills/`, **`.claude/skills/`**, `.agents/skills/` | ✅ natively, no work required |
| Instructions | `CLAUDE.md`, `.claude/CLAUDE.md` | `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` (**CLI only**); `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` (VS Code, github.com) | ⚠️ partial |
| Subagents | `.claude/agents/*.md` | `.github/agents/*.md` only | ❌ |
| Slash commands / prompts | `.claude/commands/*.md` | `.github/prompts/*.prompt.md` — VS Code and Visual Studio only, **not Copilot CLI** | ❌ |
| Hooks | `.claude/hooks/` + `.claude/settings.json` | no equivalent | ❌ Claude Code only |
| MCP servers | `.mcp.json` | `.mcp.json`, `.vscode/mcp.json` | ⚠️ partial |

Sources: [customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet), [about agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [Copilot CLI custom agents](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents), [Copilot CLI custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions).

## What follows from it

### 1. `.claude/skills/` is the canonical home for skills

Not a vendor preference — the intersection. Copilot reads three skill directories; Claude Code reads exactly one. `.claude/skills/` is the only path both load without any build step. A vendor-neutral `src/` or `.agents/skills/` would be strictly worse, because Claude Code would then load nothing.

### 2. Skills are the preferred unit of authorship

Skills port for free. Subagents and prompt files do not. So anything that can be a skill should be a skill, and `.github/` gets thin generated stubs for the rest.

Note that `.github/prompts/` only helps VS Code and Visual Studio users — Copilot CLI has no prompt-file support at all. CLI users invoke skills by description-matching, or by asking for the skill by name.

### 3. `.claude/commands/` is deliberately unused

Claude Code already exposes skills as `/<name>`. A command file would be a second copy of a skill with no consumer that the skill does not already serve. Copilot never reads `.claude/commands/` — the [feature request for it](https://github.com/github/copilot-cli/issues/302) was closed unimplemented.

### 4. Stubs, not symlinks, not a CI copy job

Three options were considered for bridging `.claude/` → `.github/`:

- **Symlinks.** Git tracks them fine, but they require Developer Mode or administrator rights on Windows. Unacceptable for a repo meant to be used by other people. Rejected.
- **A GitHub Actions job that copies files.** Rejected: it only fires on push, so every local checkout has stale generated files; it produces bot commits that collide with the `/done` PR flow; you cannot verify the output before pushing; and it forces write permissions onto a workflow that should be read-only.
- **Locally generated pointer stubs, freshness-verified in CI.** Chosen. This is what [`github/awesome-copilot`](https://github.com/github/awesome-copilot) does — its CI fails if a build would modify any tracked file.

Because the stubs contain only `name`/`description` frontmatter plus a pointer line, they hold no substance that *can* semantically drift. The only failure mode is staleness, and `npm run sync:check` catches that.

## Generated file map

| Generated | From |
|---|---|
| `.github/prompts/<name>.prompt.md` | `.claude/skills/<name>/SKILL.md` |
| `.github/agents/<name>.md` | `.claude/agents/<name>.md` |
| `.github/copilot-instructions.md` | `AGENTS.md` (full copy — VS Code Copilot will not follow a pointer) |

Regenerate with `npm run sync`. Verify with `npm run sync:check`.
