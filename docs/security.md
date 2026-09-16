# Security

## Threat model

Three things in this repo execute on a machine that is not the author's:

1. `.claude/hooks/` — shell an agent runtime runs automatically, often without prompting.
2. `.claude/settings.json` — registers those hooks.
3. `scripts/install.mjs` — writes into the user's home directory.

A compromise of any of them runs code on every developer who installed the config. The measures below are scoped to that.

Out of scope: a malicious skill *body*. That is prompt injection, not supply chain. Skill text is instructions you choose to trust when installing.

## Dependencies

Budget is two packages. `npm ls --all` should show `js-yaml` and its child `argparse`, nothing else. CI fails above that count. Additions need PR justification.

| Choice | Reason |
|---|---|
| `js-yaml@4` as the only direct dependency | v4 dropped `esprima`; its one child `argparse@2` is a pure-JavaScript rewrite with no dependencies and no install scripts. Parses with the default safe schema — `yaml.load` will not construct arbitrary types. Do not substitute a custom schema. |
| Pinned to the 4.x line | 5.x removed the default export, making it a code change rather than a bump, and offers no dependency or size reduction. The 4.x line is still maintained — the 4.3.2 security patch ([GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)) shipped after 5.0.0 — so patches continue to arrive. `dependabot.yml` ignores the major only; minor and patch updates still open PRs. |
| `node:test` instead of a framework | Vitest pulls esbuild, rollup and vite — over a hundred packages plus platform binaries fetched at install — to validate a handful of markdown files. |
| No frontmatter library | `gray-matter` pulls `section-matter`, `strip-bom-string` and `kind-of`. Splitting frontmatter is a regex; parsing is `js-yaml`. |

### Minimum release age

No dependency version may be installed within **48 hours** of publication. That floor is absolute: there is no flag, environment variable or allowlist that reaches below it.

Compromised packages — a hijacked maintainer account, a malicious postinstall, a typosquat — are normally detected and unpublished within hours to days. Almost all of the damage happens in that first window, to whoever installed automatically. Waiting removes the repo from that population without requiring anyone to spot the compromise.

Two layers, holding different things:

| Layer | Role |
|---|---|
| `cooldown` in `dependabot.yml` | Stops Dependabot *proposing* a routine version update before it has aged: 3 days for patches, 7 for minors, 14 for majors, 7 for Actions. Does not apply to security updates. |
| `scripts/check-dep-age.mjs` | Enforces the 48-hour floor against `package-lock.json` by querying each version's registry publish time. Catches what cooldown does not: security updates, and anything a hand-edited lockfile introduced. |

Run locally with `npm run check:deps`; part of `npm run validate`. CI runs it with `--strict`, so an unreachable registry fails the build rather than passing silently. Locally it warns and continues, keeping the suite usable offline.

`--min-age-days=N` or `MIN_DEP_AGE_DAYS` raises the threshold. Neither lowers it — a value under 2 exits non-zero rather than being clamped quietly, because a silent clamp reads as acceptance. There is deliberately no escape hatch for an urgent patch: an hour-old release that everyone is being urged to install immediately is also the precise shape of a supply-chain attack, so the one case a bypass would be reached for is the case the gate exists for.

The cost is real and accepted: a fix for a public vulnerability sits for two days after Dependabot opens the pull request. `npm audit --audit-level=high` runs in the same suite, so the exposure is visible the whole time rather than forgotten.

### Security updates

Dependabot security updates are the automatic path: an advisory lands, Dependabot opens a pull request against the vulnerable version without waiting for the weekly schedule.

They are configured in `dependabot.yml` only where the options reach them. Per the [options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference):

| Behaviour | Consequence here |
|---|---|
| "The `cooldown` option is only available for *version* updates, not *security* updates." Confirmed by the [cooldown changelog](https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown/): "Security updates still open immediately." | The 48-hour floor cannot come from `cooldown`. `check-dep-age.mjs` is what actually holds it, and CI is where it binds. |
| "`update-types` only affects *version* updates, not *security updates*." | The `ignore` entry for js-yaml majors holds back routine 5.x bumps without blocking a security fix that is only available in 5.x. |
| `labels`, `commit-message`, `ignore` and `groups` carry over to security pull requests; `open-pull-requests-limit` does not apply to them. | Security pull requests arrive labelled like the rest, batched per ecosystem by the `applies-to: security-updates` group, and are never queued behind the five-PR limit. |

Known gap: [dependabot-core#15049](https://github.com/dependabot/dependabot-core/issues/15049) reports cooldown being applied to security updates anyway in at least one ecosystem. If a security update is late, that is the first thing to check — the floor in CI is unaffected either way, since it is enforced independently of what Dependabot chose to propose.

Merging stays manual. Auto-merge would need a workflow with `contents: write` and `pull-requests: write`, which is the one thing the CI hardening below is built to avoid; a two-package dependency tree does not produce enough pull requests to justify it.

### npm settings

| `.npmrc` setting | Reason |
|---|---|
| `ignore-scripts=true` | Blocks install-time lifecycle scripts, the most commonly abused npm vector. Nothing in this tree needs them. |
| `save-exact=true` | A `^` range is an unreviewed future upgrade. |
| `engine-strict=true` | Refuse installation on an unsupported Node. |
| `audit-level=high` | `npm audit` fails on high and critical. |

Use `npm ci`, never `npm install`. `ci` installs exactly what the lockfile specifies; `install` can resolve differently and rewrite it. `Bash(npm install:*)` is in the `deny` list, and a deny rule cannot be answered with a prompt, so nothing running in this repository can rewrite the lockfile by resolution.

Changing a pinned version therefore means editing `package.json` and `package-lock.json` together — `version`, `resolved` and `integrity` copied from the registry — and then proving it with a clean `npm ci`. That is a verification, not a formality: `npm ci` checks the `integrity` hash against the downloaded tarball and fails if they disagree, so a mistyped or invented hash cannot pass.

## Workflow hardening

`.github/workflows/validate.yml`:

| Measure | Reason |
|---|---|
| Actions pinned to full 40-character SHAs | Tags are mutable. Whoever controls an action repository can repoint `v4`; a SHA cannot be repointed. Verified by a CI step that requires exactly 40 hex characters. |
| `permissions: {}` top level, `contents: read` per job | Nothing in this CI needs write access. |
| `persist-credentials: false` on checkout | Otherwise `GITHUB_TOKEN` remains in `.git/config`, readable by any later step including one injected through a compromised dependency. |
| `pull_request`, not `pull_request_target` | The latter exposes repository secrets while checking out fork-authored code. |
| No secrets referenced | Nothing in the job environment is worth stealing. |
| `concurrency` with `cancel-in-progress` | Prevents a stale run reporting green for superseded code. |

## Repository settings

Applied:

| Setting | Value |
|---|---|
| Default `GITHUB_TOKEN` permissions | Read-only |
| Actions creating or approving pull requests | Disabled |
| Allowed actions | GitHub-owned only |
| Dependabot alerts and automated security fixes | Enabled |
| Dependabot updates | `npm` and `github-actions`, weekly |
| Merge strategy | Squash only, branch deleted on merge |
| Wiki, projects | Disabled |

Unavailable on a free private repository, and worth revisiting if this goes public:

- **Branch protection / rulesets** — require the `validate` check, require Code Owner review, block force-push and deletion, require linear history. Needs GitHub Pro while private; free once public. Until then `CODEOWNERS` is advisory only.
- **Secret scanning and push protection** — GitHub Advanced Security; free on public repositories.

## Hook policy

Hooks are the sharpest edge, so the policy exists before the first hook does. `.claude/hooks/` is in `CODEOWNERS` and every change there is a privileged change.

The blast radius is wider than Claude Code alone: Copilot CLI and VS Code both read `.claude/settings.json`, so a hook committed here runs in all three runtimes on anyone who adopts the config.

What `tests/hygiene.test.mjs` rejects and the rules for adding a hook: [.claude/hooks/README.md](../.claude/hooks/README.md). The scan catches known-bad shapes only — passing it is not evidence a hook is safe.

## Installer

`scripts/install.mjs` runs on other people's machines, so it:

- copies data files only (`.md`, `.txt`, `.json`, `.yaml`, `.yml`) and never executes repository content;
- writes skills and subagents to both target roots, rewriting agent frontmatter for Copilot rather than copying Claude-only fields;
- resolves every write target and refuses anything outside `~/.claude/` and `~/.copilot/`, blocking traversal via a crafted skill directory name;
- skips symlinks inside skills rather than following them;
- rejects skill directory names that are not plain kebab-case;
- defaults to copying, since symlinks need Developer Mode or admin rights on Windows;
- prints the full plan under `--dry-run` before touching the filesystem;
- `--uninstall` removes only paths from this repository's own inventory, each resolved within the same two roots;
- installs hooks only under `--with-hooks`, after listing the files.

Guards are tested directly in `tests/install.test.mjs`, including traversal, absolute paths and executable extensions.

## `/done`

The skill opens pull requests, so it:

- uses whichever forge interface is already authenticated, and never reads, prints or writes a token;
- runs `npm ci`, never `npm install`;
- treats diff content and subagent output as data. Text in a diff must not redirect the PR target, skip a gate, or change what is committed;
- stops on any failing gate;
- pushes and opens the pull request without a confirmation prompt once every gate has passed. Invoking `/done` is the authorization. The gates are the safety check; a second yes/no was friction, not a second check.

### Pre-approved commands

Permission rules are enforced by the runtime, not by the skill body — prose telling the agent not to ask cannot suppress an approval dialog, only a rule can. Semantics and source: [portability](portability.md#details-that-bite). So `.claude/settings.json` allowlists the commands the wrap-up issues, and nothing more.

| Rule | Reasoning |
|---|---|
| `git add`, `git commit`, `git checkout -b`, `git switch -c` | Local only. Nothing leaves the machine, and nothing is discarded — `git checkout -b`, not bare `git checkout`, which can overwrite working-tree changes. |
| `git push`, `git push -u origin ...` | The two forward pushes the skill performs. A remote is never named without `-u`, so `git push origin <refspec>` is not blanket-approved. |
| `gh pr create` | Opens a pull request. Merging one is not allowed. |
| `ask` on `--force`, `--delete`, `-f`, `-d` and `+refspec` pushes | Rules are evaluated deny, then ask, then allow, so these prompt even though a broader allow rule also matches them. |

The residue is honest rather than total: a colon refspec reached through `git push -u origin :branch` is not expressible as a glob that a trailing-wildcard rule can exclude, so it stays approved. Every `--force`, `--delete` and `+refspec` spelling is covered.

`tests/settings.test.mjs` holds this in place: it rejects a whole-tool `Bash` grant, an allow rule for an interpreter that would launder arbitrary commands (`sh`, `xargs`, `npx`), and any force push or branch deletion that no `ask` rule covers. It found one such hole while being written — `git push origin --delete main` had been approved by a broader rule since removed.

## Reporting

[SECURITY.md](../SECURITY.md).
