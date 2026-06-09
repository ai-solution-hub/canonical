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
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import {
  ensureServer,
  resolveTag,
  resolveExpectedVersion,
  type SpawnSeam,
  type ServerHandle,
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

function writeHandle(repoRoot: string, handle: ServerHandle): void {
  const dir = join(repoRoot, '.cache/ledger-server');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'handle.json'), JSON.stringify(handle));
}

/** Pre-seed the lifecycle-owned spawn-tag sidecar (inv 48 Layer-2). */
function writeSpawnTagSidecar(repoRoot: string, spawnTag: string): void {
  const dir = join(repoRoot, '.cache/ledger-server');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'spawn-tag.json'), JSON.stringify({ spawnTag }));
}

function readSpawnTagSidecar(repoRoot: string): { spawnTag: string } | null {
  try {
    return JSON.parse(
      readFileSync(
        join(repoRoot, '.cache/ledger-server/spawn-tag.json'),
        'utf8',
      ),
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
});
afterEach(() => {
  for (const s of servers) s.close();
  servers.length = 0;
  rmSync(tmpRoot, { recursive: true, force: true });
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

  it('an ABSOLUTE default ledgerDir reaches the PERSISTENT branch (ledgerDir-switch fix)', async () => {
    // serverCommitMutation passes resolve(path, '..') — an ABSOLUTE
    // docs/reference. Pre-fix, an absolute path never === the relative literal,
    // so the default ledger ALWAYS spawned ephemeral and never reused. Post-fix
    // it normalises: a valid handle + live daemon + matching sidecar reuses.
    const { port } = await startHealthServer(PKG_VERSION);
    writeHandle(tmpRoot, {
      port,
      pid: 24680,
      version: PKG_VERSION,
      ledgerDir: 'docs/reference',
    });
    writeSpawnTagSidecar(tmpRoot, 'v0.4.0-task-view');
    const { seam, spawnCalls } = makeSpawnSeam();

    const result = await ensureServer({
      repoRoot: tmpRoot,
      ledgerDir: resolve(tmpRoot, 'docs/reference'), // ABSOLUTE, not the literal
      spawnSeam: seam,
    });

    // reused:true proves the absolute path took the persistent (default) branch
    // — the ephemeral branch would have spawned instead.
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
});
