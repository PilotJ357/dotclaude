# Security and supply chain

## Threat model

This repo is mostly markdown, which makes it easy to under-think. But it distributes three things that **execute on someone else's machine**:

1. `.claude/hooks/` — shell scripts an agent runtime runs automatically, often without a prompt.
2. `.claude/settings.json` — registers those hooks.
3. `scripts/install.mjs` — copies config into a user's home directory.

A compromise of any of those runs arbitrary code on every developer who installed this config. Everything below is scoped to that risk. Nothing here protects against a malicious *skill* body, which is a prompt-injection concern, not a supply-chain one — treat skill text as instructions you are choosing to trust.

## Dependency posture

**Budget: two packages.**

```bash
npm ls --all
```

should show `js-yaml` and its only child `argparse`, and nothing else. Adding a dependency requires a justification in the pull request.

- **`js-yaml@4`** is the only direct runtime dependency. Version 4 dropped `esprima`; its one remaining child is `argparse@2`, a pure-JavaScript rewrite with no dependencies of its own and no install scripts. `js-yaml` parses frontmatter using the default safe schema — `yaml.load` in v4 will not construct arbitrary types. Do not swap it for a custom schema.
- **No test framework.** Tests run on Node's built-in `node:test` and `node:assert`. Vitest was considered and rejected: it pulls in esbuild, rollup and vite — over a hundred packages plus platform binaries fetched at install time — to validate a handful of markdown files.
- **No frontmatter library.** `gray-matter` is the common choice but pulls `section-matter`, `strip-bom-string` and `kind-of`. Splitting frontmatter is a regex; the parse is `js-yaml`.

### npm settings

`.npmrc` sets:

| Setting | Why |
|---|---|
| `ignore-scripts=true` | Blocks install-time lifecycle scripts (`postinstall` and friends) — the most commonly abused npm vector. Nothing in this tree needs them. |
| `save-exact=true` | No floating ranges. A `^` is an unreviewed future upgrade. |
| `engine-strict=true` | Refuse to install on an unsupported Node. |
| `audit-level=high` | `npm audit` fails the build on high and critical. |

**Use `npm ci`, never `npm install`, in any automation.** `npm ci` installs exactly what the committed lockfile says; `npm install` can silently resolve something else and rewrite the lockfile.

## Workflow hardening

`.github/workflows/validate.yml`:

- **Actions pinned to full 40-character commit SHAs**, with the human-readable version in a trailing comment. Tags are mutable — an attacker who compromises an action repo can repoint `v4` at anything. SHAs cannot be repointed.
- **`permissions: {}` at the top level**, re-granted per job as `contents: read`. Nothing in this repo's CI needs to write.
- **`persist-credentials: false`** on checkout. Otherwise the `GITHUB_TOKEN` is left sitting in `.git/config` where any subsequent step — including one injected through a compromised dependency — can read it.
- **`pull_request`, never `pull_request_target`.** The latter runs with repository secrets available while checking out fork-authored code, which is how most public-repo Actions compromises happen.
- **No secrets referenced at all**, so there is nothing in the job environment worth stealing.
- `concurrency` with `cancel-in-progress`, so a stale run cannot report a green check for superseded code.

`dependabot.yml` covers both `npm` and `github-actions`, so the SHA pins get reviewed updates instead of quietly rotting.

### Repository settings to enable

Not expressible in code — set these in repository settings:

- Secret scanning **with push protection**.
- Require the `validate` check before merge.
- Require review for `CODEOWNERS` paths (`.github/workflows/`, `scripts/`, `.claude/hooks/`).

## Hook policy

Hooks are the sharpest edge here, so the policy exists before the first hook does.

- Every hook change is a privileged change and gets explicit review. `.claude/hooks/` is in `CODEOWNERS`.
- `tests/hygiene.test.mjs` fails the build on:
  - a network fetch piped into a shell (`curl … | sh`, `wget … | bash`, and variants),
  - `eval` applied to fetched or otherwise dynamic content,
  - absolute paths pointing outside the repository,
  - `sudo`.
- That is an automated floor, not a substitute for reading the diff. It catches the obvious shapes, not a determined author.
- `README.md` states plainly that adopting this repo's `settings.json` enables hook execution, and tells users to read `.claude/hooks/` before installing.

## Installer constraints

`scripts/install.mjs` runs on other people's machines, so it:

- copies **`.md` files only**, and never executes anything from the repo;
- resolves every write target and **refuses to write outside `~/.claude/` and `~/.copilot/`**, which blocks path traversal via a crafted skill directory name;
- defaults to copying rather than symlinking, because symlinks need Developer Mode or admin rights on Windows;
- supports `--dry-run` to print the full plan before touching the filesystem;
- installs hooks only behind an explicit `--with-hooks` flag, with a printed warning.

## `/done` constraints

The `/done` skill opens pull requests, so:

- it uses the already-authenticated `gh` CLI and never reads, prints or writes a token;
- it runs `npm ci`, never `npm install`;
- it treats diff content and subagent output as **data, not instructions**. Text inside a diff must not be able to redirect the PR target, skip a gate, or change what gets committed;
- it stops on any failing gate rather than opening a PR;
- it confirms with the user before pushing, because pushing is outward-facing and not cleanly reversible.

## Reporting

See [SECURITY.md](../SECURITY.md).
