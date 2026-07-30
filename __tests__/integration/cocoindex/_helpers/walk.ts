/**
 * id-400 — W2 walk primitives (NM-5 run-observation contract).
 *
 * HARNESS.md §2 (id-397, RATIFIED): the walk-trigger model is W2 — explicit
 * awaited walks; the 10 s background pump is DELETED. Every walk a test needs
 * is requested here, awaited here, and attributable: `awaitWalk` resolves
 * when the requested walk's registry entry is terminal AND its
 * `pipeline_runs` row has reached a terminal status AND no newer walk has
 * started (the NM-4 quiescence invariant), returning `{ opId, status,
 * stageCounts }` — the ONLY sanctioned way a test learns an op_id (§3).
 *
 * Substrate: the sidecar's walk registry (`GET /walk-status/{requestId}`,
 * server.py — id-400) maps each accepted `POST /walk` requestId to its
 * lifecycle and, on completion, the op_id `app_main` minted for that pass.
 *
 * Status vocabulary note ([SV], TRIAGE §3.5-adjacent): the pipeline_runs
 * status enum is `in_progress | completed | completed_with_errors | failed`.
 * The retired tests' `'succeeded'` filter matched NOTHING — never reintroduce
 * it (census #41 failures #15/#18).
 */

import { createLiveServiceClient } from '../../helpers/supabase-client';

export interface WalkHandle {
  requestId: string;
}

export type PipelineRunTerminalStatus =
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export interface WalkResult {
  requestId: string;
  opId: string;
  status: PipelineRunTerminalStatus;
  stageCounts: Record<string, number> | undefined;
}

/** Registry statuses that end a walk request's lifecycle. */
const TERMINAL_REGISTRY_STATUSES = new Set([
  'completed',
  'failed',
  'fence_busy',
]);

const DEFAULT_WALK_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** 409 (walk already in flight) re-request backoff. */
const IN_FLIGHT_RETRY_MS = 2_000;
/** fence_busy re-request backoff (mirrors the retired workflow bash loop). */
const FENCE_BUSY_RETRY_MS = 5_000;

function walkBaseUrl(): string {
  const base =
    process.env.COCOINDEX_STAGING_URL ??
    process.env.COCOINDEX_FIXTURE_STAGING_URL;
  if (!base) {
    throw new Error(
      'walk: COCOINDEX_STAGING_URL (or COCOINDEX_FIXTURE_STAGING_URL) is unset. ' +
        'Gate the caller behind the env check before invoking.',
    );
  }
  return base.replace(/\/$/, '');
}

function walkBearer(): string {
  const secret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!secret) {
    throw new Error(
      'walk: PIPELINE_TRIGGER_SECRET is unset — /walk and /walk-status are ' +
        'bearer-gated. The nightly job env provides it; local runs must too.',
    );
  }
  return secret;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /walk — request ONE walk. Retries a 409 (single-flight: another walk
 * in progress) until the deadline; any other non-202 is a loud failure.
 */
export async function requestWalk(opts?: {
  fullReprocess?: boolean;
  timeoutMs?: number;
}): Promise<WalkHandle> {
  const deadline = Date.now() + (opts?.timeoutMs ?? DEFAULT_WALK_TIMEOUT_MS);
  const endpoint = `${walkBaseUrl()}/walk`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${walkBearer()}`,
  };
  const body = opts?.fullReprocess
    ? JSON.stringify({ full_reprocess: true })
    : undefined;
  if (body) headers['Content-Type'] = 'application/json';

  for (;;) {
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    if (response.status === 202) {
      const parsed = (await response.json()) as { requestId?: string };
      if (!parsed.requestId) {
        throw new Error('requestWalk: 202 response carried no requestId');
      }
      return { requestId: parsed.requestId };
    }
    if (response.status === 409) {
      // Single-flight: a walk is already running. Wait and re-request — the
      // NEXT walk starts after the current pass, so it absorbs everything
      // staged before this call.
      if (Date.now() >= deadline) {
        throw new Error(
          'requestWalk: timed out waiting for the in-flight walk to release ' +
            'the single-flight slot',
        );
      }
      await sleep(IN_FLIGHT_RETRY_MS);
      continue;
    }
    const text = await response.text().catch(() => '');
    throw new Error(
      `requestWalk: POST /walk returned ${response.status}: ${text}`,
    );
  }
}

class FenceBusyError extends Error {
  constructor(requestId: string) {
    super(
      `awaitWalk: walk ${requestId} was fence-busy (no walk ran) — re-request`,
    );
    this.name = 'FenceBusyError';
  }
}

async function readRegistryEntry(
  requestId: string,
): Promise<{ status?: string; opId?: string | null }> {
  const response = await fetch(`${walkBaseUrl()}/walk-status/${requestId}`, {
    headers: { Authorization: `Bearer ${walkBearer()}` },
  });
  if (response.status === 404) {
    throw new Error(
      `awaitWalk: requestId ${requestId} unknown to the walk registry ` +
        '(evicted or never accepted)',
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `awaitWalk: GET /walk-status returned ${response.status}: ${text}`,
    );
  }
  return (await response.json()) as { status?: string; opId?: string | null };
}

/**
 * Await ONE requested walk to full, attributable completion (NM-5).
 *
 * Resolution sequence:
 *   1. registry terminal — `/walk-status/{requestId}` reaches
 *      completed | failed | fence_busy (fence_busy throws FenceBusyError for
 *      `runWalk`'s re-request loop; failed throws loudly);
 *   2. run-row terminal — the op_id's `pipeline_runs` row reaches a terminal
 *      status (the webhook write can lag the registry);
 *   3. quiescence (NM-4) — no `pipeline_runs` row newer than this walk's is
 *      `in_progress` (with the pump deleted this only trips if something else
 *      is walking the shared sidecar — a loud, honest failure).
 */
export async function awaitWalk(
  handle: WalkHandle,
  opts?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<WalkResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_WALK_TIMEOUT_MS;
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  // (1) registry terminal.
  let registryStatus: string | undefined;
  let opId: string | null | undefined;
  for (;;) {
    const entry = await readRegistryEntry(handle.requestId);
    registryStatus = entry.status;
    opId = entry.opId;
    if (registryStatus && TERMINAL_REGISTRY_STATUSES.has(registryStatus)) break;
    if (Date.now() >= deadline) {
      throw new Error(
        `awaitWalk: walk ${handle.requestId} not terminal after ${timeoutMs}ms ` +
          `(last registry status: ${registryStatus ?? 'unknown'})`,
      );
    }
    await sleep(pollIntervalMs);
  }
  if (registryStatus === 'fence_busy')
    throw new FenceBusyError(handle.requestId);
  if (registryStatus === 'failed') {
    throw new Error(
      `awaitWalk: walk ${handle.requestId} FAILED — see sidecar logs`,
    );
  }
  if (!opId) {
    throw new Error(
      `awaitWalk: walk ${handle.requestId} completed but carried no opId — ` +
        'the FlowRunContext attribution channel is broken (id-400 engine fix)',
    );
  }

  // (2) run-row terminal + (3) quiescence.
  const client = await createLiveServiceClient();
  for (;;) {
    const { data: run, error } = await client
      .from('pipeline_runs')
      .select('status, started_at, result')
      .eq('op_id', opId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `awaitWalk: pipeline_runs read failed — ${error.message}`,
      );
    }
    const status = run?.status as string | undefined;
    if (
      status === 'completed' ||
      status === 'completed_with_errors' ||
      status === 'failed'
    ) {
      // (3) NM-4 quiescence: nothing newer may be walking.
      const startedAt = run?.started_at as string | null;
      if (startedAt) {
        const { data: newer, error: newerError } = await client
          .from('pipeline_runs')
          .select('op_id')
          .eq('status', 'in_progress')
          .gt('started_at', startedAt)
          .limit(1);
        if (newerError) {
          throw new Error(
            `awaitWalk: NM-4 quiescence probe failed — pipeline_runs read ` +
              `errored (${newerError.message}); cannot verify no newer walk ` +
              'is in flight',
          );
        }
        if (newer && newer.length > 0) {
          throw new Error(
            `awaitWalk: a NEWER walk is in flight (op_id ${String(
              (newer[0] as { op_id?: string }).op_id,
            )}) — the no-background-walk invariant (NM-4) is violated; ` +
              'something else is walking the shared sidecar',
          );
        }
      }
      const result = (run?.result ?? null) as Record<string, unknown> | null;
      const stageCounts =
        (result?.stage_counts as Record<string, number> | undefined) ??
        undefined;
      return {
        requestId: handle.requestId,
        opId,
        status,
        stageCounts,
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `awaitWalk: pipeline_runs row for op_id ${opId} not terminal after ` +
          `${timeoutMs}ms (last status: ${status ?? 'absent'})`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * Request + await ONE effective walk (stage → walk → await, HARNESS §2).
 * A fence-busy pass (another writer held the {138.9} lease — no walk ran)
 * re-requests until the deadline, mirroring the retired workflow bash loop.
 */
export async function runWalk(opts?: {
  fullReprocess?: boolean;
  timeoutMs?: number;
}): Promise<WalkResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_WALK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = await requestWalk({
      fullReprocess: opts?.fullReprocess,
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    try {
      return await awaitWalk(handle, {
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
    } catch (err) {
      if (err instanceof FenceBusyError && Date.now() < deadline) {
        await sleep(FENCE_BUSY_RETRY_MS);
        continue;
      }
      throw err;
    }
  }
}
