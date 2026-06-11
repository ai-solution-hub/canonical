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
 *   - Version check: the running server's /api/health version MUST match the
 *     version of the clone pinned by TASK_VIEW_TAG — i.e. the package.json
 *     version of .cache/task-view-<tag>/, which is what the server actually
 *     reports (NOT the tag string itself). Mismatch → kill + respawn (inv 48).
 *     Layer-2 caveat (ID-90 follow-up): distinct tags can share a package
 *     version (v0.3.1/v0.4.0-task-view both report 0.2.0), so this gate cannot
 *     distinguish a stale same-package-version daemon across tags; robust
 *     tag-level staleness for the persistent daemon is accepted as-is — the
 *     spawn-tag sidecar (writeSpawnTag/readSpawnTag) mitigates at runtime;
 *     simplification deferred until a tag ships with a bumped package version.
 *   - Child stdio → façade stderr (inv 13 stdout purity).
 *   - CI env (process.env.CI truthy) adds --require-denylist (inv 34).
 *   - HARD 10s deadline — fail loud, never hang, never fall back to an
 *     ungated write path (inv 54).
 *   - Non-default --ledger-dir → EPHEMERAL per-invocation server, no
 *     handle-file pollution. Handle files live in .cache/ (gitignored).
 *   - O_EXCL lock prevents concurrent spawn races.
 */

import { resolve, dirname } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
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
  /** Override the default ledger directory (the env-resolved docs-site ledgers
   *  path — see resolveDefaultLedgerDir(), ID-68.35). When non-default, an
   *  ephemeral per-invocation server is spawned — no handle file. */
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

/**
 * Resolve the default ledger directory — the relocated docs-site ledgers
 * (ID-68.35). The five ledger JSONs + four mirror dirs moved OUT of the public
 * repo's `docs/reference/` into the PRIVATE `knowledge-hub-docs-site` checkout
 * at `src/content/docs/ledgers/`, resolved via `KH_PRIVATE_DOCS_DIR`.
 *
 * Fail-closed: if the env var is unset, throw LOUD rather than silently falling
 * back to a stale in-repo path (which no longer holds the canonical ledgers).
 * Mirrors the resolver precedent in sweep-identity-relocation.ts /
 * generate-purge-path-inventory.ts. Exported so ledger-cli.ts's `--ledger-dir`
 * parser default calls the SAME resolver — keeping the CLI default and the
 * daemon default byte-identical so the `isDefault` persistent-vs-ephemeral gate
 * still holds.
 */
export function resolveDefaultLedgerDir(): string {
  const base = process.env.KH_PRIVATE_DOCS_DIR;
  if (!base) {
    throw new Error(
      'KH_PRIVATE_DOCS_DIR is not set — required to locate the relocated ledgers ' +
        '(docs-site src/content/docs/ledgers). Ledgers moved out of the public repo under ID-68.35.',
    );
  }
  return resolve(base, 'src/content/docs/ledgers');
}

const HANDLE_DIR = '.cache/ledger-server';
const HANDLE_FILENAME = 'handle.json';
const SPAWN_TAG_FILENAME = 'spawn-tag.json';
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

/**
 * Resolve the version string the server WILL report at /api/health for the
 * clone pinned by `tag` — the ROOT package.json version of its clone
 * (apps/server/index.ts → formatVersion()), NOT the git tag.
 *
 * NOTE (inv 48 Layer-2): this is NO LONGER the staleness gate. Because distinct
 * tags share a package version (v0.3.1 and v0.4.0 both report 0.2.0), version
 * cannot distinguish a stale prior-tag daemon — staleness now gates on the
 * lifecycle-recorded spawn-tag sidecar (see writeSpawnTag / ensureServer).
 * Retained as the canonical "what version does this clone report" resolver and
 * the inv-48 Layer-1 regression guard (ID-90.20). Exported for testing.
 */
export function resolveExpectedVersion(repoRoot: string, tag: string): string {
  const pkgPath = resolve(repoRoot, `.cache/task-view-${tag}/package.json`);
  let text: string;
  try {
    text = readFileSync(pkgPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot resolve server version: failed to read ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let version: unknown;
  try {
    version = (JSON.parse(text) as { version?: unknown }).version;
  } catch (err) {
    throw new Error(
      `Cannot resolve server version: ${pkgPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(
      `Cannot resolve server version: no non-empty string .version in ${pkgPath}`,
    );
  }
  return version;
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

// ── spawn-tag sidecar (inv 48 Layer-2: tag-level staleness) ────────────────────
//
// The handle file's `version` field is the server-reported package version
// (0.2.0 for EVERY task-view tag — v0.3.1 and v0.4.0 both report 0.2.0), so it
// cannot distinguish a daemon spawned from a stale tag from the pinned one. The
// lifecycle records the tag IT spawned with in a sidecar it OWNS; the persistent
// reuse path gates on this, never on any server-reported value.

interface SpawnTagSidecar {
  spawnTag: string;
}

function spawnTagPath(repoRoot: string): string {
  return resolve(repoRoot, HANDLE_DIR, SPAWN_TAG_FILENAME);
}

function readSpawnTag(path: string): SpawnTagSidecar | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed.spawnTag === 'string') {
      return parsed as SpawnTagSidecar;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSpawnTag(path: string, tag: string): void {
  // Atomic: write a temp sibling + rename, so a concurrent reader never observes
  // a half-written sidecar (mirrors the server's own --port-file atomicity).
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ spawnTag: tag }), 'utf8');
  renameSync(tmp, path);
}

function removeSpawnTag(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone — fine.
  }
}

// ── health check ──────────────────────────────────────────────────────────────

/**
 * LIVENESS check (inv 48 Layer-2 demotion). Confirms the daemon is up and
 * answering /api/health with body.ok. It deliberately does NOT compare the
 * reported version: distinct task-view tags share a package version (v0.3.1 and
 * v0.4.0 both report 0.2.0), so version is not a usable staleness signal.
 * Tag-level staleness is gated by the lifecycle-recorded spawn-tag sidecar
 * (see ensureServer / writeSpawnTag), never by a server-reported value.
 */
async function healthCheck(
  port: number,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}${HEALTH_ENDPOINT}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return { ok: false, reason: `health HTTP ${resp.status}` };
    const body = (await resp.json()) as { ok?: boolean };
    if (!body.ok) return { ok: false, reason: 'health body.ok is false' };
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
  /** When set (persistent daemon only), the spawn-tag sidecar to write on a
   *  successful spawn. Omitted for ephemeral servers (they never reuse). */
  sidecarPath?: string;
}

async function spawnAndWait(args: SpawnArgs): Promise<EnsureServerResult> {
  const {
    repoRoot,
    tag,
    ledgerDir,
    portFilePath,
    seam,
    deadlineMs,
    sidecarPath,
  } = args;

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
      const health = await healthCheck(handle.port);
      if (health.ok) {
        // Record the tag THIS lifecycle spawned with (inv 48 Layer-2): the
        // persistent reuse path gates on this sidecar, not a server value.
        if (sidecarPath) writeSpawnTag(sidecarPath, tag);
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
  const defaultLedgerDir = resolveDefaultLedgerDir();
  const ledgerDir = opts.ledgerDir ?? defaultLedgerDir;
  const seam = opts.spawnSeam ?? defaultSpawnSeam();
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;

  const tag = resolveTag(repoRoot);
  // ledgerDir-switch fix: callers pass the ledger dir either relative or
  // ABSOLUTE (serverCommitMutation sends resolve(path, '..')). An absolute path
  // never === a relative literal, so the unnormalised compare made the DEFAULT
  // ledger ALWAYS take the ephemeral branch — the persistent reuse path was
  // unreachable in production. Normalise both sides against repoRoot so the
  // default ledger reliably reuses (inv 48). Post ID-68.35 the default is the
  // already-absolute env-resolved docs-site path (resolveDefaultLedgerDir());
  // resolve(repoRoot, <absolute>) returns it unchanged, so the gate still holds.
  const isDefault =
    resolve(repoRoot, ledgerDir) === resolve(repoRoot, defaultLedgerDir);

  if (isDefault) {
    // ── default ledger dir: reuse or spawn a persistent daemon ──────────
    const hPath = handlePath(repoRoot);
    const sPath = spawnTagPath(repoRoot);
    const existing = readHandle(hPath);

    if (existing) {
      // Liveness only (inv 48 Layer-2): a stale prior-tag daemon and the pinned
      // one report the same package version (0.2.0), so version can't gate
      // reuse. Gate on the lifecycle-recorded spawn-tag sidecar instead.
      const health = await healthCheck(existing.port);
      const sidecar = readSpawnTag(sPath);
      if (health.ok && sidecar?.spawnTag === tag) {
        return {
          port: existing.port,
          pid: existing.pid,
          version: tag,
          reused: true,
        };
      }
      // Dead, or the spawn-tag sidecar is missing / from a different tag — the
      // daemon is stale or unverifiable. Kill, clear both files, respawn fresh.
      killProcess(existing.pid, seam);
      removeHandle(hPath);
      removeSpawnTag(sPath);
    }

    return spawnAndWait({
      repoRoot,
      tag,
      ledgerDir,
      portFilePath: hPath,
      seam,
      deadlineMs,
      sidecarPath: sPath,
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
