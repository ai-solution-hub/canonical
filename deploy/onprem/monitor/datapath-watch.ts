/**
 * datapath-watch.ts — `pipeline_runs` stall-watch (ID-66 {66.15})
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PREMISE — why this monitor exists (RESEARCH §4-i; server.py:_health_handler
 * :131-148):
 *
 *   "container up + `/health` green" is INSUFFICIENT evidence the datapath works.
 *   `/health` reflects only the cocoindex worker thread's LIVENESS — it returns
 *   503 only if the worker thread itself crashed. It says NOTHING about whether
 *   ingestion is actually PRODUCING ROWS. A successful ingestion is confirmed by
 *   `pipeline_runs` ROW ARRIVAL in Supabase, never by the probe.
 *
 *   This monitor therefore reads `pipeline_runs` in Supabase — full stop. It does
 *   not call `/health`, it does not infer health from container/process state.
 *   (Gotcha-B: this is NOT CocoInsight. CocoInsight is a dev-time LMDB inspector,
 *   not a prod stall-watch — do not conflate.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY. This monitor only SELECTs from `pipeline_runs`. It performs no
 * writes, no DDL, and touches no KH application/pipeline code. The cocoindex
 * pipeline (`scripts/cocoindex_pipeline/flow.py`), the record route
 * (`app/api/internal/pipeline-runs/record/route.ts`), and all migrations are
 * OUT OF SCOPE for this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT ARMED. This file is the ARTEFACT only. There is no cron, no Coolify
 * scheduled task, and no live webhook URL / Sentry DSN baked in. Activation
 * (schedule N minutes + alert sink + the `INGESTION_EXPECTED` toggle) is
 * OPERATOR-GATED — see `docs/runbooks/onprem-b1-deploy.md` §`{66.15}`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GOTCHA-A — BLOCKING schema/code mismatch (FLAGGED here; NOT fixed in this file):
 *
 *   The live `pipeline_runs_status_check` CHECK constraint (confirmed by
 *   `pg_constraint` introspection on staging `turayklvaunphgbgscat`) is:
 *     CHECK (status = ANY (ARRAY[
 *       'running','completed','completed_with_errors','failed']))
 *   — it does NOT include `'in_progress'`. But the flow-start emit
 *   (flow.py, status="in_progress") and the route's `PipelineStatusSchema` both
 *   emit/accept `in_progress`, and `recordPipelineRun` does a plain INSERT (not an
 *   upsert). Result: every flow-start insert currently VIOLATES the constraint and
 *   throws — caught by `recordPipelineRun`'s never-throws guard → a Sentry error
 *   fires, but NO `in_progress` row ever lands. This silently breaks condition (A)'s
 *   primary signal.
 *
 *   Condition (A) below is therefore GATED on a SEPARATE, pre-existing migration
 *   defect that widens the constraint to include `'in_progress'`. That migration is
 *   a distinct subtask — it is NOT fixed here, and this file edits no
 *   flow.py/route.ts/migration. Until it lands, condition (A) is dead code (no
 *   `in_progress` rows exist to detect). See runbook §`{66.15}` Gotcha-A and the
 *   ID-66 Cross-cutting flag.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GOTCHA-C — `started_at` vs `completed_at`:
 *
 *   `pipeline_runs.started_at` defaults to now() at insert, and `recordPipelineRun`
 *   ALSO stamps `completed_at = now()` on EVERY insert (including the flow-start
 *   row). So `completed_at` is NOT a reliable "is this run still in flight" signal.
 *   Condition (A) keys off `op_id` + `status` (is a TERMINAL row present for the
 *   op_id?), never off `completed_at` being null.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIG (all via env; documented in runbook §`{66.15}`):
 *
 *   SUPABASE_URL                  Supabase project URL (REQUIRED).
 *   SUPABASE_SERVICE_ROLE_KEY     Service-role key — a service-role READER that
 *                                 bypasses RLS structurally (REQUIRED). This is NOT
 *                                 the app's request-scoped `getAuthorisedClient`;
 *                                 the monitor runs host-side, outside the request
 *                                 lifecycle, like the cron handlers.
 *   STALL_THRESHOLD_MINUTES       Condition (A): minutes an op_id may sit
 *                                 in_progress with no terminal row before it is a
 *                                 stall. Default 30.
 *   EXPECTED_RUN_WINDOW_MINUTES   Condition (C): max minutes of silence tolerated
 *                                 during a KNOWN-active ingestion window. Default 60.
 *   INGESTION_EXPECTED            Condition (C) gate. "true" → ingestion is known
 *                                 active, so silence is a stall. Anything else →
 *                                 idle, silence is correct (no alert). Default false.
 *   COCOINDEX_SOURCE_PATH         Read to detect IDLE BOOT. Empty/unset → idle, the
 *                                 monitor must not alert on silence (else it pages on
 *                                 every burn-safe idle deploy).
 *   MONITOR_ALERT_WEBHOOK_URL     Alert sink (Discord/Telegram/email webhook). If
 *                                 set, alerts POST here. Operator picks the channel
 *                                 by env, no code change.
 *   SENTRY_DSN                    Fallback alert sink. If `MONITOR_ALERT_WEBHOOK_URL`
 *                                 is unset but a DSN is present, alerts route to
 *                                 Sentry.captureMessage (wired by the operator at
 *                                 activation — not imported here to keep the artefact
 *                                 dependency-light and unarmed).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Minimal row shape for the `pipeline_runs` SELECT this monitor performs.
 *
 * The select column list mirrors the reference read in
 * `app/api/admin/pipeline-runs/recent/route.ts`
 * (`pipeline_name, status, started_at, completed_at, error_message`) PLUS `op_id`,
 * which condition (A) keys off (per Gotcha-C).
 *
 * A local interface (rather than `Tables<'pipeline_runs'>` from
 * `@/supabase/types/database.types`) is used DELIBERATELY: this monitor is a
 * STANDALONE host-side artefact that must remain decoupled from the Next.js app's
 * generated-type surface so it can run on a tiny tooling container / host cron
 * outside the app's tsconfig graph. The shape is pinned to exactly the columns the
 * stall predicate consumes.
 */
export interface PipelineRunRow {
  pipeline_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  op_id: string | null;
  error_message: string | null;
}

/** Terminal statuses — a row in any of these CLOSES an op_id's run. */
export const TERMINAL_STATUSES = [
  'completed',
  'completed_with_errors',
  'failed',
] as const;

/**
 * Tunable thresholds + the idle/active gates. All sourced from env at the call
 * site (see `loadConfig`), but passed explicitly into the PURE predicate so it is
 * unit-testable without env or a live DB.
 */
export interface MonitorConfig {
  stallThresholdMinutes: number;
  expectedRunWindowMinutes: number;
  /** Condition (C) gate: is ingestion KNOWN to be active right now? */
  ingestionExpected: boolean;
  /** Idle-boot detector: cocoindex source path. Empty/undefined → idle. */
  cocoindexSourcePath: string | undefined;
}

/** A single stall finding. `condition` identifies which check fired. */
export interface Alert {
  condition: 'A' | 'B' | 'C';
  severity: 'warning' | 'error';
  message: string;
  /** The op_id implicated (conditions A/B), if any. */
  opId?: string | null;
}

const MS_PER_MINUTE = 60_000;

/** True when the deploy is in idle boot — no source staged, nothing to ingest. */
function isIdle(config: MonitorConfig): boolean {
  const path = config.cocoindexSourcePath?.trim();
  return !path;
}

function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * detectStalls — the PURE, unit-testable core.
 *
 * Given the recent `pipeline_runs` rows, the config, and the current time `now`
 * (passed in, NOT read from Date.now() — matches KH date-test discipline), return
 * the set of stall alerts. No I/O, no env reads, no clock reads. Deterministic.
 *
 *   (A) Stuck-in-flight: an op_id with an `in_progress` row but NO terminal row
 *       for the same op_id, where the in_progress row started more than
 *       STALL_THRESHOLD_MINUTES ago. Keyed off op_id + status (Gotcha-C), never
 *       off completed_at. NOTE: gated on the Gotcha-A constraint fix — no
 *       in_progress rows can land until it ships, so this is currently a dead
 *       signal by DB state, not by this code.
 *
 *   (B) Terminal failure: any recent `failed` row in the window. `recordPipelineRun`
 *       already Sentry-alerts on `failed`/`completed_with_errors`; this monitor adds
 *       a host-side cross-check / digest so a missed Sentry alert is still caught.
 *
 *   (C) Silence during an active-ingestion window: when ingestion is KNOWN active
 *       AND the deploy is not idle, NO row newer than EXPECTED_RUN_WINDOW_MINUTES →
 *       datapath stall. GATED on `ingestionExpected` AND `!isIdle` so the monitor
 *       stays quiet on every burn-safe idle deploy (the idle-mode guard).
 */
export function detectStalls(
  rows: PipelineRunRow[],
  config: MonitorConfig,
  now: Date,
): Alert[] {
  const alerts: Alert[] = [];
  const nowMs = now.getTime();

  // ── Condition (A): stuck-in-flight ──────────────────────────────────────────
  // Collect terminal op_ids, then flag any in_progress op_id without one that is
  // older than the stall threshold.
  const terminalOpIds = new Set<string>();
  for (const row of rows) {
    if (row.op_id && isTerminal(row.status)) {
      terminalOpIds.add(row.op_id);
    }
  }

  const stallThresholdMs = config.stallThresholdMinutes * MS_PER_MINUTE;
  const flaggedOpIds = new Set<string>();
  for (const row of rows) {
    if (row.status !== 'in_progress' || !row.op_id) continue;
    if (terminalOpIds.has(row.op_id)) continue; // run closed — healthy
    if (flaggedOpIds.has(row.op_id)) continue; // already flagged this op_id

    const ageMs = nowMs - new Date(row.started_at).getTime();
    if (ageMs > stallThresholdMs) {
      flaggedOpIds.add(row.op_id);
      alerts.push({
        condition: 'A',
        severity: 'error',
        opId: row.op_id,
        message:
          `Stuck-in-flight: op_id=${row.op_id} (${row.pipeline_name}) has been ` +
          `in_progress for ${Math.round(ageMs / MS_PER_MINUTE)} min with no ` +
          `terminal row (threshold ${config.stallThresholdMinutes} min).`,
      });
    }
  }

  // ── Condition (B): terminal failure ─────────────────────────────────────────
  // recordPipelineRun already Sentry-alerts on these; this is the host-side
  // cross-check/digest.
  for (const row of rows) {
    if (row.status !== 'failed') continue;
    alerts.push({
      condition: 'B',
      severity: 'error',
      opId: row.op_id,
      message:
        `Terminal failure: ${row.pipeline_name} run` +
        `${row.op_id ? ` op_id=${row.op_id}` : ''} reported status=failed` +
        `${row.error_message ? ` — ${row.error_message}` : ''}.`,
    });
  }

  // ── Condition (C): silence during a KNOWN-active ingestion window ────────────
  // Idle-mode guard (load-bearing): only fires when ingestion is KNOWN active AND
  // the deploy is NOT idle. In idle boot or when ingestion is not expected, no rows
  // is the CORRECT state — stay quiet.
  if (config.ingestionExpected && !isIdle(config)) {
    const windowMs = config.expectedRunWindowMinutes * MS_PER_MINUTE;
    const cutoffMs = nowMs - windowMs;
    const hasRecentRow = rows.some(
      (row) => new Date(row.started_at).getTime() >= cutoffMs,
    );
    if (!hasRecentRow) {
      alerts.push({
        condition: 'C',
        severity: 'error',
        message:
          `Datapath silence: ingestion is expected (INGESTION_EXPECTED=true) but ` +
          `no pipeline_runs row arrived in the last ` +
          `${config.expectedRunWindowMinutes} min. Rows should be arriving but ` +
          `aren't — probable datapath stall (NOT idle).`,
      });
    }
  }

  return alerts;
}

/* ───────────────────────── I/O boundary (runtime only) ───────────────────── */

/** Parse the monitor config from the process environment. */
export function loadConfig(env: NodeJS.ProcessEnv): MonitorConfig {
  return {
    stallThresholdMinutes: Number(env.STALL_THRESHOLD_MINUTES ?? 30),
    expectedRunWindowMinutes: Number(env.EXPECTED_RUN_WINDOW_MINUTES ?? 60),
    ingestionExpected: env.INGESTION_EXPECTED === 'true',
    cocoindexSourcePath: env.COCOINDEX_SOURCE_PATH,
  };
}

/**
 * Fetch the recent `pipeline_runs` rows via a standalone service-role client.
 *
 * The lookback window is the larger of the stall threshold and the expected-run
 * window (plus headroom) so condition (A)'s in_progress rows and condition (C)'s
 * silence check both have enough history. Read-only SELECT.
 */
export async function fetchRecentRuns(
  config: MonitorConfig,
  env: NodeJS.ProcessEnv,
): Promise<PipelineRunRow[]> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'datapath-watch: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
  }

  // Service-role reader: bypasses RLS structurally (like the cron handlers). NOT
  // the app's request-scoped getAuthorisedClient.
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const lookbackMinutes =
    Math.max(config.stallThresholdMinutes, config.expectedRunWindowMinutes) * 2;
  const since = new Date(
    Date.now() - lookbackMinutes * MS_PER_MINUTE,
  ).toISOString();

  const { data, error } = await supabase
    .from('pipeline_runs')
    .select('pipeline_name, status, started_at, completed_at, op_id, error_message')
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) {
    throw new Error(`datapath-watch: pipeline_runs read failed — ${error.message}`);
  }

  return (data ?? []) as PipelineRunRow[];
}

/**
 * Single env-configurable alert sink. The operator picks the channel by env, no
 * code change:
 *   - MONITOR_ALERT_WEBHOOK_URL set → POST the digest to that webhook.
 *   - else SENTRY_DSN set → route via Sentry.captureMessage (operator wires the
 *     @sentry/node init at activation; not imported here to keep the artefact
 *     dependency-light and UNARMED).
 *   - neither → no-op with a stderr note (so a misconfigured deploy is visible).
 */
export async function dispatchAlerts(
  alerts: Alert[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (alerts.length === 0) return;

  const webhook = env.MONITOR_ALERT_WEBHOOK_URL;
  const payload = {
    source: 'datapath-watch ({66.15})',
    detectedAt: new Date().toISOString(),
    alertCount: alerts.length,
    alerts,
  };

  if (webhook) {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return;
  }

  if (env.SENTRY_DSN) {
    // Operator-gated: at activation, wire @sentry/node init + captureMessage here.
    // Left unarmed in the committed artefact (no DSN baked in, no import).
    process.stderr.write(
      `datapath-watch: SENTRY_DSN present but Sentry sink is operator-gated. ` +
        `Wire Sentry.captureMessage at activation. Payload: ${JSON.stringify(payload)}\n`,
    );
    return;
  }

  process.stderr.write(
    `datapath-watch: ${alerts.length} alert(s) but no sink configured ` +
      `(set MONITOR_ALERT_WEBHOOK_URL or SENTRY_DSN). Payload: ${JSON.stringify(payload)}\n`,
  );
}

/**
 * Entry point for a scheduled run (host cron / tooling container). NOT invoked at
 * import time — the operator wires the schedule per runbook §`{66.15}`. Returns the
 * alerts so a wrapper can set an exit code if desired.
 */
export async function runOnce(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<Alert[]> {
  const config = loadConfig(env);
  const rows = await fetchRecentRuns(config, env);
  const alerts = detectStalls(rows, config, now);
  await dispatchAlerts(alerts, env);
  return alerts;
}
