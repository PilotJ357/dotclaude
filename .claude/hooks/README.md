# Hooks

Shell that Claude Code runs automatically at defined lifecycle points. Copilot has no equivalent, so anything here is Claude Code only.

No hooks ship in this revision.

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
- Register it in `.claude/settings.json` in the same pull request, so the diff shows the code and its trigger together.

## Installation behaviour

`scripts/install.mjs` skips this directory unless given `--with-hooks`, which prints the file list before writing. Adopting `.claude/settings.json` is what activates hook execution.
