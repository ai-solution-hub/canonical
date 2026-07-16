/**
 * ledger-server-lifecycle.test.ts — lifecycle manager tests (ID-90.18 K3).
 *
 * The process-spawn seam is the ONE permitted mock (test-philosophy). Health
 * checks hit REAL ephemeral HTTP servers (port 0, loopback). Tag resolution
 * reads a real temp ci.yml fixture.
 *
 * Invariants exercised: 13 (child stdio → stderr), 34 (--require-denylist
 * in CI), 48 (version-vs-pinned-tag), 54 (10s deadline, fail loud).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import { spawn as nodeSpawn } from 'node:child_process';
import {
  ensureServer,
  ledgerKey,
  resolveTag,
  resolveExpectedVersion,
  assertSpawnSourcePinned,
  stopEphemeralServer,
  reapEphemeralServersForTest,
  type SpawnSeam,
  type ServerHandle,
  type EnsureServerResult,
} from '@/scripts/ledger-server-lifecycle';

// ── fixtures ──────────────────────────────────────────────────────────────────

let tmpRoot: string;
const servers: Server[] = [];

// The version the REAL task-view server reports at /api/health is its ROOT
// package.json version — NOT the git tag (tag v0.4.0-task-view → package
// 0.2.0). inv 48 compares against this package version. These fixtures mirror
// that: the fake clone's package.json carries PKG_VERSION, the fake health
// server echoes it, and the tag stays deliberately DIFFERENT — so a regression
// to comparing the raw tag would FAIL the reuse test (0.2.0 !== v0.4.0-task-view).
const PKG_VERSION = '0.2.0';

function makeFakeRepo(tag = 'v0.4.0-task-view'): string {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-test-'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(
    join(dir, '.github/workflows/ci.yml'),
    `jobs:\n  ledger-mirror-parity:\n    env:\n      TASK_VIEW_TAG: ${tag}\n`,
  );
  mkdirSync(join(dir, '.cache/ledger-server'), { recursive: true });
  // resolveExpectedVersion reads the pinned clone's package.json version.
  mkdirSync(join(dir, `.cache/task-view-${tag}`), { recursive: true });
  writeFileSync(
    join(dir, `.cache/task-view-${tag}/package.json`),
    JSON.stringify({ name: 'task-view', version: PKG_VERSION }),
  );
  return dir;
}

// bl-296: the daemon slot is keyed by resolved ledgerDir. The default-path tests
// stub KH_PRIVATE_DOCS_DIR=repoRoot (beforeEach), so the default ledgerDir is
// <repoRoot>/src/content/docs/ledgers — seed/read the handle + sidecar under that
// ledger's keyed subdir, mirroring production handlePath/spawnTagPath.
function defaultSlotDir(repoRoot: string): string {
  const ledgerDir = resolve(repoRoot, 'src/content/docs/ledgers');
  return join(repoRoot, '.cache/ledger-server', ledgerKey(repoRoot, ledgerDir));
}

function writeHandle(repoRoot: string, handle: ServerHandle): void {
  const dir = defaultSlotDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'handle.json'), JSON.stringify(handle));
}

/** Pre-seed the lifecycle-owned spawn-tag sidecar (inv 48 Layer-2). */
function writeSpawnTagSidecar(repoRoot: string, spawnTag: string): void {
  const dir = defaultSlotDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'spawn-tag.json'), JSON.stringify({ spawnTag }));
}

function readSpawnTagSidecar(repoRoot: string): { spawnTag: string } | null {
  try {
    return JSON.parse(
      readFileSync(join(defaultSlotDir(repoRoot), 'spawn-tag.json'), 'utf8'),
    ) as { spawnTag: string };
  } catch {
    return null;
  }
}

/** Start a real ephemeral health server returning the given version. */
async function startHealthServer(
  version: string,
): Promise<{ port: number; server: Server }> {
  return new Promise((resolve_) => {
    const srv = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          version,
          ledgerDir: 'docs/reference',
          documents: [],
        }),
      );
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      servers.push(srv);
      resolve_({ port: addr.port, server: srv });
    });
  });
}

/** A SpawnSeam that simulates a server startup by writing a handle file
 *  and starting a real HTTP health server. */
function makeSpawnSeam(
  opts: {
    pkgVersion?: string;
    startupDelayMs?: number;
    failToStart?: boolean;
  } = {},
): { seam: SpawnSeam; spawnCalls: string[][]; killCalls: number[] } {
  const spawnCalls: string[][] = [];
  const killCalls: number[] = [];
  // The spawned daemon reports its package.json version (what the real server
  // does), NOT the git tag — mirrors the rootPkg.version the live server emits.
  const pkgVersion = opts.pkgVersion ?? PKG_VERSION;
  let pidCounter = 90_000;

  const seam: SpawnSeam = {
    spawn(_cmd, args, _opts) {
      spawnCalls.push(args);
      const pid = ++pidCounter;

      if (opts.failToStart) {
        // Don't write the handle file — simulates a server that never starts.
        return { pid, stdout: null, stderr: null, unref: () => {} };
      }

      // Find the --port-file argument to know where to write the handle.
      const portFileIdx = args.indexOf('--port-file');
      const portFilePath = portFileIdx >= 0 ? args[portFileIdx + 1] : null;

      if (portFilePath) {
        // Simulate server startup: write the handle file after a delay,
        // with a real health server behind it.
        const delay = opts.startupDelayMs ?? 50;
        setTimeout(async () => {
          const { port } = await startHealthServer(pkgVersion);
          mkdirSync(resolve(portFilePath, '..'), { recursive: true });
          writeFileSync(
            portFilePath,
            JSON.stringify({
              port,
              pid,
              version: pkgVersion,
              ledgerDir: 'docs/reference',
            }),
          );
        }, delay);
      }

      return { pid, stdout: null, stderr: null, unref: () => {} };
    },
    kill(pid) {
      killCalls.push(pid);
      return true;
    },
  };

  return { seam, spawnCalls, killCalls };
}

beforeEach(() => {
  tmpRoot = makeFakeRepo();
  // ID-68.35: the default ledgerDir now resolves via KH_PRIVATE_DOCS_DIR
  // (resolveDefaultLedgerDir, fail-closed). Stub it to the fake repo so the
  // default-path tests are hermetic and CI-safe — KH PR-blocking CI has no
  // private docs-site sibling (Inv 30). resolveDefaultLedgerDir() then returns
  // <tmpRoot>/src/content/docs/ledgers.
  vi.stubEnv('KH_PRIVATE_DOCS_DIR', tmpRoot);
});
afterEach(() => {
  for (const s of servers) s.close();
  servers.length = 0;
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── resolveTag ────────────────────────────────────────────────────────────────

describe('resolveTag (inv 48)', () => {
  it('parses TASK_VIEW_TAG from ci.yml', () => {
    expect(resolveTag(tmpRoot)).toBe('v0.4.0-task-view');
  });

  it('throws when ci.yml is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'no-ci-'));
    expect(() => resolveTag(empty)).toThrow('Cannot resolve TASK_VIEW_TAG');
    rmSync(empty, { recursive: true, force: true });
  });

  it('throws when ci.yml has no TASK_VIEW_TAG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-tag-'));
    mkdirSync(join(dir, '.github/workflows'), { recursive: true });
    writeFileSync(join(dir, '.github/workflows/ci.yml'), 'jobs:\n  build:\n');
    expect(() => resolveTag(dir)).toThrow('no match');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── resolveExpectedVersion (inv 48 — compare package version, not the tag) ──────

describe('resolveExpectedVersion (inv 48)', () => {
  it('returns the clone package.json version, NOT the git tag', () => {
    // tmpRoot is pinned to v0.4.0-task-view, but its clone package.json is 0.2.0.
    // Comparing health.version against the tag string was the AC-P1 failure.
    expect(resolveExpectedVersion(tmpRoot, 'v0.4.0-task-view')).toBe(
      PKG_VERSION,
    );
    expect(resolveExpectedVersion(tmpRoot, 'v0.4.0-task-view')).not.toBe(
      'v0.4.0-task-view',
    );
  });

  it('throws loud when the pinned clone package.json is missing', () => {
    expect(() => resolveExpectedVersion(tmpRoot, 'v9.9.9-absent')).toThrow(
      'Cannot resolve server version',
    );
  });
});

// ── assertSpawnSourcePinned (bl-482 symlink/drift refusal) ────────────────────

describe('assertSpawnSourcePinned (bl-482)', () => {
  const TAG = 'v0.4.0-task-view';

  it('passes silently for a genuine (non-symlinked) tag-pinned clone dir', () => {
    // makeFakeRepo() already provisions a REAL directory (not a symlink) at
    // .cache/task-view-<tag>/ with a well-formed package.json.
    expect(() => assertSpawnSourcePinned(tmpRoot, TAG)).not.toThrow();
  });

  it('throws a remediation error naming the offending path when the tag dir is missing', () => {
    const missingTag = 'v9.9.9-absent';
    expect(() => assertSpawnSourcePinned(tmpRoot, missingTag)).toThrow(
      /does not exist/,
    );
    try {
      assertSpawnSourcePinned(tmpRoot, missingTag);
      expect.unreachable('expected assertSpawnSourcePinned to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain(`task-view-${missingTag}`);
      expect(message).toContain(
        `git clone --depth 1 --branch ${missingTag} https://github.com/liam-jons/task-view.git`,
      );
    }
  });

  it('refuses a SYMLINKED tag dir with a remediation error naming the offending path + re-clone command', () => {
    // Simulate the bl-482 bug directly: .cache/task-view-<tag> is a symlink to
    // a live, mutable dev checkout instead of an immutable tag-pinned clone.
    const liveCheckout = mkdtempSync(join(tmpdir(), 'live-checkout-'));
    mkdirSync(join(liveCheckout, 'apps/server'), { recursive: true });
    writeFileSync(join(liveCheckout, 'apps/server/index.ts'), '// fake');
    writeFileSync(
      join(liveCheckout, 'package.json'),
      JSON.stringify({ name: 'task-view', version: PKG_VERSION }),
    );

    const dir = resolve(tmpRoot, `.cache/task-view-${TAG}`);
    rmSync(dir, { recursive: true, force: true }); // remove makeFakeRepo's real dir
    symlinkSync(liveCheckout, dir);

    try {
      assertSpawnSourcePinned(tmpRoot, TAG);
      expect.unreachable('expected assertSpawnSourcePinned to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/SYMLINK/);
      expect(message).toContain(dir); // names the offending path
      expect(message).toContain(
        `git clone --depth 1 --branch ${TAG} https://github.com/liam-jons/task-view.git`,
      ); // names the re-clone command
    } finally {
      rmSync(liveCheckout, { recursive: true, force: true });
    }
  });

  it('allows a REAL clone reached through a symlinked .cache ROOT (bl-296 worktree cache-sharing stays legitimate)', () => {
    // Distinguishes the ACCEPTED sharing pattern (a worktree's whole .cache/
    // is a symlink to another checkout's real .cache/ — bl-296) from the
    // bl-482 BUG (an individual task-view-<tag> ENTRY is a symlink to a live,
    // mutable checkout). Here .cache itself is redirected, but the tag dir
    // reached through it is a genuine clone — containment must still PASS.
    const sharedCacheRoot = mkdtempSync(join(tmpdir(), 'shared-cache-root-'));
    const realTagDir = join(sharedCacheRoot, `task-view-${TAG}`);
    mkdirSync(join(realTagDir, 'apps/server'), { recursive: true });
    writeFileSync(join(realTagDir, 'apps/server/index.ts'), '// fake');
    writeFileSync(
      join(realTagDir, 'package.json'),
      JSON.stringify({ name: 'task-view', version: PKG_VERSION }),
    );

    const cacheDir = resolve(tmpRoot, '.cache');
    rmSync(cacheDir, { recursive: true, force: true });
    symlinkSync(sharedCacheRoot, cacheDir);

    try {
      expect(() => assertSpawnSourcePinned(tmpRoot, TAG)).not.toThrow();
    } finally {
      rmSync(sharedCacheRoot, { recursive: true, force: true });
    }
  });
});

// ── reuse existing server ─────────────────────────────────────────────────────

describe('ensureServer reuses a healthy daemon', () => {
  it('returns reused:true when handle + liveness + matching spawn-tag pass', async () => {
    // Liveness server is up (body.ok); the spawn-tag sidecar matches the pinned
    // tag (v0.4.0-task-view). inv 48 Layer-2: reuse gates on the sidecar tag,
    // not on any server-reported version.
    const { port } = await startHealthServer(PKG_VERSION);
    writeHandle(tmpRoot, {
      port,
      pid: 12345,
      version: PKG_VERSION,
      ledgerDir: 'docs/reference',
    });
    writeSpawnTagSidecar(tmpRoot, 'v0.4.0-task-view');
    const { seam, spawnCalls } = makeSpawnSeam();

    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
    });
    expect(result.reused).toBe(true);
    expect(result.port).toBe(port);
    expect(spawnCalls).toHaveLength(0); // no spawn needed
  });
});

// ── kill + respawn on version mismatch ────────────────────────────────────────

describe('ensureServer kills stale servers (inv 48)', () => {
  it('kills and respawns when the spawn-tag sidecar is from a DIFFERENT tag (inv 48 Layer-2)', async () => {
    // The running daemon is LIVE and reports the pinned package version (0.2.0),
    // so a version comparison would WRONGLY reuse it. But the spawn-tag sidecar
    // records a different tag (v0.3.1-task-view) — a stale prior-release daemon
    // that happens to share package 0.2.0. Reuse MUST be rejected on the tag,
    // never on the (matching) server-reported version.
    const { port: oldPort } = await startHealthServer(PKG_VERSION);
    writeHandle(tmpRoot, {
      port: oldPort,
      pid: 55555,
      version: PKG_VERSION,
      ledgerDir: 'docs/reference',
    });
    writeSpawnTagSidecar(tmpRoot, 'v0.3.1-task-view'); // stale: pinned is v0.4.0

    const { seam, spawnCalls, killCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(killCalls).toContain(55555);
    expect(spawnCalls.length).toBeGreaterThan(0);
    expect(result.reused).toBe(false);
    // The respawn rewrote the sidecar to the pinned tag.
    expect(readSpawnTagSidecar(tmpRoot)?.spawnTag).toBe('v0.4.0-task-view');
  });

  it('kills and respawns when the spawn-tag sidecar is MISSING (unverifiable daemon)', async () => {
    // Live daemon + valid handle but NO sidecar (e.g. spawned by an older
    // lifecycle). Its tag cannot be proven → treat as stale: kill + respawn.
    const { port: oldPort } = await startHealthServer(PKG_VERSION);
    writeHandle(tmpRoot, {
      port: oldPort,
      pid: 77777,
      version: PKG_VERSION,
      ledgerDir: 'docs/reference',
    });
    // deliberately NO writeSpawnTagSidecar

    const { seam, spawnCalls, killCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(killCalls).toContain(77777);
    expect(spawnCalls.length).toBeGreaterThan(0);
    expect(result.reused).toBe(false);
  });

  it('kills and respawns when health check is unreachable', async () => {
    writeHandle(tmpRoot, {
      port: 1, // unreachable
      pid: 66666,
      version: 'v0.4.0-task-view',
      ledgerDir: 'docs/reference',
    });

    const { seam, killCalls, spawnCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(killCalls).toContain(66666);
    expect(spawnCalls.length).toBeGreaterThan(0);
    expect(result.reused).toBe(false);
  });
});

// ── spawn from scratch ────────────────────────────────────────────────────────

describe('ensureServer spawns on missing handle', () => {
  it('spawns a new server when no handle exists', async () => {
    const { seam, spawnCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(result.reused).toBe(false);
    expect(result.version).toBe('v0.4.0-task-view');
    expect(spawnCalls.length).toBe(1);
    // inv 48 Layer-2: the spawn records the tag it spawned with in the sidecar.
    expect(readSpawnTagSidecar(tmpRoot)?.spawnTag).toBe('v0.4.0-task-view');
  });

  it('the ABSOLUTE env-resolved default ledgerDir reaches the PERSISTENT branch (ledgerDir-switch fix)', async () => {
    // The default ledgerDir is now an ABSOLUTE env-resolved docs-site path
    // (resolveDefaultLedgerDir via KH_PRIVATE_DOCS_DIR, ID-68.35) — stubbed to
    // <tmpRoot>/src/content/docs/ledgers in beforeEach. Pre-fix the default was
    // the relative literal 'docs/reference' and an absolute path never matched
    // it (always ephemeral). A valid handle + live daemon + matching sidecar
    // must now REUSE (persistent), not ephemeral-spawn.
    const defaultDir = resolve(tmpRoot, 'src/content/docs/ledgers');
    const { port } = await startHealthServer(PKG_VERSION);
    writeHandle(tmpRoot, {
      port,
      pid: 24680,
      version: PKG_VERSION,
      ledgerDir: defaultDir,
    });
    writeSpawnTagSidecar(tmpRoot, 'v0.4.0-task-view');
    const { seam, spawnCalls } = makeSpawnSeam();

    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: defaultDir, // ABSOLUTE default
      spawnSeam: seam,
    });

    // reused:true proves the absolute default path took the persistent branch —
    // the ephemeral branch would have spawned instead.
    expect(result.reused).toBe(true);
    expect(result.port).toBe(port);
    expect(spawnCalls).toHaveLength(0);
  });

  it('passes --require-denylist when CI env is truthy (inv 34)', async () => {
    vi.stubEnv('CI', 'true');
    const { seam, spawnCalls } = makeSpawnSeam();
    await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(spawnCalls[0]).toContain('--require-denylist');
    vi.unstubAllEnvs();
  });

  it('does NOT pass --require-denylist when CI is unset', async () => {
    delete process.env.CI;
    const { seam, spawnCalls } = makeSpawnSeam();
    await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(spawnCalls[0]).not.toContain('--require-denylist');
  });

  it('passes --serve-dir, --port 0, --idle-exit 30', async () => {
    const { seam, spawnCalls } = makeSpawnSeam();
    await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    const args = spawnCalls[0];
    expect(args).toContain('--serve-dir');
    expect(args).toContain('--port');
    expect(args[args.indexOf('--port') + 1]).toBe('0');
    expect(args).toContain('--idle-exit');
    expect(args[args.indexOf('--idle-exit') + 1]).toBe('30');
  });

  it('the PERSISTENT daemon never receives --parent-pid (ID-156.9 — must not kill the long-lived daemon on CLI exit)', async () => {
    const { seam, spawnCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(spawnCalls[0]).not.toContain('--parent-pid');
    expect(result.ephemeral).toBe(false);
  });
});

// ── end-to-end spawn-source refusal (bl-482) ──────────────────────────────────

describe('ensureServer refuses a symlinked spawn source end-to-end (bl-482)', () => {
  it('rejects BEFORE invoking the spawn seam when .cache/task-view-<tag> is a symlink, naming the path in the error', async () => {
    const liveCheckout = mkdtempSync(join(tmpdir(), 'live-checkout-e2e-'));
    mkdirSync(join(liveCheckout, 'apps/server'), { recursive: true });
    writeFileSync(join(liveCheckout, 'apps/server/index.ts'), '// fake');
    writeFileSync(
      join(liveCheckout, 'package.json'),
      JSON.stringify({ name: 'task-view', version: PKG_VERSION }),
    );

    const tagDir = resolve(tmpRoot, '.cache/task-view-v0.4.0-task-view');
    rmSync(tagDir, { recursive: true, force: true });
    symlinkSync(liveCheckout, tagDir);

    const { seam, spawnCalls } = makeSpawnSeam();
    try {
      await expect(
        ensureServer({ repoRoot: tmpRoot, spawnSeam: seam, deadlineMs: 5000 }),
      ).rejects.toThrow(/SYMLINK/);
      // Never reached the spawn seam — refusal happens before touching the
      // handle file or spawning the child (no silent fall-back to the live
      // checkout).
      expect(spawnCalls).toHaveLength(0);
    } finally {
      rmSync(liveCheckout, { recursive: true, force: true });
    }
  });

  it('proceeds to spawn when .cache/task-view-<tag> is a genuine clone dir', async () => {
    // makeFakeRepo() already provisions a real (non-symlinked) dir — this is
    // the baseline "real clone dir → spawn proceeds" acceptance case.
    const { seam, spawnCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });
    expect(spawnCalls.length).toBe(1);
    expect(result.reused).toBe(false);
  });
});

// ── deadline (inv 54) ─────────────────────────────────────────────────────────

describe('ensureServer deadline (inv 54)', () => {
  it('throws after deadline when server never becomes healthy', async () => {
    const { seam } = makeSpawnSeam({ failToStart: true });
    await expect(
      ensureServer({
        repoRoot: tmpRoot,
        spawnSeam: seam,
        deadlineMs: 300, // short deadline for test speed
      }),
    ).rejects.toThrow(/deadline/i);
  });

  it('error message mentions inv 54 and no fallback', async () => {
    const { seam } = makeSpawnSeam({ failToStart: true });
    await expect(
      ensureServer({
        repoRoot: tmpRoot,
        spawnSeam: seam,
        deadlineMs: 300,
      }),
    ).rejects.toThrow(/no fallback to ungated write path/);
  });
});

// ── non-default ledger dir (ephemeral) ────────────────────────────────────────

describe('ensureServer ephemeral mode (non-default --ledger-dir)', () => {
  it('spawns an ephemeral server for non-default ledger dir', async () => {
    const { seam, spawnCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/test-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(result.reused).toBe(false);
    expect(spawnCalls.length).toBe(1);
    // The handle should NOT be in .cache/ledger-server/.
    expect(existsSync(join(tmpRoot, '.cache/ledger-server/handle.json'))).toBe(
      false,
    );
  });

  it('does not reuse a cached handle for non-default dir', async () => {
    // Write a handle for the default dir — it should be ignored.
    const { port } = await startHealthServer(PKG_VERSION);
    writeHandle(tmpRoot, {
      port,
      pid: 12345,
      version: PKG_VERSION,
      ledgerDir: 'docs/reference',
    });

    const { seam, spawnCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/other-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    // Should spawn fresh, not reuse the default-dir handle.
    expect(result.reused).toBe(false);
    expect(spawnCalls.length).toBe(1);
  });

  it('marks the result ephemeral:true (ID-156.9 — the caller must kill-on-success)', async () => {
    const { seam } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/test-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(result.ephemeral).toBe(true);
  });

  it('passes --idle-exit 30s (ID-156.9 unit-bug fix — was 30 MINUTES under a 30-second belief)', async () => {
    const { seam, spawnCalls } = makeSpawnSeam();
    await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/test-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    const args = spawnCalls[0];
    expect(args).toContain('--idle-exit');
    expect(args[args.indexOf('--idle-exit') + 1]).toBe('30s');
  });

  it('passes --parent-pid <process.pid> (ID-156.9 upstream contract — ephemeral opts in to parent-death reaping)', async () => {
    const { seam, spawnCalls } = makeSpawnSeam();
    await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/test-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    const args = spawnCalls[0];
    expect(args).toContain('--parent-pid');
    expect(args[args.indexOf('--parent-pid') + 1]).toBe(String(process.pid));
  });
});

// ── ID-156.9: ephemeral kill-on-success + test-reaper backstop ────────────────

describe('stopEphemeralServer (ID-156.9 kill-on-success)', () => {
  it('kills the pid when result.ephemeral is true', async () => {
    const { seam, spawnCalls, killCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/kill-on-success-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });
    expect(spawnCalls.length).toBe(1);
    expect(killCalls).not.toContain(result.pid);

    stopEphemeralServer(result, seam);

    expect(killCalls).toContain(result.pid);
  });

  it('does NOT kill the pid when result.ephemeral is false (persistent daemon)', async () => {
    const { seam, killCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });
    expect(result.ephemeral).toBe(false);

    stopEphemeralServer(result, seam);

    expect(killCalls).not.toContain(result.pid);
  });

  it('is safe to call more than once for the same result', async () => {
    const { seam, killCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/double-stop-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(() => {
      stopEphemeralServer(result, seam);
      stopEphemeralServer(result, seam);
    }).not.toThrow();
    expect(killCalls.filter((p) => p === result.pid)).toHaveLength(2);
  });

  it('kill-on-success proof with a REAL OS process: the pid is actually dead afterwards', async () => {
    // Spawn a real long-lived child (no seam — exercises the DEFAULT
    // process.kill path stopEphemeralServer takes in production) and confirm
    // it is genuinely alive, then dead, rather than only asserting against a
    // mocked kill() call.
    const child = nodeSpawn('sleep', ['30'], { stdio: 'ignore' });
    await new Promise<void>((res) => child.once('spawn', () => res()));
    const pid = child.pid!;
    expect(() => process.kill(pid, 0)).not.toThrow(); // alive

    const fakeResult: EnsureServerResult = {
      port: 0,
      pid,
      version: 'test',
      reused: false,
      ephemeral: true,
    };
    stopEphemeralServer(fakeResult);

    // Poll briefly for the OS to reap the signal — process.kill(pid, 0)
    // throws ESRCH once the process is gone.
    const deadline = Date.now() + 2000;
    let dead = false;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        dead = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(dead).toBe(true);
  });
});

describe('reapEphemeralServersForTest (ID-156.9 test-reaper backstop)', () => {
  it('kills a tracked ephemeral spawn that stopEphemeralServer never reaped', async () => {
    const { seam, killCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/reaper-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });
    // Simulate a test that threw before its finally-block called
    // stopEphemeralServer — the spawn is still tracked in the in-memory
    // registry ensureServer populated.
    expect(killCalls).not.toContain(result.pid);

    const { reaped } = reapEphemeralServersForTest(seam);

    expect(reaped).toBeGreaterThan(0);
    expect(killCalls).toContain(result.pid);
  });

  it('is a no-op (reaped: 0) when the registry is already empty', () => {
    const { seam } = makeSpawnSeam();
    // Drain whatever this test file's registry currently holds first (test
    // order independence), then assert a second call finds nothing.
    reapEphemeralServersForTest(seam);
    const { reaped } = reapEphemeralServersForTest(seam);
    expect(reaped).toBe(0);
  });

  it('does not re-kill an entry stopEphemeralServer already reaped', async () => {
    const { seam, killCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: '/tmp/already-reaped-ledgers',
      spawnSeam: seam,
      deadlineMs: 5000,
    });
    stopEphemeralServer(result, seam);
    const killCountAfterStop = killCalls.filter((p) => p === result.pid).length;

    reapEphemeralServersForTest(seam);

    expect(killCalls.filter((p) => p === result.pid).length).toBe(
      killCountAfterStop,
    ); // unchanged — already removed from the registry
  });
});

// ── daemon slot keyed by resolved ledgerDir (bl-296) ──────────────────────────

describe('ensureServer keys the daemon slot by ledgerDir (bl-296)', () => {
  it('ignores a legacy flat-path handle (keyed slot, not .cache/ledger-server/handle.json)', async () => {
    // Pre-bl-296 the handle + spawn-tag sidecar lived at the FLAT
    // .cache/ledger-server/{handle,spawn-tag}.json, keyed by repoRoot alone. A
    // symlinked/shared .cache then let a worktree silently reuse another's
    // daemon. After re-keying by resolved ledgerDir they live under a per-dir
    // subdir, so a stale FLAT handle must NOT be reused — ensureServer spawns
    // fresh into the keyed slot. Seed the flat path directly (not via the keyed
    // helpers) to prove the lookup moved off it.
    const { port } = await startHealthServer(PKG_VERSION);
    const flatDir = join(tmpRoot, '.cache/ledger-server');
    mkdirSync(flatDir, { recursive: true });
    writeFileSync(
      join(flatDir, 'handle.json'),
      JSON.stringify({
        port,
        pid: 13579,
        version: PKG_VERSION,
        ledgerDir: resolve(tmpRoot, 'src/content/docs/ledgers'),
      }),
    );
    writeFileSync(
      join(flatDir, 'spawn-tag.json'),
      JSON.stringify({ spawnTag: 'v0.4.0-task-view' }),
    );

    const { seam, spawnCalls } = makeSpawnSeam();
    const result = await ensureServer({
      repoRoot: tmpRoot,
      spawnSeam: seam,
      deadlineMs: 5000,
    });

    expect(result.reused).toBe(false); // flat handle ignored
    expect(spawnCalls.length).toBe(1); // spawned fresh into the keyed slot
  });

  it('ledgerKey is deterministic and distinct per resolved ledgerDir', () => {
    const a = resolve(tmpRoot, 'src/content/docs/ledgers');
    const b = resolve(tmpRoot, 'some/other/ledgers');
    expect(ledgerKey(tmpRoot, a)).toBe(ledgerKey(tmpRoot, a)); // stable
    expect(ledgerKey(tmpRoot, a)).not.toBe(ledgerKey(tmpRoot, b)); // distinct dir → distinct slot
    expect(ledgerKey(tmpRoot, a)).toMatch(/^[0-9a-f]{16}$/); // fs-safe, no separators
  });

  it('ledgerKey is repoRoot-independent for the same ABSOLUTE ledgerDir (symlink safety)', () => {
    // Two worktrees pointed at the SAME shared absolute ledger map to the SAME
    // slot — so a shared/symlinked .cache reuses the same daemon by design,
    // rather than one worktree silently adopting another's repoRoot-keyed handle.
    const shared = resolve(tmpRoot, 'src/content/docs/ledgers');
    expect(ledgerKey('/work/tree-a', shared)).toBe(
      ledgerKey('/work/tree-b', shared),
    );
  });
});
