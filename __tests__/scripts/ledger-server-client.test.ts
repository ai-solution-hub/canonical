/**
 * ledger-server-client.test.ts — transport client tests (ID-90.17 K2).
 *
 * Tests use REAL ephemeral HTTP servers (port 0, loopback) and the global
 * `fetch` — fetch is NEVER mocked (test-philosophy). Backoff delays are
 * eliminated via the injectable `config.sleep` (no fake-timers needed).
 *
 * Invariants exercised: 12-14 (envelope mapping + error-code preservation),
 * 43-45 (retry + re-derive + exhaustion + retry-warning), {35.32} mirror
 * mapping, inv 54 (connection-refused lifecycle respawn).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  transportCommit,
  jitteredDelay,
  isConnectionRefused,
  BACKOFF_BASE_MS,
  JITTER_FACTOR,
  MAX_RETRIES,
  type TransportRequest,
} from '@/scripts/ledger-server-client';
import { resolveTag } from '@/scripts/ledger-server-lifecycle';

// ── test server helper ────────────────────────────────────────────────────────

type RequestHandler = (
  req: IncomingMessage,
  body: string,
) => { status: number; json: unknown };

/** Start a real ephemeral HTTP server on a random port. */
function startServer(
  handler: RequestHandler,
): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const result = handler(req, body);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.json));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

const noSleep = async () => {};

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers.length = 0;
  vi.restoreAllMocks();
});

async function serve(handler: RequestHandler) {
  const s = await startServer(handler);
  servers.push(s.server);
  return s;
}

function patchRequest(url: string): TransportRequest {
  return {
    url: `${url}/api/ledger/task-list/record/42`,
    method: 'PATCH',
    body: {
      baseMtime: '1000',
      patches: [{ fieldPath: ['tasks', '42', 'status'], newValue: 'done' }],
    },
  };
}

// ── pure helper tests ─────────────────────────────────────────────────────────

describe('jitteredDelay (T-2 backoff)', () => {
  it('returns a value within [base*0.5, base*1.5]', () => {
    for (const base of BACKOFF_BASE_MS) {
      for (let i = 0; i < 50; i++) {
        const d = jitteredDelay(base);
        expect(d).toBeGreaterThanOrEqual(
          Math.round(base * (1 - JITTER_FACTOR)),
        );
        expect(d).toBeLessThanOrEqual(Math.round(base * (1 + JITTER_FACTOR)));
      }
    }
  });

  it('returns exact base when Math.random returns 0.5', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(jitteredDelay(100)).toBe(100);
  });

  it('returns base*0.5 when Math.random returns 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(jitteredDelay(100)).toBe(50);
  });

  it('returns base*1.5 when Math.random returns 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(jitteredDelay(100)).toBe(150);
  });
});

describe('isConnectionRefused', () => {
  it('detects TypeError with "fetch failed"', () => {
    expect(isConnectionRefused(new TypeError('fetch failed'))).toBe(true);
  });

  it('detects ECONNREFUSED code', () => {
    const err = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    expect(isConnectionRefused(err)).toBe(true);
  });

  it('detects ECONNRESET code', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(isConnectionRefused(err)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isConnectionRefused(new Error('timeout'))).toBe(false);
    expect(isConnectionRefused(null)).toBe(false);
  });
});

// ── success mapping ───────────────────────────────────────────────────────────

describe('transportCommit success mapping', () => {
  it('maps a 200 success to CliResult ok:true with the threaded resultPayload', async () => {
    // ID-90.25 GAP 1: mapSuccess returns the caller's per-subcommand
    // `resultPayload` (the flag-OFF shape, e.g. `{taskId,status}`), NOT the
    // stripped server body (`{newMtime,recordId}`). The server's newMtime is
    // intentionally discarded so the flag-ON envelope matches flag-OFF.
    const { url } = await serve(() => ({
      status: 200,
      json: { ok: true, newMtime: '2000', recordId: '42' },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
        resultPayload: { taskId: '42', status: 'done' },
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subcommand).toBe('flip-task');
    // The flag-OFF-matching payload is returned verbatim …
    expect(r.result).toEqual({ taskId: '42', status: 'done' });
    // … and the stripped server body is NOT leaked into `result`.
    expect((r.result as { newMtime?: string }).newMtime).toBeUndefined();
    expect((r.result as { recordId?: string }).recordId).toBeUndefined();
  });

  it('passes through server warnings', async () => {
    const { url } = await serve(() => ({
      status: 200,
      json: {
        ok: true,
        warnings: ['budget(untouched): description 450/300 chars'],
      },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'update-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([
      'budget(untouched): description 450/300 chars',
    ]);
  });

  it('maps mirrorRegen:"suppressed" from the server', async () => {
    const { url } = await serve(() => ({
      status: 200,
      json: { ok: true, mirrorRegen: 'suppressed' },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('suppressed');
  });

  it('maps client-side regenMirrors:false to suppressed', async () => {
    const { url } = await serve(() => ({
      status: 200,
      json: { ok: true },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
        options: { regenMirrors: false },
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('suppressed');
  });

  it('mirrorStale is false on normal success', async () => {
    const { url } = await serve(() => ({
      status: 200,
      json: { ok: true },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStale).toBe(false);
  });
});

// ── error mapping ─────────────────────────────────────────────────────────────

describe('transportCommit error mapping (inv 14 — codes preserved)', () => {
  it('preserves error code + detail verbatim', async () => {
    const { url } = await serve(() => ({
      status: 422,
      json: { error: 'budget-exceeded', detail: 'description: 450 > 300' },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'update-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('budget-exceeded');
    expect(r.detail).toBe('description: 450 > 300');
  });

  it('preserves client-name-guard code', async () => {
    const { url } = await serve(() => ({
      status: 422,
      json: { error: 'client-name-guard', detail: 'net-new: +2 in task-list' },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'update-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('client-name-guard');
  });

  it('preserves client-name-guard-config code (500)', async () => {
    const { url } = await serve(() => ({
      status: 500,
      json: { error: 'client-name-guard-config', detail: 'denylist invalid' },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('client-name-guard-config');
  });

  it('preserves issues array', async () => {
    const issues = [
      { code: 'invalid_type', path: ['status'], message: 'Expected string' },
    ];
    const { url } = await serve(() => ({
      status: 422,
      json: { error: 'schema-error', issues },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toEqual(issues);
  });
});

// ── 409 retry (T-2) ──────────────────────────────────────────────────────────

describe('transportCommit 409 retry (T-2, inv 43-45)', () => {
  it('retries on 409 and succeeds on the second attempt', async () => {
    let callCount = 0;
    const { url } = await serve(() => {
      callCount++;
      if (callCount === 1) {
        return { status: 409, json: { error: 'mtime-mismatch' } };
      }
      return { status: 200, json: { ok: true, newMtime: '3000' } };
    });

    let deriveCount = 0;
    const r = await transportCommit(
      {
        deriveRequest: () => {
          deriveCount++;
          return patchRequest(url);
        },
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );

    expect(r.ok).toBe(true);
    expect(callCount).toBe(2);
    // deriveRequest called on initial + retry
    expect(deriveCount).toBe(2);
  });

  it('appends mtime-conflict retry warning on success-after-retry (inv 45)', async () => {
    let callCount = 0;
    const { url } = await serve(() => {
      callCount++;
      if (callCount <= 2)
        return { status: 409, json: { error: 'mtime-mismatch' } };
      return { status: 200, json: { ok: true, warnings: ['existing-warn'] } };
    });
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toContain('existing-warn');
    expect(r.warnings).toContain(
      'mtime-conflict: write succeeded after 2 retries',
    );
  });

  it('singular "retry" for exactly 1 retry', async () => {
    let callCount = 0;
    const { url } = await serve(() => {
      callCount++;
      if (callCount === 1)
        return { status: 409, json: { error: 'mtime-mismatch' } };
      return { status: 200, json: { ok: true } };
    });
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toContain(
      'mtime-conflict: write succeeded after 1 retry',
    );
  });

  it('exhaustion after MAX_RETRIES → mtime-mismatch error (inv 44)', async () => {
    const { url } = await serve(() => ({
      status: 409,
      json: { error: 'mtime-mismatch', detail: 'stale baseMtime' },
    }));

    let deriveCount = 0;
    const r = await transportCommit(
      {
        deriveRequest: () => {
          deriveCount++;
          return patchRequest(url);
        },
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('mtime-mismatch');
    expect(r.detail).toBe('stale baseMtime');
    // 4 total submissions: 1 initial + 3 retries
    expect(deriveCount).toBe(MAX_RETRIES + 1);
  });

  it('invokes sleep with jittered delays between retries', async () => {
    let callCount = 0;
    const { url } = await serve(() => {
      callCount++;
      if (callCount <= 3)
        return { status: 409, json: { error: 'mtime-mismatch' } };
      return { status: 200, json: { ok: true } };
    });

    vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero jitter → exact base
    const sleepCalls: number[] = [];
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      {
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    );
    expect(r.ok).toBe(true);
    expect(sleepCalls).toEqual([50, 150, 400]);
  });
});

// ── mirror-regen-failed mapping ───────────────────────────────────────────────

describe('transportCommit mirror-regen-failed → success-with-stale ({35.32})', () => {
  it('maps 500 mirror-regen-failed + canonicalWritten to ok:true + mirrorStale', async () => {
    const { url } = await serve(() => ({
      status: 500,
      json: {
        error: 'mirror-regen-failed',
        canonicalWritten: true,
        newMtime: '5000',
        warnings: ['regen child exit 1'],
      },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('regen-failed');
    expect(r.warnings).toContain('regen child exit 1');
    expect((r.result as { newMtime: string }).newMtime).toBe('5000');
  });

  it('does NOT map mirror-regen-failed without canonicalWritten', async () => {
    const { url } = await serve(() => ({
      status: 500,
      json: { error: 'mirror-regen-failed' },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    // Without canonicalWritten:true, this is a plain 500 error.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('mirror-regen-failed');
  });

  it('appends retry warning on mirror-regen-failed after retries', async () => {
    let callCount = 0;
    const { url } = await serve(() => {
      callCount++;
      if (callCount === 1)
        return { status: 409, json: { error: 'mtime-mismatch' } };
      return {
        status: 500,
        json: {
          error: 'mirror-regen-failed',
          canonicalWritten: true,
          newMtime: '6000',
        },
      };
    });
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStaleReason).toBe('regen-failed');
    expect(r.warnings).toContain(
      'mtime-conflict: write succeeded after 1 retry',
    );
  });
});

// ── connection-refused + lifecycle respawn (inv 54) ───────────────────────────

describe('transportCommit connection-refused handling (inv 54)', () => {
  it('fails with connection-refused when no ensureServer provided', async () => {
    const r = await transportCommit(
      {
        deriveRequest: () => ({
          url: 'http://127.0.0.1:1', // port 1 — unreachable
          method: 'PATCH',
          body: {},
        }),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('connection-refused');
  });

  it('respawns once then succeeds', async () => {
    let serverUrl: string | null = null;
    let respawnCalls = 0;

    const r = await transportCommit(
      {
        deriveRequest: () => ({
          url: serverUrl ?? 'http://127.0.0.1:1',
          method: 'PATCH',
          body: {},
        }),
        subcommand: 'flip-task',
        resultPayload: { taskId: '90', status: 'done' },
        ensureServer: async () => {
          respawnCalls++;
          // Start a real server on respawn.
          const s = await serve(() => ({
            status: 200,
            json: { ok: true, newMtime: '7000' },
          }));
          serverUrl = s.url;
        },
      },
      { sleep: noSleep },
    );

    expect(respawnCalls).toBe(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ID-90.25 GAP 1: the threaded payload survives the respawn path too.
    expect(r.result).toEqual({ taskId: '90', status: 'done' });
  });

  it('fails loud after respawn also fails', async () => {
    const r = await transportCommit(
      {
        deriveRequest: () => ({
          url: 'http://127.0.0.1:1',
          method: 'PATCH',
          body: {},
        }),
        subcommand: 'flip-task',
        ensureServer: async () => {
          throw new Error('spawn timed out');
        },
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('connection-refused');
    expect(r.detail).toContain('respawn failed');
    expect(r.detail).toContain('spawn timed out');
  });

  it('respawn budget is ONE — second connection failure is loud', async () => {
    let respawnCalls = 0;
    const r = await transportCommit(
      {
        deriveRequest: () => ({
          url: 'http://127.0.0.1:1',
          method: 'PATCH',
          body: {},
        }),
        subcommand: 'flip-task',
        ensureServer: async () => {
          respawnCalls++;
          // Respawn "succeeds" but the server is still unreachable.
        },
      },
      { sleep: noSleep },
    );
    expect(respawnCalls).toBe(1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('connection-refused');
  });
});

// ── mutation options threading (T-3) ──────────────────────────────────────────

describe('transportCommit mutation options (T-3)', () => {
  it('merges dryRun, force, allowClientName, regenMirrors into the body', async () => {
    let receivedBody: Record<string, unknown> = {};
    const { url } = await serve((_req, bodyStr) => {
      receivedBody = JSON.parse(bodyStr);
      return { status: 200, json: { ok: true } };
    });
    await transportCommit(
      {
        deriveRequest: () => ({
          url: `${url}/api/ledger/task-list/record/42`,
          method: 'PATCH',
          body: { baseMtime: '1000' },
        }),
        subcommand: 'flip-task',
        options: {
          dryRun: true,
          force: true,
          allowClientName: true,
          regenMirrors: false,
        },
      },
      { sleep: noSleep },
    );

    expect(receivedBody.baseMtime).toBe('1000');
    expect(receivedBody.dryRun).toBe(true);
    expect(receivedBody.force).toBe(true);
    expect(receivedBody.allowClientName).toBe(true);
    expect(receivedBody.regenMirrors).toBe(false);
  });

  it('does not send a body for GET requests', async () => {
    let receivedBody = '';
    const { url } = await serve((_req, bodyStr) => {
      receivedBody = bodyStr;
      return { status: 200, json: { ok: true, data: {} } };
    });
    await transportCommit(
      {
        deriveRequest: () => ({
          url: `${url}/api/ledger/task-list/record/42`,
          method: 'GET',
        }),
        subcommand: 'get',
        options: { dryRun: true },
      },
      { sleep: noSleep },
    );
    expect(receivedBody).toBe('');
  });

  it('omits false-y options from the body (not present = no override)', async () => {
    let receivedBody: Record<string, unknown> = {};
    const { url } = await serve((_req, bodyStr) => {
      receivedBody = JSON.parse(bodyStr);
      return { status: 200, json: { ok: true } };
    });
    await transportCommit(
      {
        deriveRequest: () => ({
          url: `${url}/test`,
          method: 'PATCH',
          body: { baseMtime: '1' },
        }),
        subcommand: 'flip-task',
        // No options set → body should contain only request.body fields.
      },
      { sleep: noSleep },
    );
    expect(receivedBody).toEqual({ baseMtime: '1' });
    expect('dryRun' in receivedBody).toBe(false);
    expect('force' in receivedBody).toBe(false);
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe('transportCommit edge cases', () => {
  it('handles non-JSON response body', async () => {
    // Create a raw server that returns plain text.
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not json');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push(server);
    const addr = server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    const r = await transportCommit(
      {
        deriveRequest: () => ({ url, method: 'PATCH', body: {} }),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid-response');
  });

  it('no retry warning when success on first attempt', async () => {
    const { url } = await serve(() => ({
      status: 200,
      json: { ok: true },
    }));
    const r = await transportCommit(
      {
        deriveRequest: () => patchRequest(url),
        subcommand: 'flip-task',
      },
      { sleep: noSleep },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toBeUndefined();
  });
});

// ── ID-90.25 flag-ON parity (REAL ledger server, fetch UNMOCKED) ───────────────
//
// These cases drive the REAL `scripts/ledger-cli.ts` end-to-end with
// `KH_LEDGER_SERVER=1`, so `ensureServer` spawns the REAL task-view patch-server
// clone (.cache/task-view-<tag>/) and the transport hits it over real HTTP — the
// server's responses are NEVER mocked (mocking them was the antipattern that
// masked the GAP-1/3/4 defects: the unit suite above passed against canned JSON
// while flag-ON diverged from flag-OFF). Each case asserts the flag-ON observable
// outcome (stdout envelope + on-disk bytes) matches the flag-OFF baseline.
//
// Skipped only when the clone is not provisioned (run `scripts/regen-mirrors.sh`
// or the differential-parity harness once to populate .cache/). CI provisions it.

// __tests__/scripts/ -> repo root (works under both Vitest/Node and Bun;
// import.meta.dir is a Bun-only field and is undefined under Vitest).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLONE_TAG = (() => {
  try {
    return resolveTag(REPO_ROOT);
  } catch {
    return null;
  }
})();
const CLONE_PRESENT =
  CLONE_TAG !== null &&
  existsSync(
    resolve(REPO_ROOT, `.cache/task-view-${CLONE_TAG}/apps/server/index.ts`),
  );
const FIXED_NOW = '2026-01-01T00:00:00.000Z';

// ID-68.35: repointed to synthetic fixtures (live docs/reference/ ledgers removed
// from public repo). The firstId helper now reads from __tests__/fixtures/ledger/.
// The fixture ids are stable and de-identified (task "1", backlog "1", theme "1").
const FIXTURE_LEDGER_DIR = resolve(__dirname, '../fixtures/ledger');

function firstId(filename: string, listKey: string): string {
  const doc = JSON.parse(
    readFileSync(resolve(FIXTURE_LEDGER_DIR, filename), 'utf8'),
  ) as Record<string, { id: string | number }[]>;
  const list = doc[listKey];
  if (!Array.isArray(list) || list.length === 0 || list[0].id == null) {
    throw new Error(`firstId: no ${listKey}[0].id in ${filename}`);
  }
  return String(list[0].id);
}

const FIRST_BACKLOG_ID = firstId('product-backlog.json', 'items');
const FIRST_ROADMAP_THEME_ID = firstId('product-roadmap.json', 'themes');
const FIRST_TASK_ID = firstId('task-list.json', 'tasks');

interface CliRun {
  exitCode: number;
  envelope: Record<string, unknown> | null;
  stdout: string;
}

/** Run the real ledger-cli against a fixture dir. flag-ON sets KH_LEDGER_SERVER. */
function runLedgerCli(
  ledgerDir: string,
  args: string[],
  opts: { serverOn: boolean },
): CliRun {
  const res = spawnSync(
    'bun',
    [
      'scripts/ledger-cli.ts',
      ...args,
      '--ledger-dir',
      ledgerDir,
      '--no-regen-mirrors',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        KH_LEDGER_NOW: FIXED_NOW,
        // ID-90.21 P2-F1: serverEnabled() now defaults ON. The flag-OFF arm
        // must pin '0' EXPLICITLY (the absent-variable else-arm `{}` would
        // route this arm through the server post-flip, breaking the
        // OFF-vs-ON byte-parity assertions below).
        ...(opts.serverOn
          ? { KH_LEDGER_SERVER: '1' }
          : { KH_LEDGER_SERVER: '0' }),
      },
    },
  );
  const stdout = (res.stdout ?? '').trim();
  let envelope: Record<string, unknown> | null = null;
  try {
    envelope = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    envelope = null;
  }
  return { exitCode: res.status ?? 1, envelope, stdout };
}

describe.skipIf(!CLONE_PRESENT)('ID-90.25 flag-ON parity (real server)', () => {
  // Honour $TMPDIR (sandbox-writable); os.tmpdir() can report a blocked path.
  const TMP_BASE = process.env.TMPDIR ?? tmpdir();
  // Track the mkdtemp ROOTS so cleanup removes the exact dirs we created
  // (never a re-derived `..` path that could escape to the tmp base).
  let fixtureRoots: string[] = [];

  function fixtureDir(): string {
    // ID-68.35: cpSync from synthetic fixture dir instead of live docs/reference/.
    const root = mkdtempSync(join(TMP_BASE, 'ledger-9025-'));
    const refDir = join(root, 'docs', 'reference');
    cpSync(FIXTURE_LEDGER_DIR, refDir, { recursive: true });
    fixtureRoots.push(root);
    return refDir;
  }

  afterEach(() => {
    for (const root of fixtureRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    fixtureRoots = [];
  });

  // GAP 1 — success-envelope shape parity for a field-patch. The task id is
  // derived from the live fixture content (ID-90.21), not hardcoded, so a
  // concurrent task deletion cannot 404 this case on the flag-OFF arm.
  it('flip-task flag-ON returns the flag-OFF `{taskId,status}` envelope, not the server body', () => {
    const off = runLedgerCli(
      fixtureDir(),
      ['flip-task', FIRST_TASK_ID, 'in_progress'],
      { serverOn: false },
    );
    const on = runLedgerCli(
      fixtureDir(),
      ['flip-task', FIRST_TASK_ID, 'in_progress'],
      { serverOn: true },
    );

    expect(off.exitCode).toBe(0);
    expect(on.exitCode).toBe(0);
    // flag-ON `result` is the per-subcommand payload, identical to flag-OFF.
    expect(on.envelope?.result).toEqual({
      taskId: FIRST_TASK_ID,
      status: 'in_progress',
    });
    expect(on.envelope?.result).toEqual(off.envelope?.result);
    // The stripped server body must NOT leak into `result`.
    expect(on.envelope?.result).not.toHaveProperty('newMtime');
    expect(on.envelope?.result).not.toHaveProperty('recordId');
  });

  // GAP 4 — dry-run returns `{dryRun:true,...}` AND the server writes nothing.
  it('flip-task --dry-run flag-ON returns {dryRun:true,...} and writes nothing', () => {
    const dir = fixtureDir();
    const before = readFileSync(join(dir, 'task-list.json'));
    const on = runLedgerCli(
      dir,
      ['flip-task', FIRST_TASK_ID, 'done', '--dry-run'],
      { serverOn: true },
    );
    const after = readFileSync(join(dir, 'task-list.json'));

    expect(on.exitCode).toBe(0);
    expect(on.envelope?.result).toEqual({
      dryRun: true,
      taskId: FIRST_TASK_ID,
      status: 'done',
    });
    // The real server honoured dryRun: the canonical file is byte-unchanged.
    expect(after.equals(before)).toBe(true);
  });

  // GAP 3 — backlog + roadmap slug addressing resolves after the slug fix
  // (pre-fix: `product-backlog`/`product-roadmap` 404'd → exit 1). Record ids
  // are derived from the live fixture content (ID-90.21) so a concurrent
  // deletion cannot regress these to a `walk-error: Item id not found`. The
  // `priority low` field/value is content-independent (a valid write whether or
  // not the first item already carries that priority).
  it('update-backlog flag-ON resolves the `backlog` slug (200, parity envelope)', () => {
    const off = runLedgerCli(
      fixtureDir(),
      ['update-backlog', FIRST_BACKLOG_ID, 'priority', 'low'],
      { serverOn: false },
    );
    const on = runLedgerCli(
      fixtureDir(),
      ['update-backlog', FIRST_BACKLOG_ID, 'priority', 'low'],
      { serverOn: true },
    );
    expect(off.exitCode).toBe(0);
    expect(on.exitCode).toBe(0);
    expect(on.envelope?.ok).toBe(true);
    expect(on.envelope?.result).toEqual(off.envelope?.result);
  });

  it('update-roadmap flag-ON resolves the `roadmap` slug (200, parity envelope)', () => {
    const off = runLedgerCli(
      fixtureDir(),
      ['update-roadmap', FIRST_ROADMAP_THEME_ID, 'status', 'in_progress'],
      { serverOn: false },
    );
    const on = runLedgerCli(
      fixtureDir(),
      ['update-roadmap', FIRST_ROADMAP_THEME_ID, 'status', 'in_progress'],
      { serverOn: true },
    );
    expect(off.exitCode).toBe(0);
    expect(on.exitCode).toBe(0);
    expect(on.envelope?.ok).toBe(true);
    expect(on.envelope?.result).toEqual(off.envelope?.result);
  });

  // ID-90.22 R1b — `--whole-file` STILL PARSES (invariant 8 — argv stability)
  // but is a write-path NO-OP post-R1b: it no longer routes to a LOCAL path.
  // The patch-server substrate is the unconditional write enforcement point,
  // so flag-ON `--whole-file` and flag-OFF emit byte-identical minimal-diff
  // bytes (post-OQ-LS-2 the two shapes already converged). This asserts that
  // NO-OP equivalence — the flag does not change where or how bytes are written.
  it('flip-task --whole-file flag-ON takes the local path and equals flag-OFF bytes', () => {
    const dirOff = fixtureDir();
    const dirOn = fixtureDir();
    const off = runLedgerCli(dirOff, ['flip-task', FIRST_TASK_ID, 'pending'], {
      serverOn: false,
    });
    const on = runLedgerCli(
      dirOn,
      ['flip-task', FIRST_TASK_ID, 'pending', '--whole-file'],
      { serverOn: true },
    );
    const offWhole = runLedgerCli(
      dirOff,
      ['flip-task', FIRST_TASK_ID, 'pending', '--whole-file'],
      { serverOn: false },
    );

    expect(off.exitCode).toBe(0);
    expect(on.exitCode).toBe(0);
    expect(offWhole.exitCode).toBe(0);
    // Byte-identical whole-file output across the flag boundary.
    const bytesOff = readFileSync(join(dirOff, 'task-list.json'));
    const bytesOn = readFileSync(join(dirOn, 'task-list.json'));
    expect(bytesOn.equals(bytesOff)).toBe(true);
    // Envelope parity too (the NO-OP flag emits the same success shape).
    expect(on.envelope?.result).toEqual(offWhole.envelope?.result);
  });

  // ID-90.26 — `delete-backlog` flag-ON must reach flag-OFF parity through
  // the SERVER TRANSPORT. The pre-fix defect nested `serverIntent` inside the
  // `gate` literal (a RecordSetGate excess property — TS2353), so
  // `opts.serverIntent` was `undefined` and the flag-ON guard
  // `serverEnabled() && opts.serverIntent && ...` fell through to the direct
  // write path (the only OTHER mutating site to mis-route this way).
  //
  // Routing is engineered to be observationally transparent (GAP 1/4: the
  // server envelope is byte-identical to flag-OFF), so the wrong-path bug is
  // compile-time-detectable (the TS2353 gate) but runtime-invisible at the
  // envelope level. This case is therefore the slug-addressed parity lock
  // (sibling of the update-backlog/update-roadmap GAP-3 cases): it pins the
  // `backlog` slug resolution AND byte-identical output for the server-routed
  // delete, so a future server-path divergence (slug 404 → non-zero exit, or
  // serialiser drift → byte mismatch) is caught here.
  it('delete-backlog flag-ON reaches flag-OFF parity via the server transport', () => {
    const dirOff = fixtureDir();
    const dirOn = fixtureDir();
    // Record id is derived from the live fixture content (ID-90.21): a hardcoded
    // backlog id would 404 here once a concurrent session resolves that item.
    const off = runLedgerCli(dirOff, ['delete-backlog', FIRST_BACKLOG_ID], {
      serverOn: false,
    });
    const on = runLedgerCli(dirOn, ['delete-backlog', FIRST_BACKLOG_ID], {
      serverOn: true,
    });

    expect(off.exitCode).toBe(0);
    // Server-routed delete must NOT 404 on the `backlog` slug (GAP-3 class).
    expect(on.exitCode).toBe(0);
    expect(on.envelope?.ok).toBe(true);
    // The transport's per-subcommand payload is `{recordId}`, identical to the
    // flag-OFF direct-write payload — and the stripped server body (newMtime
    // etc.) must NOT leak into `result`.
    expect(on.envelope?.result).toEqual(off.envelope?.result);
    expect(on.envelope?.result).not.toHaveProperty('newMtime');
    // The record is actually gone from the server-written file, byte-identical
    // to the flag-OFF write.
    const bytesOff = readFileSync(join(dirOff, 'product-backlog.json'));
    const bytesOn = readFileSync(join(dirOn, 'product-backlog.json'));
    expect(bytesOn.equals(bytesOff)).toBe(true);
    const onDoc = JSON.parse(bytesOn.toString()) as { items: { id: string }[] };
    expect(onDoc.items.some((i) => String(i.id) === FIRST_BACKLOG_ID)).toBe(
      false,
    );
  });
});
