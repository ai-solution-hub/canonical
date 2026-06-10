/**
 * ledger-server-client.ts — HTTP transport client for the ledger server.
 * ID-90.17, TECH §Proposed changes K2 + §Decisions T-2.
 *
 * Maps HTTP responses from the task-view patch-server (v0.4.0-task-view) into
 * the CliResult envelope consumed by `scripts/ledger-cli.ts`. The façade (K4,
 * {90.19}) builds TransportRequest from a ServerIntent and calls
 * `transportCommit`; this module owns the wire protocol, retry loop and
 * envelope mapping — nothing else.
 *
 * Contract (invariants 12-14, 43-45):
 *   - Error codes pass through verbatim (inv 14). ONE transport addition:
 *     `mtime-mismatch` on 409 exhaustion. Guard codes `client-name-guard` /
 *     `client-name-guard-config` preserved as-is.
 *   - T-2 bounded retry: 409 consumed by the loop — max 3 retries (4 total
 *     submissions), backoff 50/150/400ms with ±50% jitter, per-intent
 *     re-derive via the `deriveRequest` callback (inv 43).
 *   - Exhaustion → {ok:false, error:'mtime-mismatch'} exit 1, nothing written,
 *     safely re-runnable (inv 44).
 *   - Success-after-retry appends 'mtime-conflict: write succeeded after N
 *     retry/retries' to warnings[] (inv 45).
 *   - Mirror mapping: 500 `mirror-regen-failed` with `canonicalWritten:true` →
 *     {ok:true, mirrorStale:true, mirrorStaleReason:'regen-failed'} ({35.32}).
 *     `regenMirrors:false` → mirrorStaleReason:'suppressed'.
 *   - Connection-refused: ONE lifecycle respawn attempt (record 18 seam),
 *     separate from the 409 budget, then fail loud (inv 54).
 *   - Server warnings[] pass through.
 */

import type { CliResult, MirrorStaleReason } from '@/scripts/ledger-cli';

// ── public types ──────────────────────────────────────────────────────────────

/** HTTP request specification built by the façade from a ServerIntent. */
export interface TransportRequest {
  url: string;
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE';
  /** Request body (omitted for GET by the transport). */
  body?: Record<string, unknown>;
}

/** T-3 per-request body fields threaded from CLI flags. */
export interface MutationOptions {
  dryRun?: boolean;
  force?: boolean;
  allowClientName?: boolean;
  regenMirrors?: boolean;
  /**
   * ID-90.22 R1b (Curator AC-H1): caller-computed advisory warnings the façade
   * wants surfaced on the success envelope alongside the server's own
   * discipline/budget warnings. PREPENDED to `warnings[]` so the ordering
   * matches the deleted LOCAL path (`commitMutation` did `warnings.unshift(...)`
   * — see the removed ledger-cli.ts direct-write body). The sole live producer
   * today is the `update-task <id> status <val>` flip-task canonical-verb hint
   * (F5); without threading it here the hint is silently dropped on every server
   * write. NOT a wire/body field — purely client-side envelope shaping.
   */
  extraWarnings?: string[];
}

/** Arguments for {@link transportCommit}. */
export interface TransportCommitArgs {
  /**
   * Builds the HTTP request for each submission. Called on the initial attempt
   * and on each retry so the caller can re-derive baseMtime + any auto-id
   * from the fresh on-disk state (inv 43 re-derive classes: field-set
   * re-applies to the fresh record; append re-derives trivially server-side;
   * creates re-derive ids; deletes surface record-not-found).
   */
  deriveRequest: () => TransportRequest | Promise<TransportRequest>;
  /** CLI subcommand name for the CliResult envelope. */
  subcommand: string;
  /**
   * ID-90.25 GAP 1: the per-subcommand success payload the flag-OFF path emits
   * (e.g. `{taskId,status}`, `{itemId,field}`). Threaded through to
   * {@link mapSuccess} so the flag-ON success envelope's `result` field matches
   * flag-OFF byte-for-byte, instead of the stripped server body
   * (`{newMtime,recordId}`). The dry-run `{dryRun:true,...}` shaping is applied
   * by the caller (serverCommitMutation) so this value already carries the
   * correct shape for both live and dry-run writes.
   */
  resultPayload?: unknown;
  /** T-3 mutation options merged into the request body. */
  options?: MutationOptions;
  /**
   * Lifecycle respawn callback (record 18 seam). Called ONCE on
   * connection-refused, separate from the 409 retry budget. If absent,
   * connection-refused fails immediately.
   */
  ensureServer?: () => Promise<void>;
}

/** Injectable config — allows tests to eliminate real delays. */
export interface TransportConfig {
  /** Override the default setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

// ── constants (T-2) ───────────────────────────────────────────────────────────

/** Maximum retry count (3 retries + 1 initial = 4 total submissions). */
export const MAX_RETRIES = 3;

/** Base backoff delays in ms, indexed by retry number (0-based). */
export const BACKOFF_BASE_MS: readonly number[] = [50, 150, 400];

/** Jitter factor: ±50% of the base delay. */
export const JITTER_FACTOR = 0.5;

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute a jittered delay for a given base (exported for unit testing).
 * Result ∈ [base × 0.5, base × 1.5], uniformly distributed.
 */
export function jitteredDelay(baseMs: number): number {
  const jitter = baseMs * JITTER_FACTOR * (2 * Math.random() - 1);
  return Math.max(0, Math.round(baseMs + jitter));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Detect connection-refused / fetch-failed errors (exported for testing). */
export function isConnectionRefused(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes('fetch failed')) {
    return true;
  }
  const code = (err as { code?: string })?.code;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET';
}

// ── server response shapes ────────────────────────────────────────────────────

/** 2xx success body from the ledger server. */
interface ServerSuccessBody {
  ok: true;
  newMtime?: string;
  warnings?: string[];
  /** Present when the server suppressed mirror regen (regenMirrors:false). */
  mirrorRegen?: 'suppressed';
  [key: string]: unknown;
}

/** 4xx/5xx error body from the ledger server. */
interface ServerErrorBody {
  error: string;
  detail?: string;
  issues?: unknown[];
  /** True when the canonical JSON was written but mirror regen failed. */
  canonicalWritten?: boolean;
  newMtime?: string;
  warnings?: string[];
}

// ── response mapping ──────────────────────────────────────────────────────────

function mapSuccess(
  subcommand: string,
  body: ServerSuccessBody,
  retryCount: number,
  regenSuppressed: boolean,
  resultPayload: unknown,
  extraWarnings: string[] | undefined,
): CliResult {
  // ID-90.22 R1b (Curator AC-H1): caller advisory warnings PREPENDED, matching
  // the deleted LOCAL path's `warnings.unshift(...extraWarnings)` ordering. The
  // server's own warnings (and the retry note below) follow.
  const warnings: string[] = [
    ...(extraWarnings ?? []),
    ...(body.warnings ?? []),
  ];
  if (retryCount > 0) {
    warnings.push(
      `mtime-conflict: write succeeded after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}`,
    );
  }

  const isSuppressed = regenSuppressed || body.mirrorRegen === 'suppressed';

  // ID-90.25 GAP 1: return the caller's per-subcommand `resultPayload` (the
  // SAME shape the flag-OFF path emits, e.g. `{taskId,status}`) so flag-ON
  // success envelopes match flag-OFF byte-for-byte. Previously this stripped
  // the server body to `{newMtime,recordId}`, which diverged from flag-OFF and
  // failed the AC-P1 parity gate. The warnings + mirrorStale logic is unchanged.
  return {
    ok: true,
    subcommand,
    result: resultPayload,
    ...(warnings.length > 0 ? { warnings } : {}),
    mirrorStale: isSuppressed,
    ...(isSuppressed
      ? { mirrorStaleReason: 'suppressed' as MirrorStaleReason }
      : {}),
  };
}

function mapMirrorRegenFailed(
  subcommand: string,
  body: ServerErrorBody,
  retryCount: number,
  extraWarnings: string[] | undefined,
): CliResult {
  // ID-90.22 R1b (Curator AC-H1): prepend caller advisory warnings here too, so
  // a flip-task-hint write that ALSO hits a mirror-regen failure still surfaces
  // the canonical-verb hint (matches the deleted LOCAL prepend ordering).
  const warnings: string[] = [
    ...(extraWarnings ?? []),
    ...(body.warnings ?? []),
  ];
  if (retryCount > 0) {
    warnings.push(
      `mtime-conflict: write succeeded after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}`,
    );
  }

  return {
    ok: true,
    subcommand,
    result: { newMtime: body.newMtime },
    ...(warnings.length > 0 ? { warnings } : {}),
    mirrorStale: true,
    mirrorStaleReason: 'regen-failed',
  };
}

function mapError(subcommand: string, body: ServerErrorBody): CliResult {
  return {
    ok: false,
    subcommand,
    error: body.error,
    ...(body.detail !== undefined ? { detail: body.detail } : {}),
    ...(body.issues !== undefined
      ? { issues: body.issues as (CliResult & { ok: false })['issues'] }
      : {}),
  };
}

// ── main transport ────────────────────────────────────────────────────────────

/**
 * Send a mutation to the ledger server, mapping the HTTP response to CliResult.
 *
 * Handles T-2 bounded retry on 409 mtime-mismatch (3 retries, 4 total
 * submissions) and ONE lifecycle respawn on connection-refused (separate from
 * the 409 budget). The caller provides `deriveRequest` to re-derive the
 * request on each retry (fresh baseMtime + auto-id).
 */
export async function transportCommit(
  args: TransportCommitArgs,
  config: TransportConfig = {},
): Promise<CliResult> {
  const {
    deriveRequest,
    subcommand,
    resultPayload,
    options = {},
    ensureServer,
  } = args;
  const sleepFn = config.sleep ?? defaultSleep;
  const regenSuppressed = options.regenMirrors === false;
  // ID-90.22 R1b (Curator AC-H1): caller advisory warnings threaded into the
  // success envelope (prepended in mapSuccess).
  const extraWarnings = options.extraWarnings;

  let respawnAttempted = false;
  let retryCount = 0;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    const request = await deriveRequest();

    // T-3: mutation options as per-request body fields (never headers).
    const fetchBody: Record<string, unknown> | undefined =
      request.method === 'GET'
        ? undefined
        : {
            ...request.body,
            ...(options.dryRun ? { dryRun: true } : {}),
            ...(options.force ? { force: true } : {}),
            ...(options.allowClientName ? { allowClientName: true } : {}),
            ...(options.regenMirrors === false ? { regenMirrors: false } : {}),
          };

    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        ...(fetchBody !== undefined
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fetchBody),
            }
          : {}),
      });
    } catch (err) {
      // Connection-refused: ONE lifecycle respawn, separate from 409 budget.
      if (isConnectionRefused(err) && !respawnAttempted && ensureServer) {
        respawnAttempted = true;
        try {
          await ensureServer();
        } catch (respawnErr) {
          return {
            ok: false,
            subcommand,
            error: 'connection-refused',
            detail: `respawn failed: ${respawnErr instanceof Error ? respawnErr.message : String(respawnErr)}`,
          };
        }
        // Retry the same attempt (respawn is NOT a 409 retry).
        continue;
      }
      return {
        ok: false,
        subcommand,
        error: 'connection-refused',
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // Parse response body.
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      return {
        ok: false,
        subcommand,
        error: 'invalid-response',
        detail: `HTTP ${response.status}: response body is not JSON`,
      };
    }

    // ── 409 mtime-mismatch → T-2 bounded retry ──────────────────────────
    if (response.status === 409) {
      if (attempt < MAX_RETRIES) {
        const delay = jitteredDelay(BACKOFF_BASE_MS[attempt]);
        await sleepFn(delay);
        retryCount++;
        attempt++;
        continue;
      }
      // Exhaustion (inv 44): nothing written, safely re-runnable.
      return {
        ok: false,
        subcommand,
        error: 'mtime-mismatch',
        ...((responseBody as ServerErrorBody)?.detail !== undefined
          ? { detail: (responseBody as ServerErrorBody).detail }
          : {}),
      };
    }

    // ── 500 mirror-regen-failed + canonicalWritten → success-with-stale ──
    if (
      response.status === 500 &&
      (responseBody as ServerErrorBody)?.error === 'mirror-regen-failed' &&
      (responseBody as ServerErrorBody)?.canonicalWritten === true
    ) {
      return mapMirrorRegenFailed(
        subcommand,
        responseBody as ServerErrorBody,
        retryCount,
        extraWarnings,
      );
    }

    // ── Other errors (4xx/5xx) ───────────────────────────────────────────
    if (!response.ok) {
      return mapError(subcommand, responseBody as ServerErrorBody);
    }

    // ── Success (2xx) ────────────────────────────────────────────────────
    return mapSuccess(
      subcommand,
      responseBody as ServerSuccessBody,
      retryCount,
      regenSuppressed,
      resultPayload,
      extraWarnings,
    );
  }

  // Unreachable — the while loop always returns on every path.
  return {
    ok: false,
    subcommand,
    error: 'internal',
    detail: 'retry loop exited without returning',
  };
}
