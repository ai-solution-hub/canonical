/**
 * In-house graduation metric (T18/T19, B-INV-18/19).
 *
 * The per-workflow progressive-trust (WS-5) quality metric that earns auto-apply
 * is computed HERE, on KH's own infrastructure, from the on-platform signals:
 *
 *   - `ai_call_events` (T15) — the live `outcome_signal` per AI call
 *     (`win | fail | loop | refusal`); a touchpoint that consistently `win`s is
 *     earning trust.
 *   - `eval_runs` (T9) — the per-run `passed` flag from the central eval-runner;
 *     a touchpoint whose evals pass is holding its quality bar.
 *
 * **B-INV-18 — never via Raindrop cloud.** This module reads ONLY from Supabase
 * via `tryQuery()` and computes the metric arithmetically. It performs no network
 * request, references no Raindrop-cloud host, and carries no Workshop write key —
 * no client-derived trajectory ever egresses off-platform. The accompanying
 * `__tests__/lib/eval/graduation.test.ts` asserts zero egress as a GATING test
 * (not advisory), including a static source-scan for those egress tokens. This
 * directly satisfies ID-71 B-INV-15.
 *
 * **B-INV-19 — contract-addressable.** A touchpoint's {@link AgentEvalContract}
 * MAY declare an optional `graduation_metric` naming the in-house metric it
 * graduates on. {@link metricFor} reads that declaration from the registry and
 * returns the touchpoint's current value against it (or `null` when none is
 * declared — nothing to report). A declared-but-unrecognised metric is a loud
 * failure (the B-INV-19 "declared but unreadable" fail mode), never a silent 0.
 *
 * **Scope.** This module COMPUTES the metric only. *Auto-apply* on it (granting a
 * touchpoint earned trust) is the DEFERRED follow-up (T24 / {104.19}) and is
 * deliberately absent here — there is no apply/mutate path in this file.
 *
 * No barrel re-export: import directly from `@/lib/eval/graduation`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/types/database.types';
import { tryQuery } from '@/lib/supabase/safe';

/**
 * The closed set of in-house graduation metric names a contract may declare.
 * Each is computed on-platform from `ai_call_events` and/or `eval_runs`:
 *
 *   - `win_rate` — fraction of `ai_call_events` whose `outcome_signal` is `win`.
 *   - `eval_pass_rate` — fraction of `eval_runs` whose `passed` is true.
 *   - `progressive_trust` — the WS-5 blend: mean of the two above. The default
 *     "earn trust from both live behaviour AND eval quality" metric.
 */
export const GRADUATION_METRIC_NAMES = [
  'win_rate',
  'eval_pass_rate',
  'progressive_trust',
] as const;

/** A recognised in-house graduation metric name. */
export type GraduationMetricName = (typeof GRADUATION_METRIC_NAMES)[number];

/** Narrowing guard for a declared `graduation_metric` string. */
function isGraduationMetricName(value: string): value is GraduationMetricName {
  return (GRADUATION_METRIC_NAMES as readonly string[]).includes(value);
}

/**
 * A touchpoint's current graduation-metric value, computed in-house. The
 * `computed_in_house: true` literal is a deliberate, type-level marker that this
 * value never depended on an off-platform source (B-INV-18).
 */
export interface GraduationMetricValue {
  /** The touchpoint this value belongs to. */
  touchpoint_id: string;
  /** The declared metric this value answers (contract-addressable, T19). */
  metric: GraduationMetricName;
  /** The current value, bounded in [0,1]. */
  value: number;
  /** Total on-platform rows the value was computed from (calls + runs). */
  sample_size: number;
  /** Literal marker: this value was computed on-platform, never via Raindrop cloud. */
  computed_in_house: true;
}

// ---------------------------------------------------------------------------
// Pure computations — no I/O. Each takes the minimal on-platform row slice it
// reads and returns a value in [0,1]. An empty history yields 0 (no trust
// earned yet), never NaN.
// ---------------------------------------------------------------------------

/** Slice of an `ai_call_events` row this metric reads. */
type CallEventSlice = { outcome_signal: string };
/** Slice of an `eval_runs` row this metric reads. */
type EvalRunSlice = { passed: boolean };

/** Fraction of call events whose `outcome_signal` is `win`. 0 when empty. */
export function computeWinRate(events: readonly CallEventSlice[]): number {
  if (events.length === 0) return 0;
  const wins = events.filter((event) => event.outcome_signal === 'win').length;
  return wins / events.length;
}

/** Fraction of eval runs that passed. 0 when empty. */
export function computeEvalPassRate(runs: readonly EvalRunSlice[]): number {
  if (runs.length === 0) return 0;
  const passes = runs.filter((run) => run.passed).length;
  return passes / runs.length;
}

/**
 * The WS-5 progressive-trust blend: the mean of the live win-rate and the eval
 * pass-rate. Both inputs are in [0,1], so the blend is too. Weighting both
 * equally keeps a touchpoint from graduating on live wins alone (gaming) or on
 * eval passes alone (stale fixtures).
 */
export function computeProgressiveTrust(
  winRate: number,
  evalPassRate: number,
): number {
  return (winRate + evalPassRate) / 2;
}

// ---------------------------------------------------------------------------
// On-platform readers + the contract-addressable entry point.
// ---------------------------------------------------------------------------

/** Read the `outcome_signal` of every `ai_call_events` row for a touchpoint. */
async function readCallEvents(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
): Promise<CallEventSlice[]> {
  const result = await tryQuery(
    supabase
      .from('ai_call_events')
      .select('outcome_signal')
      .eq('touchpoint_id', touchpointId),
    'ai_call_events.byTouchpoint',
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}

/** Read the `passed` flag of every `eval_runs` row for a touchpoint. */
async function readEvalRuns(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
): Promise<EvalRunSlice[]> {
  const result = await tryQuery(
    supabase
      .from('eval_runs')
      .select('passed')
      .eq('touchpoint_id', touchpointId),
    'eval_runs.byTouchpoint',
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}

/** Read the touchpoint's declared `graduation_metric` (null when absent/unset). */
async function readDeclaredMetric(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
): Promise<string | null> {
  const result = await tryQuery(
    supabase
      .from('eval_touchpoints')
      .select('graduation_metric')
      .eq('touchpoint_id', touchpointId)
      .maybeSingle(),
    'eval_touchpoints.graduationMetric',
  );
  if (!result.ok) {
    throw result.error;
  }
  // Unregistered touchpoint, or registered with no declared metric.
  return result.data?.graduation_metric ?? null;
}

/**
 * Return a touchpoint's current graduation-metric value (T19), computed in-house
 * from `ai_call_events` + `eval_runs`.
 *
 * Resolution:
 *   - reads the touchpoint's declared `graduation_metric` from the registry;
 *   - `null` declaration (unregistered, or no metric declared) → returns `null`,
 *     i.e. nothing to report — the runner/surface simply omits a value;
 *   - a declared-but-unrecognised metric throws (the B-INV-19 "declared but
 *     unreadable" fail mode — never a silent 0);
 *   - otherwise computes the named metric from the on-platform rows.
 *
 * Performs NO network call (B-INV-18) — only Supabase reads via `tryQuery()`.
 */
export async function metricFor(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
): Promise<GraduationMetricValue | null> {
  const declared = await readDeclaredMetric(supabase, touchpointId);
  if (declared === null) {
    // No `graduation_metric` declared (or touchpoint absent) — nothing to report.
    return null;
  }
  if (!isGraduationMetricName(declared)) {
    throw new Error(
      `unknown graduation metric "${declared}" declared for touchpoint "${touchpointId}"`,
    );
  }

  const [events, runs] = await Promise.all([
    readCallEvents(supabase, touchpointId),
    readEvalRuns(supabase, touchpointId),
  ]);

  const winRate = computeWinRate(events);
  const evalPassRate = computeEvalPassRate(runs);

  let value: number;
  switch (declared) {
    case 'win_rate':
      value = winRate;
      break;
    case 'eval_pass_rate':
      value = evalPassRate;
      break;
    case 'progressive_trust':
      value = computeProgressiveTrust(winRate, evalPassRate);
      break;
  }

  return {
    touchpoint_id: touchpointId,
    metric: declared,
    value,
    sample_size: events.length + runs.length,
    computed_in_house: true,
  };
}
