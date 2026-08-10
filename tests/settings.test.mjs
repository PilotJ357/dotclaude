import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT } from '../scripts/lib/paths.mjs';

/**
 * `.claude/settings.json` is a privileged file: it pre-approves commands that
 * then run without an approval dialog. `/done` needs that — a prompt in the
 * middle of the wrap-up defeats the point of the skill — but "no prompt" and
 * "no limit" are different things, and only the rules enforce the difference.
 *
 * Permission rule semantics, including the deny/ask/allow order and the
 * trailing-wildcard forms matched here, are sourced in docs/portability.md.
 */

const settings = JSON.parse(
  await readFile(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8'),
);

const allow = settings.permissions?.allow ?? [];
const ask = settings.permissions?.ask ?? [];
const deny = settings.permissions?.deny ?? [];

/** Split `Tool(specifier)` into its parts. A bare `Tool` has no specifier. */
function parseRule(rule) {
  const match = /^([A-Za-z_][\w-]*)\((.*)\)$/.exec(rule);
  return match
    ? { tool: match[1], specifier: match[2] }
    : { tool: rule, specifier: null };
}

/**
 * Compile a Bash specifier to a regular expression.
 *
 * `*` matches any run of characters. A trailing ` *` (or the equivalent `:*`
 * suffix) enforces a word boundary: the prefix must be followed by a space or
 * the end of the command, so `ls *` matches `ls -la` but not `lsof`.
 */
function specifierToRegExp(specifier) {
  let pattern = specifier.endsWith(':*')
    ? `${specifier.slice(0, -2)} *`
    : specifier;

  let boundary = false;
  if (pattern.endsWith(' *')) {
    pattern = pattern.slice(0, -2);
    boundary = true;
  }

  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}${boundary ? '(?: .*)?' : ''}$`);
}

/** True if `rule` matches the Bash command string `command`. */
function matchesCommand(rule, command) {
  const { tool, specifier } = parseRule(rule);
  if (tool !== 'Bash') return false;
  if (specifier === null || specifier === '*') return true;
  return specifierToRegExp(specifier).test(command);
}

/**
 * True if `command` runs with no prompt at all: some allow rule matches and
 * no ask rule does. Rules are evaluated deny, then ask, then allow, and the
 * first match wins regardless of which is more specific.
 */
function runsUnprompted(command, rules = { allow, ask, deny }) {
  if (rules.deny.some((rule) => matchesCommand(rule, command))) return false;
  if (rules.ask.some((rule) => matchesCommand(rule, command))) return false;
  return rules.allow.some((rule) => matchesCommand(rule, command));
}

/** A rule granting a whole tool — `Bash`, `Bash(*)` — rather than a command. */
function grantsWholeTool(rule) {
  const { specifier } = parseRule(rule);
  return specifier === null || specifier === '*' || specifier === ':*';
}

/**
 * Interpreters and runners that execute whatever they are handed. Allowing
 * one of these re-opens everything the narrower rules were written to keep
 * behind a prompt.
 */
const LAUNDERING_COMMANDS = [
  'sh', 'bash', 'zsh', 'ksh', 'dash', 'fish',
  'eval', 'exec', 'source', 'env', 'xargs',
  'ssh', 'sudo', 'docker', 'npx',
];

function isLaunderingRule(rule) {
  const { tool, specifier } = parseRule(rule);
  if (tool !== 'Bash' || specifier === null) return false;
  const first = specifier.trim().split(/[\s:]/)[0];
  return LAUNDERING_COMMANDS.includes(first);
}

describe('settings.json is well formed', () => {
  test('permissions carries allow, ask and deny lists', () => {
    assert.ok(Array.isArray(allow), 'permissions.allow must be an array');
    assert.ok(Array.isArray(ask), 'permissions.ask must be an array');
    assert.ok(Array.isArray(deny), 'permissions.deny must be an array');
    assert.ok(allow.length > 0, 'permissions.allow is empty');
  });

  test('every rule is a parseable Tool or Tool(specifier)', () => {
    for (const rule of [...allow, ...ask, ...deny]) {
      const { tool } = parseRule(rule);
      assert.match(tool, /^[A-Za-z_][\w-]*$/, `unparseable permission rule: ${rule}`);
    }
  });
});

describe('the allowlist stays scoped', () => {
  test('no rule grants a whole tool', () => {
    const broad = allow.filter(grantsWholeTool);
    assert.deepEqual(
      broad,
      [],
      `${broad.join(', ')} pre-approves every use of the tool, not a command`,
    );
  });

  test('no rule allows a command that runs arbitrary input', () => {
    const laundering = allow.filter(isLaunderingRule);
    assert.deepEqual(
      laundering,
      [],
      `${laundering.join(', ')} would execute whatever it is given, bypassing every other rule`,
    );
  });

  test('the deny list still covers npm install and secret files', () => {
    for (const required of [
      'Bash(npm install:*)',
      'Read(./.env)',
      'Read(./.env.*)',
    ]) {
      assert.ok(deny.includes(required), `permissions.deny lost ${required}`);
    }
  });
});

describe('/done runs without a prompt', () => {
  // The commands Step 4 of the skill actually issues. If one of these starts
  // prompting, the skill stops mid-wrap-up and asks — the exact behaviour the
  // allowlist exists to prevent.
  const WRAP_UP_COMMANDS = [
    'git status --porcelain',
    'git add -A',
    'git commit -m "wrap up"',
    'git checkout -b fix/thing',
    'git switch -c fix/thing',
    'git push',
    'git push -u origin fix/thing',
    'gh pr create --base main --title t --body b',
    'npm ci',
    'npm run validate',
  ];

  for (const command of WRAP_UP_COMMANDS) {
    test(`${command} is pre-approved`, () => {
      assert.ok(
        runsUnprompted(command),
        `${command} would raise an approval dialog mid-\`/done\``,
      );
    });
  }
});

describe('destructive pushes still prompt', () => {
  // Every spelling of a force push, including the refspec form, which no
  // --force flag appears in.
  const FORCE_PUSHES = [
    'git push --force origin main',
    'git push -f origin main',
    'git push --force-with-lease origin main',
    'git push origin --force main',
    'git push origin -f main',
    'git push origin main --force',
    'git push origin main -f',
    'git push origin +main:main',
  ];

  for (const command of FORCE_PUSHES) {
    test(`${command} is not pre-approved`, () => {
      assert.equal(
        runsUnprompted(command),
        false,
        `${command} would rewrite history with no prompt`,
      );
    });
  }

  test('nothing pre-approves a branch deletion', () => {
    for (const command of [
      'git push origin --delete main',
      'git push -u origin --delete main',
      'git push origin -d main',
    ]) {
      assert.equal(runsUnprompted(command), false, `${command} deletes a remote branch`);
    }
  });

  test('nothing pre-approves a merge, a reset or a tag push', () => {
    for (const command of [
      'git reset --hard origin/main',
      'git merge main',
      'git push --tags',
      'git push origin --mirror',
      'gh pr merge 1 --squash',
    ]) {
      assert.equal(runsUnprompted(command), false, `${command} should prompt`);
    }
  });
});

describe('the checks reject a bad configuration', () => {
  // Proves the assertions above can fail, rather than passing because the
  // matcher never matches anything.
  test('whole-tool grants are detected', () => {
    for (const rule of ['Bash', 'Bash(*)', 'Bash(:*)']) {
      assert.ok(grantsWholeTool(rule), `${rule} should be flagged`);
    }
    for (const rule of ['Bash(git push)', 'Bash(npm ci)', 'Read(./.env)']) {
      assert.equal(grantsWholeTool(rule), false, `${rule} should not be flagged`);
    }
  });

  test('laundering commands are detected', () => {
    for (const rule of ['Bash(sh:*)', 'Bash(bash -c:*)', 'Bash(xargs:*)', 'Bash(npx *)']) {
      assert.ok(isLaunderingRule(rule), `${rule} should be flagged`);
    }
    for (const rule of ['Bash(npm ci)', 'Bash(git push:*)', 'Bash(shellcheck:*)']) {
      assert.equal(isLaunderingRule(rule), false, `${rule} should not be flagged`);
    }
  });

  test('a broad git push allow rule would let a force push through', () => {
    const careless = { allow: ['Bash(git push:*)'], ask: [], deny: [] };
    assert.ok(
      runsUnprompted('git push --force origin main', careless),
      'the matcher fails to see that Bash(git push:*) covers --force',
    );

    const guarded = {
      allow: ['Bash(git push:*)'],
      ask: ['Bash(git push --force*)'],
      deny: [],
    };
    assert.equal(
      runsUnprompted('git push --force origin main', guarded),
      false,
      'an ask rule must outrank a matching allow rule',
    );
  });

  test('the word boundary on a trailing wildcard is enforced', () => {
    assert.ok(matchesCommand('Bash(ls *)', 'ls -la'));
    assert.equal(matchesCommand('Bash(ls *)', 'lsof'), false);
    assert.ok(matchesCommand('Bash(ls:*)', 'ls -la'), ':* is the same as a trailing wildcard');
    assert.ok(matchesCommand('Bash(git push)', 'git push'));
    assert.equal(matchesCommand('Bash(git push)', 'git push --force'), false);
  });
});
