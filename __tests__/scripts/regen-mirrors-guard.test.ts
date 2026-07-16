/**
 * regen-mirrors-guard.test.ts — clone/re-clone GUARD decision tests for
 * `scripts/regen-mirrors.sh` (bl-482, ID-160.1).
 *
 * Drives the REAL script via `spawnSync` against a synthetic fixture repo (a
 * copy of the script under `<fixture>/scripts/regen-mirrors.sh`, so the
 * script's own self-located `REPO` resolves to the fixture root) — never
 * reimplemented in TS (test-philosophy: behaviour, not implementation).
 *
 * A PATH-shadowed `git` wrapper intercepts ONLY the `clone` subcommand — it
 * fabricates a REAL local git repo (init + commit + tag) in place of a
 * network clone, so tests never hit github.com and never trigger the
 * `bun install` that follows a genuinely fresh clone (task-view's deps need
 * the npm registry, which is outside this sandbox's network allowlist).
 * Every OTHER git subcommand (notably `rev-parse`, which the drift check
 * uses) delegates straight to the real system git, so the HEAD-vs-tag
 * comparison is genuine.
 *
 * `KH_PRIVATE_DOCS_DIR` is deliberately left UNSET: the script fails loud on
 * the ledger-dir resolution immediately AFTER the clone/guard decision —
 * exactly the boundary these tests assert on — without needing the full
 * ledger-mirror-regeneration pipeline to run.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  lstatSync,
  existsSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT_SRC = join(REPO_ROOT, 'scripts/regen-mirrors.sh');
const TAG = 'v0.12.1-task-view';

const REAL_GIT =
  spawnSync('command', ['-v', 'git'], {
    shell: '/bin/bash',
    encoding: 'utf8',
  }).stdout.trim() || '/usr/bin/git';

let cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

function gitRun(args: string[], cwd: string): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${r.stderr}`);
  }
}

/** Seed a REAL (non-fake) local git repo directly — used to construct
 *  "already present" fixture states without routing through the script's own
 *  (shimmed) clone step. */
function makeRealGitRepoAt(
  dir: string,
  opts: { tag?: string; marker?: string } = {},
): void {
  mkdirSync(dir, { recursive: true });
  gitRun(['init', '-q'], dir);
  if (opts.marker !== undefined)
    writeFileSync(join(dir, 'MARKER'), opts.marker);
  gitRun(
    [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=test',
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      'seed',
    ],
    dir,
  );
  if (opts.tag) gitRun(['tag', opts.tag], dir);
}

/** Build a fixture repo: a copy of the real script (self-locating REPO
 *  resolves to `root`) + a ci.yml pinning TAG + a PATH-shadowed `git` that
 *  fabricates a real local repo in place of a network clone. */
function makeFixture(): { root: string; fakeBinDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'regen-mirrors-guard-'));
  cleanupDirs.push(root);

  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(
    join(root, '.github/workflows/ci.yml'),
    `jobs:\n  x:\n    env:\n      TASK_VIEW_TAG: ${TAG}\n`,
  );

  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts/regen-mirrors.sh'),
    readFileSync(SCRIPT_SRC),
  );
  chmodSync(join(root, 'scripts/regen-mirrors.sh'), 0o755);

  const fakeBinDir = join(root, 'fakebin');
  mkdirSync(fakeBinDir, { recursive: true });
  const shim = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `REAL_GIT="${REAL_GIT}"`,
    'is_clone=0',
    'for a in "$@"; do',
    '  if [ "$a" = "clone" ]; then is_clone=1; fi',
    'done',
    'if [ "$is_clone" = "1" ]; then',
    '  dest="${@: -1}"',
    '  tag=""',
    '  prev=""',
    '  for a in "$@"; do',
    '    if [ "$prev" = "--branch" ]; then tag="$a"; fi',
    '    prev="$a"',
    '  done',
    '  rm -rf "$dest"',
    '  mkdir -p "$dest/apps/server" "$dest/bin" "$dest/node_modules"',
    '  echo \'{"name":"task-view","version":"0.2.0"}\' > "$dest/package.json"',
    '  echo \'// fake\' > "$dest/apps/server/index.ts"',
    '  printf \'#!/usr/bin/env node\\nprocess.exit(0);\\n\' > "$dest/bin/task-view.js"',
    '  "$REAL_GIT" -C "$dest" init -q',
    '  "$REAL_GIT" -c user.email=test@example.com -c user.name=test -C "$dest" commit --allow-empty -q -m fake',
    '  "$REAL_GIT" -C "$dest" tag "$tag"',
    '  exit 0',
    'fi',
    'exec "$REAL_GIT" "$@"',
    '',
  ].join('\n');
  writeFileSync(join(fakeBinDir, 'git'), shim);
  chmodSync(join(fakeBinDir, 'git'), 0o755);

  return { root, fakeBinDir };
}

function runScript(root: string, fakeBinDir: string): SpawnSyncReturns<string> {
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.KH_PRIVATE_DOCS_DIR;
  delete env.TASK_VIEW_TAG;
  delete env.TASK_VIEW_DIR;
  env.PATH = `${fakeBinDir}:${process.env.PATH ?? ''}`;
  return spawnSync('bash', [join(root, 'scripts/regen-mirrors.sh')], {
    cwd: root,
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
}

function cacheDir(root: string): string {
  return resolve(root, `.cache/task-view-${TAG}`);
}

describe('regen-mirrors.sh clone/re-clone guard (bl-482)', () => {
  it('clones fresh when the tag-keyed cache dir is missing', () => {
    const { root, fakeBinDir } = makeFixture();
    const dir = cacheDir(root);

    const result = runScript(root, fakeBinDir);

    // Fails downstream at the (deliberately unset) KH_PRIVATE_DOCS_DIR gate —
    // proves the guard decision ran to completion BEFORE that point.
    expect(result.stderr).toContain('KH_PRIVATE_DOCS_DIR must be set');
    expect(result.stdout).toContain('cloning task-view');
    expect(existsSync(join(dir, '.git'))).toBe(true);
    expect(lstatSync(dir).isSymbolicLink()).toBe(false);
  });

  it('refuses + re-clones when the cache dir is a SYMLINK to a live/mutable checkout, leaving the live checkout untouched', () => {
    const { root, fakeBinDir } = makeFixture();
    const dir = cacheDir(root);

    const liveCheckout = mkdtempSync(join(tmpdir(), 'live-checkout-'));
    cleanupDirs.push(liveCheckout);
    makeRealGitRepoAt(liveCheckout, { marker: 'live-checkout-untouched' });

    mkdirSync(resolve(root, '.cache'), { recursive: true });
    symlinkSync(liveCheckout, dir);

    const result = runScript(root, fakeBinDir);

    expect(result.stdout).toMatch(/SYMLINK/);
    expect(result.stdout).toContain('re-cloning');
    // The guard re-cloned INTO the (now real) cache dir...
    expect(lstatSync(dir).isSymbolicLink()).toBe(false);
    expect(existsSync(join(dir, '.git'))).toBe(true);
    // ...and never touched the live checkout the symlink used to point at
    // (`rm -rf` on a symlink path removes the link entry, not its target).
    expect(existsSync(join(liveCheckout, 'MARKER'))).toBe(true);
  });

  it('refuses + re-clones when the cache dir is a REAL (non-symlinked) repo whose HEAD drifted from the pinned tag', () => {
    const { root, fakeBinDir } = makeFixture();
    const dir = cacheDir(root);

    // A real repo, but never tagged as TAG (or tagged as something else) —
    // HEAD cannot match refs/tags/<TAG>.
    makeRealGitRepoAt(dir, { tag: 'v0.11.0-task-view', marker: 'stale-clone' });

    const result = runScript(root, fakeBinDir);

    expect(result.stdout).toMatch(/does not match pinned tag/);
    expect(result.stdout).toContain('re-cloning');
    // The stale directory (and its marker) was destroyed and replaced.
    expect(existsSync(join(dir, 'MARKER'))).toBe(false);
    expect(existsSync(join(dir, 'bin/task-view.js'))).toBe(true);
  });

  it('reuses the cache dir (no clone) when it genuinely matches the pinned tag', () => {
    const { root, fakeBinDir } = makeFixture();
    const dir = cacheDir(root);

    makeRealGitRepoAt(dir, { tag: TAG, marker: 'genuine-clone' });
    mkdirSync(join(dir, 'node_modules'), { recursive: true }); // skip bun install

    const result = runScript(root, fakeBinDir);

    expect(result.stdout).toContain('reusing cached clone');
    expect(result.stdout).not.toContain('cloning task-view');
    // Untouched — the marker from the pre-seeded "genuine" repo survives.
    expect(existsSync(join(dir, 'MARKER'))).toBe(true);
  });
});
