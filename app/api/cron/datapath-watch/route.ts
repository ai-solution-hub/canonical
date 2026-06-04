// app/api/cron/datapath-watch/route.ts
//
// ID-66 {66.15} datapath monitor, re-homed as a Vercel cron (S311).
//
// WHY A VERCEL CRON (not the host-cron the runbook originally assumed): the
// monitor's whole premise is "ingestion health = `pipeline_runs` ROW ARRIVAL in
// Supabase, never `/health`/container state" — so it has ZERO on-prem dependency.
// A read-only Supabase poll fits a Vercel cron cleanly, co-located with the other
// app crons + the shared `CRON_SECRET` bearer, and needs no Node runtime on the
// slim cocoindex image (Inv-9 boundary preserved).
//
// The PURE stall predicate (`detectStalls`) + `loadConfig` + the row/alert types
// are reused verbatim from the tested standalone artefact
// (`deploy/onprem/monitor/datapath-watch.ts`, covered by
// `__tests__/deploy/onprem/monitor/datapath-watch.test.ts`). This route is the
// thin app-native adapter: cron auth, the app service-role client, and the alert
// sink. The standalone `runOnce()` is NOT reused because it builds its own client
// from `SUPABASE_URL` (the host env name) and carries an operator-gated stderr
// Sentry stub — both wrong for the app surface.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import {
  detectStalls,
  loadConfig,
  type Alert,
  type MonitorConfig,
  type PipelineRunRow,
} from '@/deploy/onprem/monitor/datapath-watch';

export const maxDuration = 30; // one Supabase read (+ optional webhook POST)

const MS_PER_MINUTE = 60_000;

/**
 * Read the recent `pipeline_runs` rows via the app's service-role client
 * (RLS-bypassing, like the other cron handlers). Lookback = 2× the larger of the
 * two windows so condition (A)'s in_progress rows and condition (C)'s silence
 * check both have enough history. Read-only SELECT — mirrors the standalone
 * `fetchRecentRuns` column list exactly.
 */
async function fetchRecentRuns(
  config: MonitorConfig,
): Promise<PipelineRunRow[]> {
  const supabase = createServiceClient();
  const lookbackMinutes =
    Math.max(config.stallThresholdMinutes, config.expectedRunWindowMinutes) * 2;
  const since = new Date(
    Date.now() - lookbackMinutes * MS_PER_MINUTE,
  ).toISOString();

  const { data, error } = await supabase
    .from('pipeline_runs')
    .select(
      'pipeline_name, status, started_at, completed_at, op_id, error_message',
    )
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) {
    throw new Error(
      `datapath-watch: pipeline_runs read failed — ${error.message}`,
    );
  }

  return (data ?? []) as PipelineRunRow[];
}

/**
 * Single env-configurable alert sink (operator picks the channel by env, no code
 * change):
 *   - MONITOR_ALERT_WEBHOOK_URL set → POST the digest to that webhook.
 *   - else → `logger.error` (the app's standard error pipeline; forwarded to
 *     Sentry by the logger integration). Always emitted so a misconfigured deploy
 *     is visible.
 */
async function dispatchAlerts(alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) return;

  const payload = {
    source: 'datapath-watch ({66.15})',
    detectedAt: new Date().toISOString(),
    alertCount: alerts.length,
    alerts,
  };

  const webhook = process.env.MONITOR_ALERT_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The webhook failing must not swallow the alerts — fall through to logger.
      logger.error(
        { err: message, payload },
        '[datapath-watch] alert webhook POST failed; alerts below',
      );
      return;
    }
    return;
  }

  logger.error(
    payload,
    `[datapath-watch] ${alerts.length} datapath stall alert(s)`,
  );
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const config = loadConfig(process.env);
    const rows = await fetchRecentRuns(config);
    const alerts = detectStalls(rows, config, new Date());
    await dispatchAlerts(alerts);

    logger.info(
      { rowsScanned: rows.length, alertCount: alerts.length },
      '[datapath-watch] run complete',
    );

    return NextResponse.json({
      success: true,
      rowsScanned: rows.length,
      alertCount: alerts.length,
      alerts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, '[datapath-watch] Error');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
