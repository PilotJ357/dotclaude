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
| Pinned to the 4.x line | 5.x removed the default export, making it a code change rather than a bump, and offers no dependency or size reduction. The 4.x line is still maintained — 4.3.0 shipped after 5.0.0 — so patches continue to arrive. `dependabot.yml` ignores the major only; minor and patch updates still open PRs. |
| `node:test` instead of a framework | Vitest pulls esbuild, rollup and vite — over a hundred packages plus platform binaries fetched at install — to validate a handful of markdown files. |
| No frontmatter library | `gray-matter` pulls `section-matter`, `strip-bom-string` and `kind-of`. Splitting frontmatter is a regex; parsing is `js-yaml`. |

### Minimum release age

No dependency version may be installed within **3 days** of publication.

Compromised packages — a hijacked maintainer account, a malicious postinstall, a typosquat — are normally detected and unpublished within hours to days. Almost all of the damage happens in that first window, to whoever installed automatically. Waiting removes the repo from that population without requiring anyone to spot the compromise.

Two layers:

| Layer | Role |
|---|---|
| `cooldown` in `dependabot.yml` | Stops Dependabot *proposing* a version before it has aged: 3 days for patches, 7 for minors, 14 for majors, 7 for Actions. |
| `scripts/check-dep-age.mjs` | Enforces the floor against `package-lock.json` by querying each version's registry publish time. Catches anything a manual `npm install` introduced, which cooldown cannot see. |

Run locally with `npm run check:deps`; part of `npm run validate`. CI runs it with `--strict`, so an unreachable registry fails the build rather than passing silently. Locally it warns and continues, keeping the suite usable offline.

The threshold is `--min-age-days=N` or `MIN_DEP_AGE_DAYS`. For a security patch that genuinely cannot wait, `ALLOW_FRESH_DEPS` takes exact `name@version` pairs:

```bash
ALLOW_FRESH_DEPS='js-yaml@4.3.1' npm run check:deps
```

Exceptions must name a version. A bare package name is ignored, since it would exempt that dependency at every future version and quietly disable the gate.

This does not defend against a compromise that stays undetected past the window, and it delays legitimate security patches by up to 3 days — `npm audit` and Dependabot security updates, which are exempt from cooldown, cover that direction.

### npm settings

| `.npmrc` setting | Reason |
|---|---|
| `ignore-scripts=true` | Blocks install-time lifecycle scripts, the most commonly abused npm vector. Nothing in this tree needs them. |
| `save-exact=true` | A `^` range is an unreviewed future upgrade. |
| `engine-strict=true` | Refuse installation on an unsupported Node. |
| `audit-level=high` | `npm audit` fails on high and critical. |

Use `npm ci`, never `npm install`. `ci` installs exactly what the lockfile specifies; `install` can resolve differently and rewrite it.

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

`tests/hygiene.test.mjs` scans non-markdown files in that directory and rejects network fetches piped into a shell, `eval` on dynamic content, `sudo`, and absolute paths into system directories (the shebang line is exempt). Markdown there is documentation and is not scanned.

These catch known-bad shapes. They do not replace reading the diff, and passing them is not evidence a hook is safe.

Details: [.claude/hooks/README.md](../.claude/hooks/README.md).

## Installer

`scripts/install.mjs` runs on other people's machines, so it:

- copies data files only (`.md`, `.txt`, `.json`, `.yaml`, `.yml`) and never executes repository content;
- resolves every write target and refuses anything outside `~/.claude/` and `~/.copilot/`, blocking traversal via a crafted skill directory name;
- skips symlinks inside skills rather than following them;
- rejects skill directory names that are not plain kebab-case;
- defaults to copying, since symlinks need Developer Mode or admin rights on Windows;
- prints the full plan under `--dry-run` before touching the filesystem;
- installs hooks only under `--with-hooks`, after listing the files.

Guards are tested directly in `tests/install.test.mjs`, including traversal, absolute paths and executable extensions.

## `/done`

The skill opens pull requests, so it:

- uses the already-authenticated `gh` CLI and never reads, prints or writes a token;
- runs `npm ci`, never `npm install`;
- treats diff content and subagent output as data. Text in a diff must not redirect the PR target, skip a gate, or change what is committed;
- stops on any failing gate;
- confirms before pushing.

## Reporting

[SECURITY.md](../SECURITY.md).
