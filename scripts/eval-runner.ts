/**
 * eval-runner — the single central eval dispatcher (T9/T10/T13, B-INV-9/10).
 *
 * Replaces the per-suite `scripts/eval-*.ts main()->saveBaseline` pattern with
 * ONE runner that, for every touchpoint:
 *
 *   1. resolves the touchpoint from `eval_touchpoints` (registry, {104.9} —
 *      `getTouchpoint`/`listTouchpoints`). An unregistered id is the T4
 *      registration-as-gate failure — surfaced as `'not registered: <id>'` and
 *      mapped to runner exit class 2.
 *   2. dispatches the touchpoint's `suite_name` to its registered suite fn (the
 *      seven legacy suites become thin callees under {104.14}; this runner takes
 *      the dispatch map by injection so the integration point stays testable and
 *      the legacy scripts are not modified here).
 *   3. applies the contract `variance_band` regression check ({104.8},
 *      `checkTouchpointRegression` — IMPORTED, not reimplemented) against the
 *      DB baseline ({104.11}, `loadBaseline`).
 *   4. folds the touchpoint's `severity_on_fail` into a gate disposition
 *      ({104.7}, `disposition`).
 *   5. writes a UNIFORM `eval_runs` row (M2) via `sb()` — every touchpoint
 *      records the same shape regardless of suite.
 *
 * EXIT DISPOSITION (B-INV-9/10 — genuinely new; legacy used a uniform exit(1)):
 *
 *   - {@link EXIT_PASS} (0) — all gating checks pass. `warn`/`info` regressions
 *     are recorded but do not fail the gate. (An `infra` provider failure is a
 *     could-not-complete and exits 2 for that touchpoint — but it is NEVER a
 *     quality regression, so it can never turn a 0 into a 1. T7.)
 *   - {@link EXIT_QUALITY_FAIL} (1) — ≥1 block-severity regression (a real
 *     quality-gate fail).
 *   - {@link EXIT_RUNNER_ERROR} (2) — runner/infra error / could-not-complete:
 *     an unregistered touchpoint (T4), a `suite_name` with no registered suite
 *     fn, a transient-provider (`infra`) suite failure, a DB-unreachable write,
 *     or any runner crash.
 *
 * The fold ({@link foldExitClass}) is one-sided-worst: 2 dominates 1 dominates
 * 0. A runner/infra error means the run could not complete, so its quality
 * verdict is unreliable and 2 must win over a 1.
 *
 * EXIT-CODE PURITY: the disposition (0/1/2) is computed as a RETURN VALUE
 * ({@link runEvals} → {@link RunnerReport.exitClass}); the single
 * `process.exit()` lives only in {@link main}, the direct-invocation wrapper.
 * Tests assert the exit class without killing the test process.
 *
 * No barrel re-export: import directly from `@/scripts/eval-runner`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, TablesInsert } from '@/supabase/types/database.types';
import type {
  AgentEvalContract,
  GroundingShape,
  SeverityTier,
  TouchpointKind,
} from '@/lib/eval/contract';
import { loadBaseline } from '@/lib/eval/baseline-store';
import { metricFor, type GraduationMetricValue } from '@/lib/eval/graduation';
import { checkTouchpointRegression } from '@/lib/eval/regression';
import {
  getTouchpoint,
  listTouchpoints,
  type Touchpoint,
} from '@/lib/eval/registry';
import { disposition } from '@/lib/eval/severity';
import { tryQuery } from '@/lib/supabase/safe';

// ---------------------------------------------------------------------------
// Exit classes — the deterministic 0/1/2 disposition (B-INV-9/10)
// ---------------------------------------------------------------------------

/** All gating checks pass. */
export const EXIT_PASS = 0;
/** ≥1 block-severity quality regression — the quality gate failed. */
export const EXIT_QUALITY_FAIL = 1;
/** Runner/infra error / could-not-complete (unregistered, infra, DB-unreachable, crash). */
export const EXIT_RUNNER_ERROR = 2;

/** The runner's deterministic process exit class. */
export type ExitClass =
  | typeof EXIT_PASS
  | typeof EXIT_QUALITY_FAIL
  | typeof EXIT_RUNNER_ERROR;

// ---------------------------------------------------------------------------
// Suite dispatch contract — the {104.14} integration seam
// ---------------------------------------------------------------------------

/**
 * The outcome a suite fn reports to the runner. Either a completed run carrying
 * its measured `metrics`, or a transient-provider (`infra`) could-not-complete
 * (Anthropic 529 / timeout / 503) that the runner records as infrastructure
 * noise — NEVER a quality regression (T7).
 */
export type SuiteRunOutcome =
  | { ok: true; metrics: Record<string, number> }
  | { ok: false; kind: 'infra'; reason: string };

/**
 * A registered suite runner: runs the suite for a touchpoint and reports its
 * outcome. The seven legacy suites are registered as thin callees under
 * {104.14}; this runner consumes the map by injection so the legacy scripts
 * stay untouched here and the integration point is unit-testable.
 */
export type SuiteFn = (touchpoint: Touchpoint) => Promise<SuiteRunOutcome>;

/** suite_name → suite fn. Missing entries are a runner error (exit 2). */
export type SuiteRegistry = Record<string, SuiteFn>;

// ---------------------------------------------------------------------------
// Per-touchpoint + aggregate result shapes
// ---------------------------------------------------------------------------

/** The runner's verdict for one dispatched touchpoint. */
export interface TouchpointRunResult {
  touchpointId: string;
  /** This touchpoint's exit-class contribution (folded with siblings). */
  exitClass: ExitClass;
  /**
   * Quality-gate pass for the touchpoint: `true` when no regression fired,
   * `false` on a regression. `null` when the run could not complete (infra /
   * suite-missing / unregistered) — there is no quality verdict to record.
   */
  passed: boolean | null;
  /** How `severity_on_fail` resolved at run time (block|warn|info|infra). */
  severityDisposition: SeverityTier;
  /** Human-readable reason for a non-pass / could-not-complete; `null` on pass. */
  reason: string | null;
  /**
   * The touchpoint's current graduation-metric value (T19/B-INV-19), computed
   * in-house by `metricFor()` from `ai_call_events` + `eval_runs`. `null` when
   * the touchpoint declares no `graduation_metric` — nothing to report (clean
   * omission, not an error). Unregistered / infra-failed touchpoints also carry
   * `null` here (there is no registry row to read the metric name from).
   */
  graduationMetricValue: GraduationMetricValue | null;
}

/** The aggregate dispatcher report. `exitClass` is the folded process exit. */
export interface RunnerReport {
  exitClass: ExitClass;
  results: TouchpointRunResult[];
}

/** Which touchpoints to dispatch. */
export type RunnerScope = { all: true } | { touchpointId: string };

/** The lane that produced the run — recorded on every `eval_runs` row. */
export type RunSource = 'nightly' | 'ci' | 'manual';

/** The dispatcher's options bag. */
export interface RunEvalsOptions {
  scope: RunnerScope;
  suites: SuiteRegistry;
  source: RunSource;
}

// ---------------------------------------------------------------------------
// foldExitClass — the pure 0/1/2 fold (separated from process.exit)
// ---------------------------------------------------------------------------

/**
 * Fold per-touchpoint exit classes into the runner's single process exit class,
 * taking the worst: `2` (runner/infra error) dominates `1` (quality fail)
 * dominates `0` (pass). An empty run is a pass.
 *
 * 2 outranks 1 deliberately: a runner/infra error means the run could not
 * complete, so any quality verdict alongside it is unreliable — surfacing 2
 * tells the caller "could not determine", not "quality regression".
 */
export function foldExitClass(
  results: readonly Pick<TouchpointRunResult, 'exitClass'>[],
): ExitClass {
  let worst: ExitClass = EXIT_PASS;
  for (const { exitClass } of results) {
    if (exitClass > worst) {
      worst = exitClass;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// runEvalTouchpoint — single-touchpoint dispatch + uniform eval_runs write
// ---------------------------------------------------------------------------

/**
 * Project a stored {@link Touchpoint} row onto the {@link AgentEvalContract}
 * shape `checkTouchpointRegression` consumes — it needs `touchpoint_id` and
 * `variance_band` (plus the other contract fields for completeness).
 */
function touchpointContract(touchpoint: Touchpoint): AgentEvalContract {
  // eval_touchpoints columns are CHECK-constrained TEXT, so database.types.ts
  // surfaces them as `string`; registerTouchpoint() validates them against the
  // contract unions on write (B-INV-3), so narrowing them here is sound.
  return {
    touchpoint_id: touchpoint.touchpoint_id,
    kind: touchpoint.kind as TouchpointKind,
    owner: touchpoint.owner,
    suite_name: touchpoint.suite_name,
    grounding_shape: touchpoint.grounding_shape as GroundingShape,
    severity_on_fail: touchpoint.severity_on_fail as SeverityTier,
    variance_band: touchpoint.variance_band,
    graduation_metric: touchpoint.graduation_metric ?? undefined,
  };
}

/**
 * Write the uniform `eval_runs` row (M2) for a completed touchpoint dispatch.
 * Returns `true` on success, `false` when the write itself fails (DB-unreachable
 * — a runner error). Uses `tryQuery()` so a write failure degrades to exit class
 * 2 rather than throwing past the per-touchpoint boundary.
 */
async function writeEvalRun(
  supabase: SupabaseClient<Database>,
  row: TablesInsert<'eval_runs'>,
): Promise<boolean> {
  const result = await tryQuery(
    supabase.from('eval_runs').insert(row).select('id').single(),
    'eval_runs.insert',
  );
  return result.ok;
}

/**
 * Dispatch ONE registered touchpoint: run its suite, apply the variance-band
 * regression against the DB baseline, fold `severity_on_fail` into a gate
 * disposition, and write the uniform `eval_runs` row. Returns this touchpoint's
 * {@link TouchpointRunResult} (its exit-class contribution) — it does NOT exit.
 *
 * Disposition mapping (per metric, worst-of across the suite's metrics):
 *   - suite reports `infra`            → severity `infra`, exit 2, NOT a quality fail.
 *   - regression with `severity_on_fail = block` → exit 1 (quality fail).
 *   - regression with `warn`/`info`    → recorded, gate passes (exit 0).
 *   - no regression                    → severity `info`, exit 0.
 *   - eval_runs write fails            → exit 2 (DB-unreachable runner error).
 */
export async function runEvalTouchpoint(
  supabase: SupabaseClient<Database>,
  touchpoint: Touchpoint,
  suiteFn: SuiteFn,
  source: RunSource,
): Promise<TouchpointRunResult> {
  const contract = touchpointContract(touchpoint);

  // 1. Run the suite. A transient-provider failure is `infra` — recorded, exit
  //    2, never a quality regression (T7).
  const outcome = await suiteFn(touchpoint);

  // 5. Fetch the graduation metric value in-house (T19/B-INV-19). Initiated
  //    AFTER the suite resolves (step 1) but WITHOUT await, so it overlaps the
  //    regression check + eval_runs write (steps 2–4) and is awaited at the
  //    end — not concurrent with the suite itself. Resolves null for
  //    touchpoints with no `graduation_metric` — clean omission, not an error.
  //    Errors from metricFor propagate as runner crashes (exit 2 via the outer
  //    catch in main); an unknown metric name throws loudly (the B-INV-19
  //    "declared but unreadable" fail mode).
  const graduationMetricValuePromise = metricFor(
    supabase,
    touchpoint.touchpoint_id,
  );

  if (!outcome.ok) {
    // Await the metric even on an infra failure — historical metric reflects
    // the touchpoint's running quality, independent of this run's suite result.
    const graduationMetricValue = await graduationMetricValuePromise.catch(
      () => null,
    );
    const writeOk = await writeEvalRun(supabase, {
      touchpoint_id: touchpoint.touchpoint_id,
      metrics: {},
      passed: false,
      severity_disposition: 'infra',
      exit_class: EXIT_RUNNER_ERROR,
      source,
    });
    return {
      touchpointId: touchpoint.touchpoint_id,
      // A failed audit write does not change the disposition — it was already 2.
      exitClass: EXIT_RUNNER_ERROR,
      passed: null,
      severityDisposition: 'infra',
      reason: writeOk
        ? outcome.reason
        : `${outcome.reason}; eval_runs write also failed`,
      graduationMetricValue,
    };
  }

  // 2. Regression check each metric against the active baseline (B-INV-8).
  const baseline = await loadBaseline(supabase, touchpoint.touchpoint_id);

  const failingMetrics: string[] = [];
  if (baseline) {
    for (const [metric, currentValue] of Object.entries(outcome.metrics)) {
      const baselineValue = baseline.metrics[metric];
      if (baselineValue === undefined) {
        // New metric with no baseline point — nothing to regress against.
        continue;
      }
      const verdict = checkTouchpointRegression({
        contract,
        baselineValue,
        currentValue,
        min: baseline.thresholds[metric]?.min,
      });
      if (!verdict.passed) {
        failingMetrics.push(metric);
      }
    }
  }

  // 3. Fold severity_on_fail across the regressions into a gate disposition
  //    ({104.7}). Each failing metric contributes one severity result at the
  //    touchpoint's configured tier.
  const runDisposition = disposition(
    failingMetrics.map(() => ({
      severity: touchpoint.severity_on_fail as SeverityTier,
    })),
  );

  const hasRegression = failingMetrics.length > 0;
  // Worst severity present, or `info` when nothing failed (recorded baseline run).
  const severityDisposition: SeverityTier = runDisposition.worst ?? 'info';
  // `passed` is the QUALITY-gate pass — only a block regression flips it false.
  // warn/info regressions are recorded but the gate still passes.
  const passed = !runDisposition.gateFailed;
  const exitClass: ExitClass = runDisposition.exitClass; // 0 or 1 (severity fold).

  // 4. Uniform eval_runs write. A write failure is a DB-unreachable runner
  //    error → exit class 2.
  const writeOk = await writeEvalRun(supabase, {
    touchpoint_id: touchpoint.touchpoint_id,
    metrics: outcome.metrics,
    passed,
    severity_disposition: severityDisposition,
    exit_class: exitClass,
    source,
  });

  // Await the graduation metric value (initiated concurrently above).
  const graduationMetricValue = await graduationMetricValuePromise;

  if (!writeOk) {
    return {
      touchpointId: touchpoint.touchpoint_id,
      exitClass: EXIT_RUNNER_ERROR,
      passed,
      severityDisposition,
      reason: 'eval_runs write failed (DB unreachable)',
      graduationMetricValue,
    };
  }

  return {
    touchpointId: touchpoint.touchpoint_id,
    exitClass,
    passed,
    severityDisposition,
    reason: hasRegression
      ? `regression on: ${failingMetrics.join(', ')}`
      : null,
    graduationMetricValue,
  };
}

// ---------------------------------------------------------------------------
// runEvals — the central dispatcher (no process.exit)
// ---------------------------------------------------------------------------

/**
 * Resolve a single touchpoint into a "not registered" runner-error result (T4).
 * The unregistered id is the registration-as-gate signal — exit class 2.
 * No graduation metric value: no registry row to read it from.
 */
function unregisteredResult(touchpointId: string): TouchpointRunResult {
  return {
    touchpointId,
    exitClass: EXIT_RUNNER_ERROR,
    passed: null,
    severityDisposition: 'infra',
    reason: `not registered: ${touchpointId}`,
    graduationMetricValue: null,
  };
}

/**
 * Resolve a touchpoint whose `suite_name` has no registered suite fn into a
 * runner-error result — exit class 2 (a misconfigured dispatch map).
 * Graduation metric value is null (suite dispatch failed before metric read).
 */
function missingSuiteResult(touchpoint: Touchpoint): TouchpointRunResult {
  return {
    touchpointId: touchpoint.touchpoint_id,
    exitClass: EXIT_RUNNER_ERROR,
    passed: null,
    severityDisposition: 'infra',
    reason: `no registered suite for suite_name: ${touchpoint.suite_name}`,
    graduationMetricValue: null,
  };
}

/**
 * Dispatch one resolved touchpoint through the suite registry, mapping a
 * missing suite fn to a runner-error result before running.
 */
async function dispatchTouchpoint(
  supabase: SupabaseClient<Database>,
  touchpoint: Touchpoint,
  suites: SuiteRegistry,
  source: RunSource,
): Promise<TouchpointRunResult> {
  const suiteFn = suites[touchpoint.suite_name];
  if (!suiteFn) {
    return missingSuiteResult(touchpoint);
  }
  return runEvalTouchpoint(supabase, touchpoint, suiteFn, source);
}

/**
 * The central dispatcher (T13). Resolves the scope (`--touchpoint <id>` →
 * single via `getTouchpoint`; `--all` → every registered touchpoint via
 * `listTouchpoints`), dispatches each, and folds a single process
 * {@link ExitClass}. Returns a {@link RunnerReport} — it NEVER calls
 * `process.exit` (exit-code purity; the `process.exit` lives in {@link main}).
 */
export async function runEvals(
  supabase: SupabaseClient<Database>,
  options: RunEvalsOptions,
): Promise<RunnerReport> {
  const { scope, suites, source } = options;
  const results: TouchpointRunResult[] = [];

  if ('touchpointId' in scope) {
    const touchpoint = await getTouchpoint(supabase, scope.touchpointId);
    if (!touchpoint) {
      results.push(unregisteredResult(scope.touchpointId));
    } else {
      results.push(
        await dispatchTouchpoint(supabase, touchpoint, suites, source),
      );
    }
  } else {
    const touchpoints = await listTouchpoints(supabase);
    for (const touchpoint of touchpoints) {
      results.push(
        await dispatchTouchpoint(supabase, touchpoint, suites, source),
      );
    }
  }

  return { exitClass: foldExitClass(results), results };
}

// ---------------------------------------------------------------------------
// CLI surface — flag parsing + direct-invocation wrapper (the ONLY exit point)
// ---------------------------------------------------------------------------

/** Parsed runner CLI args: scope selection + run source. */
export interface ParsedRunnerArgs {
  scope: RunnerScope;
  source: RunSource;
}

/**
 * Parse runner CLI args. `--touchpoint <id>` selects a single touchpoint;
 * `--all` (the default when neither is given) selects every registered
 * touchpoint. `--source <nightly|ci|manual>` records the lane (default
 * `manual`).
 */
export function parseRunnerArgs(args: string[]): ParsedRunnerArgs {
  const touchpointIndex = args.indexOf('--touchpoint');
  const scope: RunnerScope =
    touchpointIndex !== -1 && args[touchpointIndex + 1]
      ? { touchpointId: args[touchpointIndex + 1] }
      : { all: true };

  const sourceIndex = args.indexOf('--source');
  const sourceArg = sourceIndex !== -1 ? args[sourceIndex + 1] : undefined;
  const source: RunSource =
    sourceArg === 'nightly' || sourceArg === 'ci' || sourceArg === 'manual'
      ? sourceArg
      : 'manual';

  return { scope, source };
}

/**
 * Direct-invocation CLI entry point. The ONLY place `process.exit` lives
 * (exit-code purity — `runEvals` computes the exit class as a return value so
 * tests can assert it without killing the test process).
 *
 * Flow: parse CLI args → build the suite registry (imported from
 * `eval-register-suites`) → run → exit with the runner's exit class (0/1/2).
 */
export async function main(): Promise<void> {
  // Lazy import avoids circular deps when eval-register-suites imports
  // eval-runner types, and keeps the module graph deterministic at test time.
  const { createClient } = await import('@supabase/supabase-js');
  const { buildSuiteRegistry } = await import('@/scripts/eval-register-suites');

  const url =
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error(
      'eval-runner: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(EXIT_RUNNER_ERROR);
  }

  // `createClient` here is a script-level client (service-role key) — not the
  // browser client used in Next.js routes; scripts always use the service role.
  // `as unknown` cast needed: the generated Database type lives in
  // supabase/types/database.types.ts which the sandbox denies at build time;
  // the runner's DB access goes through sb()/tryQuery() which carry the type
  // internally, so the cast is safe at the production call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient<any>(url, key, {
    auth: { persistSession: false },
  });

  const { scope, source } = parseRunnerArgs(process.argv.slice(2));
  const suites = buildSuiteRegistry();

  const report = await runEvals(supabase, { scope, suites, source });
  process.exit(report.exitClass);
}

// Bun: invoke when this file is the entry point (not when imported as a module).
if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(
      'eval-runner: fatal error:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(EXIT_RUNNER_ERROR);
  });
}
