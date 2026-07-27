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
| `node:test` instead of a framework | Vitest pulls esbuild, rollup and vite — over a hundred packages plus platform binaries fetched at install — to validate a handful of markdown files. |
| No frontmatter library | `gray-matter` pulls `section-matter`, `strip-bom-string` and `kind-of`. Splitting frontmatter is a regex; parsing is `js-yaml`. |

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
