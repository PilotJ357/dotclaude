# Portability

The single place in this repo where runtime compatibility is stated. Every claim here carries a source. Nothing in `AGENTS.md`, a skill, or a subagent should assert what a runtime supports — put it here instead, so there is one file to correct when it turns out to be wrong.

## Support matrix

*Verified against the linked sources, July 2026.*

| Primitive | Claude Code | Copilot CLI | Copilot in VS Code |
|---|---|---|---|
| **Agent skills** | `.claude/skills/<name>/SKILL.md`, `~/.claude/skills/` | `.github/skills/`, **`.claude/skills/`**, `.agents/skills/`; `~/.copilot/skills/`, `~/.agents/skills/` | `.github/skills/`, **`.claude/skills/`**; `~/.copilot/skills/`, `~/.claude/skills/` (defaults of `chat.agentSkillsLocations`) |
| **Hooks** | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | **`.claude/settings.json`**, `.claude/settings.local.json`, `.github/hooks/*.json`, `.github/copilot/settings.json`, `.github/copilot/settings.local.json`, `~/.copilot/settings.json`, `~/.copilot/hooks/` | `.github/hooks/*.json`, **`.claude/settings.json`**, `.claude/settings.local.json`, `~/.claude/settings.json`, `~/.copilot/hooks/` |
| **Subagents** | `.claude/agents/*.md`, `~/.claude/agents/` | `.github/agents/*.agent.md`, `~/.copilot/agents/*.agent.md`, org and enterprise `/agents/` | `.github/agents/` (any `.md`), **`.claude/agents/`**, `~/.copilot/agents/` |
| **Spawning subagents** | Yes | Yes — `/agent`, automatic delegation, `/fleet` for parallel execution, concurrency and depth limits in `/settings` | Yes |
| **Instructions** | `CLAUDE.md`, `.claude/CLAUDE.md` | `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md` | `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.github/instructions/*.instructions.md`, `.claude/rules/` |
| **Prompt files** | `.claude/commands/*.md` | Marked unsupported in the cheat sheet — `/agent <name>` is the equivalent | `.github/prompts/*.prompt.md` |
| **MCP servers** | `.mcp.json` | `.mcp.json` | `.vscode/mcp.json`, user-profile `mcp.json` |

Bold marks a path both tool families read natively.

Sources: [customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet) · [agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) · [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) · [create custom agents for CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli) · [invoke custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents) · [custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) · [VS Code custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents) · [VS Code hooks](https://code.visualstudio.com/docs/agent-customization/hooks) · [VS Code custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions) · [VS Code agent skills](https://code.visualstudio.com/docs/agent-customization/agent-skills) · [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) · [VS Code AI settings reference](https://code.visualstudio.com/docs/agents/reference/ai-settings) · [Copilot CLI custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) · [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)

## Three shared surfaces

**`.claude/skills/`** — Copilot reads three skill directories, Claude Code reads one. This is the intersection, so it is canonical and skills are the preferred unit of authorship.

**`.claude/settings.json`** — the hooks reference states Copilot reads "cross-tool `.claude/settings.json` and `.claude/settings.local.json` files in the repository". VS Code parses the same format, converting Copilot's lowerCamelCase event names to PascalCase.

**`.claude/agents/`** — VS Code documents that it "also detects `.md` files in the `.claude/agents` folder, following the Claude sub-agents format. This enables you to use the same agent definitions across VS Code and Claude Code." Copilot CLI's documented agent sources are user, repository, organization and enterprise scopes — `.claude/agents/` is not among them (checked against the CLI agent pages linked above, July 2026) — so the generated `.github/agents/` stub exists for the CLI and for github.com.

## Details that bite

*Verified against the linked sources, July 2026.*

**Hooks.** Use the `command` field, not `bash` or `powershell` — those are Copilot and VS Code extensions. Use PascalCase event names (`SessionStart`, `PreToolUse`, `Stop`); Copilot CLI's native form is lowerCamelCase but it accepts PascalCase from Claude-format files. Copilot events that once had no Claude Code equivalent — `notification`, `permissionRequest`, `preCompact`, `subagentStart`, `postToolUseFailure` — now map to `Notification`, `PermissionRequest`, `PreCompact`, `SubagentStart` and `PostToolUseFailure` in the [Claude Code hooks reference](https://code.claude.com/docs/en/hooks). Only `errorOccurred` and `userPromptTransformed` remain Copilot-only; Claude Code's nearest events, `StopFailure` and `UserPromptExpansion`, have different semantics. Copilot loads hooks from policy, then user, then project, then plugins, and runs all matching hooks; policy hooks cannot be disabled by `disableAllHooks`.

**Subagent file extension.** GitHub's own documentation disagrees. The [CLI agent-creation page](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli) states "Each custom agent is defined by a Markdown file with an `.agent.md` extension", while the customization cheat sheet writes `.github/agents/AGENT-NAME.md`. VS Code documents `.agent.md` but "detects any `.md` files in the `.github/agents` folder". `.agent.md` satisfies every source, so `scripts/sync.mjs` generates that.

**Subagent precedence.** For Copilot CLI, a personal agent in `~/.copilot/agents/` wins over a repository agent of the same name.

**Frontmatter schemas differ.** Claude Code uses `tools` and `model`. Copilot's agent frontmatter — `tools`, `model`, `target`, `mcp-servers`, `user-invocable`, among others in the [configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration) — overlaps in keys but not in value vocabularies, and the prompt is the markdown body, not a field. Only `name` and `description` carry over, which is all `sync.mjs` and `install.mjs` copy.

**Prompt files** reach VS Code and Visual Studio users, with JetBrains IDEs and Xcode in preview. CLI users reach a skill by description matching or by naming it.

**`.claude/commands/` is unused here.** Claude Code exposes skills as `/<name>` already, so a command file would duplicate a skill with no consumer of its own. Copilot does not read that directory; the [feature request](https://github.com/github/copilot-cli/issues/302) was closed as completed — GitHub shipped custom agents invocable via `/agent` as the answer — and reading `.claude/commands/` itself never shipped.

## Bridging approach

| Approach | Verdict |
|---|---|
| Symlinks | Rejected. Require Developer Mode or admin rights on Windows. |
| CI job that copies files | Rejected. Fires only on push, so local checkouts stay stale; produces bot commits that collide with the `/done` PR flow; output is unverifiable before pushing; forces write permissions onto a read-only workflow. |
| Locally generated files, freshness-verified in CI | Chosen. Matches [`github/awesome-copilot`](https://github.com/github/awesome-copilot), whose CI fails if a build would modify a tracked file. |

Generated files carry the **full body**, not a pointer back to `.claude/`. A pointer costs the runtime an extra file read and breaks anywhere the relative path does not resolve. Because these files are generated and `sync:check` fails the build when they are stale, a full copy cannot drift either — only the frontmatter is rewritten, since the schemas genuinely differ.

## Generated files

| Path | Source | Frontmatter |
|---|---|---|
| `.github/prompts/<name>.prompt.md` | `.claude/skills/<name>/SKILL.md` | `description`, `agent` |
| `.github/agents/<name>.agent.md` | `.claude/skills/<name>/SKILL.md` | `name`, `description` |
| `.github/agents/<name>.agent.md` | `.claude/agents/<name>.md` | `name`, `description` |

No `.github/copilot-instructions.md` is generated: Copilot CLI reads `AGENTS.md` natively, and VS Code reads it by default (`chat.useAgentsMdFile`, default `true`), so copying the file would be a second source of truth for no consumer.

Each skill is emitted **twice**: as a prompt file, which gives VS Code and Visual Studio users `/<name>`, and as an agent, which gives Copilot CLI users `/agent <name>`. The CLI has no prompt-file support, so without the agent form a skill would only be reachable there by description matching. Because both skills and subagents land in `.github/agents/`, their names must be distinct; `sync.mjs` fails with a clear error on collision.

`scripts/install.mjs` performs the equivalent rewrite for home-directory installs, where `.claude/agents/...` would not resolve.

Regenerate with `npm run sync`; verify with `npm run sync:check`.
