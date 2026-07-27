# Security policy

## Reporting

Report privately through [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository rather than opening a public issue.

This is a personal project maintained in spare time. Expect acknowledgement within a week; there is no formal SLA and no bounty.

## In scope

This repository distributes configuration that executes on the machine of anyone who installs it. Reports touching that path are in scope:

- Anything in `.claude/hooks/` that runs unexpected code, or a bypass of the checks in `tests/hygiene.test.mjs`.
- Path traversal or arbitrary write in `scripts/install.mjs`.
- Supply-chain weaknesses: an unpinned action, a dependency with install scripts, a route to getting an unreviewed package into the tree.
- Workflow misconfiguration leaking `GITHUB_TOKEN` or granting unintended write access.

## Out of scope

- **Prompt injection via skill or agent text.** Skill bodies are instructions you choose to trust at install time. A skill that instructs an agent to do something undesirable is a code review matter, not a vulnerability.
- Vulnerabilities in Claude Code, GitHub Copilot or Node — report those upstream.
- `npm audit` findings on dependencies this repo does not have. The tree is two packages; a larger one means something is wrong with the checkout.

## Before installing

Installing this configuration means agent runtimes read, and for hooks execute, its contents on your machine.

- Read `.claude/hooks/` in the revision you are installing before adopting `.claude/settings.json`. That directory ships no hooks currently.
- `node scripts/install.mjs --dry-run` prints every write without performing one.
- Hooks are installed only with `--with-hooks`.

Design rationale: [docs/security.md](docs/security.md).
