# Security policy

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository. Please do not open a public issue for anything exploitable.

Expect an acknowledgement within a week. This is a personal project maintained in spare time — there is no formal SLA and no bounty.

## What is in scope

This repository distributes configuration that **executes on the machine of anyone who installs it**. Reports about that execution path are in scope:

- Anything in `.claude/hooks/` that runs unexpected code, or a way to bypass the hook safety checks in `tests/hygiene.test.mjs`.
- A path-traversal or arbitrary-write in `scripts/install.mjs`.
- A supply-chain weakness: an unpinned action, a dependency with install scripts, a way to get an unreviewed package into the tree.
- A workflow misconfiguration that leaks `GITHUB_TOKEN` or grants unintended write access.

## What is out of scope

- **Prompt injection through skill or agent text.** Skill bodies are instructions you are explicitly choosing to trust when you install them. Read them first. A skill that tells an agent to do something undesirable is a code-review issue, not a vulnerability.
- Vulnerabilities in Claude Code, GitHub Copilot, or Node itself — report those upstream.
- `npm audit` advisories on transitive dependencies that this repo does not have. The dependency tree is one package; if you are seeing a large tree, something is wrong with your checkout.

## Before you install

Installing this configuration means agent runtimes will read — and in the case of hooks, execute — its contents on your machine.

- Read `.claude/hooks/` before adopting `.claude/settings.json`. That directory is empty today; check it in whatever revision you are installing.
- `scripts/install.mjs --dry-run` prints exactly what it will write, without writing anything.
- Hooks are never installed unless you pass `--with-hooks`.

Design rationale for all of the above: [docs/security.md](docs/security.md).
