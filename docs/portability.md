# Portability

What loads where, and what follows from it.

## Support matrix

| Primitive | Claude Code | GitHub Copilot |
|---|---|---|
| Agent skills | `.claude/skills/<name>/SKILL.md` | `.github/skills/`, `.claude/skills/`, `.agents/skills/` |
| Instructions | `CLAUDE.md`, `.claude/CLAUDE.md` | `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` (CLI only); `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` (VS Code, github.com) |
| Subagents | `.claude/agents/*.md` | `.github/agents/*.md` |
| Slash commands / prompts | `.claude/commands/*.md` | `.github/prompts/*.prompt.md` — VS Code and Visual Studio only |
| Hooks | `.claude/hooks/` + `.claude/settings.json` | none |
| MCP servers | `.mcp.json` | `.mcp.json`, `.vscode/mcp.json` |

Personal-scope skills: `~/.claude/skills/` for Claude Code, `~/.copilot/skills/` or `~/.agents/skills/` for Copilot.

Sources: [customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet), [about agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [Copilot CLI custom agents](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents), [Copilot CLI custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions).

## Consequences

**`.claude/skills/` is canonical.** Copilot reads three skill directories, Claude Code reads one. `.claude/skills/` is the only path both load without a build step. A vendor-neutral `src/` or `.agents/skills/` would be worse — Claude Code would load nothing from it.

**Skills are the unit of authorship.** They port for free; subagents and prompt files do not. `.github/prompts/` also only helps VS Code and Visual Studio users, since Copilot CLI has no prompt-file support. CLI users reach a skill through description matching or by naming it.

**`.claude/commands/` is unused.** Claude Code exposes skills as `/<name>` already, so a command file would duplicate a skill with no consumer of its own. Copilot never reads that directory; the [feature request](https://github.com/github/copilot-cli/issues/302) was closed unimplemented.

## Bridging approach

Three options for getting content from `.claude/` to `.github/`:

| Approach | Verdict |
|---|---|
| Symlinks | Rejected. Require Developer Mode or admin rights on Windows. |
| CI job that copies files | Rejected. Fires only on push, so local checkouts stay stale; produces bot commits that collide with the `/done` PR flow; output is unverifiable before pushing; forces write permissions onto a read-only workflow. |
| Locally generated stubs, freshness-verified in CI | Chosen. Matches [`github/awesome-copilot`](https://github.com/github/awesome-copilot), whose CI fails if a build would modify a tracked file. |

Stubs contain only `name`/`description` frontmatter and a pointer line, so there is no substance that can semantically drift. Staleness is the only failure mode, and `npm run sync:check` catches it.

## Generated files

| Path | Source | Form |
|---|---|---|
| `.github/prompts/<name>.prompt.md` | `.claude/skills/<name>/SKILL.md` | Stub |
| `.github/agents/<name>.md` | `.claude/agents/<name>.md` | Stub, `name` + `description` only |
| `.github/copilot-instructions.md` | `AGENTS.md` | Full copy, relative links reparented |

The instructions file is a copy rather than a pointer because Copilot in VS Code reads it directly and will not follow a reference out of it. Agent stubs carry only two fields because the schemas differ: Claude Code uses `tools` and `model`, Copilot uses `prompt`, `tools` and `mcp-servers`.

Regenerate with `npm run sync`; verify with `npm run sync:check`.
