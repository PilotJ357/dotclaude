# Hooks

Shell that an agent runtime runs automatically at defined lifecycle points — session start, before and after tool use, agent stop, and others.

No hooks ship in this revision.

## Portability

Hooks are configured in `.claude/settings.json`, which all three runtimes read. Scripts referenced from it live in this directory.

Locations, file formats, event-name casing and which events have cross-runtime equivalents are stated once, with sources, in [docs/portability.md](../../docs/portability.md). Two authoring rules fall out of them: use the `command` field (not `bash` or `powershell`), and use PascalCase event names (`PreToolUse`, `SessionStart`, `Stop`).

## Why this directory is reviewed differently

Everything else in this repo is text an agent reads. These are commands a machine runs, on everyone who installs the config. `.claude/hooks/` is listed in `CODEOWNERS`.

## What the automated check rejects

`tests/hygiene.test.mjs` scans non-markdown files here for:

| Pattern | Detail |
|---|---|
| Network fetch piped to a shell | `curl`, `wget` or `fetch` into `sh`/`bash`/`zsh`/`ksh` |
| `eval` on dynamic content | `eval` followed by `$` or a backtick |
| `sudo` | any use |
| Absolute paths into `/usr`, `/etc`, `/opt`, `/var`, `/bin`, `/sbin` | shebang line exempt, so `#!/usr/bin/env bash` passes |

Markdown in this directory is documentation and is not scanned.

These catch known-bad shapes only. They do not replace reading the diff.

## Adding one

- No network access. Anything that needs the network belongs in CI, where egress is visible.
- Repo-relative paths only. Absolute paths break for everyone but the author.
- Fail open. A broken hook must not wedge someone's session.
- Prefer Node over shell. A `bash` script is a hook that breaks on Windows machines.
- Register it in `.claude/settings.json` in the same pull request, so the diff shows the code and its trigger together.

## Installation behaviour

`scripts/install.mjs` skips this directory unless given `--with-hooks`, which prints the file list before writing. Adopting `.claude/settings.json` is what activates hook execution.

The installer currently writes hooks to `~/.claude/` only. Copilot's user-scope hook directory (`~/.copilot/hooks/`) expects standalone `*.json` hook configs rather than the scripts kept here, so per-project use via `.claude/settings.json` is the supported cross-tool path.
