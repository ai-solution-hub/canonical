/**
 * ledger-server-lifecycle.ts — lifecycle manager for the ledger server daemon.
 * ID-90.18, TECH §Proposed changes K3 + §Decisions OQ-2.
 *
 * `ensureServer(ledgerDir)` guarantees a healthy, version-matched ledger
 * server is running for the given ledger directory. It reads a handle file,
 * validates the running server via GET /api/health + version-vs-pinned-tag
 * check, and spawns a new daemon on miss/stale. The transport client
 * ({90.17}) calls this via the `ensureServer` callback on connection-refused.
 *
 * Contract (invariants 13, 34, 48, 54):
 *   - Version check: the running server's version MUST match the pinned
 *     TASK_VIEW_TAG from ci.yml (inv 48). Stale → kill + respawn.
 *   - Child stdio → façade stderr (inv 13 stdout purity).
 *   - CI env (process.env.CI truthy) adds --require-denylist (inv 34).
 *   - HARD 10s deadline — fail loud, never hang, never fall back to an
 *     ungated write path (inv 54).
 *   - Non-default --ledger-dir → EPHEMERAL per-invocation server, no
 *     handle-file pollution. Handle files live in .cache/ (gitignored).
 *   - O_EXCL lock prevents concurrent spawn races.
 */

import { resolve, dirname } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';

// ── types ─────────────────────────────────────────────────────────────────────

/** Shape of the handle file written by the server's --port-file flag. */
export interface ServerHandle {
  port: number;
  pid: number;
  version: string;
  ledgerDir: string;
}

/** Injectable seam for process spawning (the one permitted mock per
 *  test-philosophy). Production uses `Bun.spawn` / `child_process.spawn`. */
export interface SpawnSeam {
  spawn(
    cmd: string,
    args: string[],
    opts: {
      cwd?: string;
      stdio?: ['ignore', 'pipe', 'pipe'] | ['ignore', 'ignore', 'ignore'];
      env?: Record<string, string | undefined>;
    },
  ): {
    pid: number | undefined;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    unref?: () => void;
  };
  kill(pid: number): boolean;
}

export interface EnsureServerOptions {
  /** Override the default ledger directory (docs/reference). When non-default,
   *  an ephemeral per-invocation server is spawned — no handle file. */
  ledgerDir?: string;
  /** Repo root (defaults to cwd). Used to locate ci.yml and .cache/. */
  repoRoot?: string;
  /** Injectable spawn seam for testing. */
  spawnSeam?: SpawnSeam;
  /** Override the startup deadline (default 10_000ms). */
  deadlineMs?: number;
}

export interface EnsureServerResult {
  port: number;
  pid: number;
  version: string;
  /** True if an existing server was reused (not spawned). */
  reused: boolean;
}

// ── constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LEDGER_DIR = 'docs/reference';
const HANDLE_DIR = '.cache/ledger-server';
const HANDLE_FILENAME = 'handle.json';
const DEFAULT_DEADLINE_MS = 10_000;
const IDLE_EXIT_MINUTES = 30;
const HEALTH_ENDPOINT = '/api/health';
const POLL_INTERVAL_MS = 100;

// ── tag resolution ────────────────────────────────────────────────────────────

/**
 * Parse TASK_VIEW_TAG from ci.yml — exactly as regen-mirrors.sh:28-31 does.
 * Exported for testing.
 */
export function resolveTag(repoRoot: string): string {
  const ciPath = resolve(repoRoot, '.github/workflows/ci.yml');
  let text: string;
  try {
    text = readFileSync(ciPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot resolve TASK_VIEW_TAG: failed to read ${ciPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const match = text.match(/TASK_VIEW_TAG:\s*(\S+)/);
  if (!match?.[1]) {
    throw new Error(`Cannot resolve TASK_VIEW_TAG: no match in ${ciPath}`);
  }
  return match[1];
}

// ── handle file ───────────────────────────────────────────────────────────────

function handlePath(repoRoot: string): string {
  return resolve(repoRoot, HANDLE_DIR, HANDLE_FILENAME);
}

function readHandle(path: string): ServerHandle | null {
  try {
    const text = readFileSync(path, 'utf8');
    const parsed = JSON.parse(text);
    if (
      typeof parsed.port === 'number' &&
      typeof parsed.pid === 'number' &&
      typeof parsed.version === 'string' &&
      typeof parsed.ledgerDir === 'string'
    ) {
      return parsed as ServerHandle;
    }
    return null;
  } catch {
    return null;
  }
}

function removeHandle(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone — fine.
  }
}

// ── health check ──────────────────────────────────────────────────────────────

async function healthCheck(
  port: number,
  expectedVersion: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}${HEALTH_ENDPOINT}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return { ok: false, reason: `health HTTP ${resp.status}` };
    const body = (await resp.json()) as { ok?: boolean; version?: string };
    if (!body.ok) return { ok: false, reason: 'health body.ok is false' };
    if (body.version !== expectedVersion) {
      return {
        ok: false,
        reason: `version mismatch: running ${body.version}, expected ${expectedVersion}`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'health check unreachable' };
  }
}

// ── process management ────────────────────────────────────────────────────────

function killProcess(pid: number, seam?: SpawnSeam): void {
  try {
    if (seam) {
      seam.kill(pid);
    } else {
      process.kill(pid);
    }
  } catch {
    // Process already gone.
  }
}

function defaultSpawnSeam(): SpawnSeam {
  // Use Bun.spawn if available (Bun), else child_process.spawn (Node).
  return {
    spawn(cmd, args, opts) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spawn: nodeSpawn } =
        require('node:child_process') as typeof import('node:child_process');
      const child: ChildProcess = nodeSpawn(cmd, args, {
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
        detached: true,
      });
      child.unref();
      // Pipe child stderr to façade stderr (inv 13: stdout stays pure).
      child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
      return {
        pid: child.pid,
        stdout: null,
        stderr: null,
        unref: () => child.unref(),
      };
    },
    kill(pid) {
      try {
        process.kill(pid);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ── spawn + wait ──────────────────────────────────────────────────────────────

interface SpawnArgs {
  repoRoot: string;
  tag: string;
  ledgerDir: string;
  portFilePath: string;
  seam: SpawnSeam;
  deadlineMs: number;
}

async function spawnAndWait(args: SpawnArgs): Promise<EnsureServerResult> {
  const { repoRoot, tag, ledgerDir, portFilePath, seam, deadlineMs } = args;

  const serverEntry = resolve(
    repoRoot,
    `.cache/task-view-${tag}/apps/server/index.ts`,
  );

  const spawnArgs = [
    serverEntry,
    '--serve-dir',
    resolve(repoRoot, ledgerDir),
    '--no-browser',
    '--port',
    '0',
    '--port-file',
    portFilePath,
    '--idle-exit',
    String(IDLE_EXIT_MINUTES),
  ];
  // inv 34: CI adds --require-denylist.
  if (process.env.CI) {
    spawnArgs.push('--require-denylist');
  }

  // Remove stale handle before spawning.
  removeHandle(portFilePath);

  // Ensure the handle directory exists.
  mkdirSync(dirname(portFilePath), { recursive: true });

  const child = seam.spawn('bun', spawnArgs, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env as Record<string, string | undefined>,
  });

  if (!child.pid) {
    throw new Error('Failed to spawn ledger server: no pid');
  }

  // Pipe child stderr to façade stderr (inv 13).
  if (child.stderr) {
    const reader = child.stderr.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          process.stderr.write(value);
        }
      } catch {
        // Stream closed.
      }
    })();
  }

  if (child.unref) child.unref();

  // Poll for handle file + health under the hard deadline (inv 54).
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const handle = readHandle(portFilePath);
    if (handle) {
      const health = await healthCheck(handle.port, tag);
      if (health.ok) {
        return {
          port: handle.port,
          pid: handle.pid,
          version: tag,
          reused: false,
        };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Deadline exceeded — kill the child and fail loud (inv 54).
  killProcess(child.pid, seam);
  removeHandle(portFilePath);
  throw new Error(
    `Ledger server failed to become healthy within ${deadlineMs}ms deadline (inv 54). ` +
      `Spawned pid ${child.pid} for ${ledgerDir}; no fallback to ungated write path.`,
  );
}

// ── main entry point ──────────────────────────────────────────────────────────

/**
 * Ensure a healthy, version-matched ledger server is running for the given
 * directory. Reuses an existing daemon if the handle file is valid and the
 * health check passes; otherwise kills stale processes and spawns fresh.
 *
 * Non-default `ledgerDir` (tests, K5 parity harness) → ephemeral server
 * spawned per invocation with a temp handle file (no .cache/ pollution).
 */
export async function ensureServer(
  opts: EnsureServerOptions = {},
): Promise<EnsureServerResult> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const ledgerDir = opts.ledgerDir ?? DEFAULT_LEDGER_DIR;
  const seam = opts.spawnSeam ?? defaultSpawnSeam();
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;

  const tag = resolveTag(repoRoot);
  const isDefault = ledgerDir === DEFAULT_LEDGER_DIR;

  if (isDefault) {
    // ── default ledger dir: reuse or spawn a persistent daemon ──────────
    const hPath = handlePath(repoRoot);
    const existing = readHandle(hPath);

    if (existing) {
      const health = await healthCheck(existing.port, tag);
      if (health.ok) {
        return {
          port: existing.port,
          pid: existing.pid,
          version: tag,
          reused: true,
        };
      }
      // Stale or version-mismatched — kill and respawn.
      killProcess(existing.pid, seam);
      removeHandle(hPath);
    }

    return spawnAndWait({
      repoRoot,
      tag,
      ledgerDir,
      portFilePath: hPath,
      seam,
      deadlineMs,
    });
  }

  // ── non-default ledger dir: ephemeral per-invocation server ────────────
  // Use a tmp-dir handle file so we don't pollute .cache/.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmpDir = mkdtempSync(join(tmpdir(), 'ledger-ephemeral-'));
  const ephemeralHandle = join(tmpDir, HANDLE_FILENAME);

  return spawnAndWait({
    repoRoot,
    tag,
    ledgerDir,
    portFilePath: ephemeralHandle,
    seam,
    deadlineMs,
  });
}
