# Hooks

Empty in this revision. Read this before adding anything.

## Why this directory is different

Hooks are shell scripts that an agent runtime executes **automatically**, often without prompting the user. Every other file in this repository is text an agent reads. These are commands a machine runs.

That makes `.claude/hooks/` the highest-risk surface here, and every change to it a privileged change. It is listed in `CODEOWNERS` for that reason.

Copilot has no hook equivalent, so anything placed here is Claude Code only.

## Automated floor

`tests/hygiene.test.mjs` scans every non-markdown file in this directory and fails the build on:

- a network fetch piped into a shell interpreter
- `eval` applied to fetched or otherwise dynamic content
- absolute paths pointing outside the repository, ignoring the shebang line so `#!/usr/bin/env bash` is fine
- `sudo`

Markdown in this directory is documentation and is not scanned — it describes these patterns, so scanning it would guarantee a false positive.

That is a floor, not a review. It catches obvious shapes and nothing more — it will not stop a determined author, and passing it is not evidence a hook is safe.

## Rules for adding one

1. Keep it short enough to read in one sitting. A hook nobody reads is a hook nobody vetted.
2. No network access. If a hook needs something from the network, it belongs in CI where the egress is visible, not on a contributor's machine.
3. Fail open, not closed — a broken hook should not wedge someone's session.
4. Use paths relative to the repository. Absolute paths break for everyone but you and trip the hygiene check.
5. Register it in `.claude/settings.json` in the same pull request, so the diff shows both the code and its trigger.

## For people installing this repo

`scripts/install.mjs` does **not** install hooks unless you pass `--with-hooks`, and it prints a warning when you do. Adopting `.claude/settings.json` is what activates hook execution — read this directory in whatever revision you are installing before doing that.

Full rationale: [docs/security.md](../../docs/security.md).
