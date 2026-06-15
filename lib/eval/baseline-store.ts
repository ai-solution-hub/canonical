/**
 * DB-backed baseline store (T11/T12, B-INV-11/12).
 *
 * STORAGE REBUILD of the legacy flat-JSON baseline store
 * (`lib/eval/baseline.ts:loadBaseline`/`saveBaseline`, reading/writing
 * `__tests__/fixtures/eval-baselines/*.json`). The lifecycle SHAPE is ported
 * from the historic phase-4 baseline hooks — `loadBaseline` / `promoteBaseline`
 * / `baselineHistory` / `compareBaselines` — but the storage is rebuilt onto the
 * `eval_baselines` + `eval_baseline_audit` tables (M3, migration
 * 20260615170612_id104_eval_engine.sql; TECH §Migration plan):
 *
 *   - `eval_baselines`       — the promoted baseline rows (metrics + thresholds);
 *                              the newest `promoted_at` row is the active baseline.
 *   - `eval_baseline_audit`  — append-only who/when/which-`registry_version` log;
 *                              `promoteBaseline` writes one row per promotion.
 *
 * The regression VERDICT math is NOT duplicated here — it lives in
 * `lib/eval/regression.ts` ({104.8}, the touchpoint-keyed `checkRegression`
 * port) and runs AGAINST this store's baselines. `compareBaselines` is a
 * distinct, verdict-free metric-delta computation (a diff, not a pass/fail).
 *
 * CUTOVER: the flat-JSON path in `lib/eval/baseline.ts` is RETAINED until every
 * legacy suite is re-pointed at this store ({104.13}/{104.14}) and nightly is
 * green. `bootstrapBaselinesFromFixtures` is the one-shot that seeds the four
 * existing fixtures into rows so the DB store starts populated.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, Json } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';

// ---------------------------------------------------------------------------
// Typed projection of the jsonb columns
// ---------------------------------------------------------------------------

/**
 * Per-metric threshold the regression check compares against. Mirrors the legacy
 * `EvalBaseline.thresholds` value shape (`lib/eval/types.ts`) — the one-sided
 * `min` (absolute floor) + `max_drop` (max tolerated drop) pair the ported
 * `checkRegression` math consumes.
 */
export interface BaselineThreshold {
  min?: number;
  max_drop?: number;
}

/**
 * A baseline row, narrowed from the generated `eval_baselines` row so the jsonb
 * `metrics` / `thresholds` columns are typed as their stored shapes rather than
 * the opaque `Json`. The metric values are numeric measurements; the thresholds
 * are the per-metric regression tolerances.
 */
export interface StoredBaseline extends Omit<
  Tables<'eval_baselines'>,
  'metrics' | 'thresholds'
> {
  metrics: Record<string, number>;
  thresholds: Record<string, BaselineThreshold>;
}

/**
 * The promotion payload for {@link promoteBaseline}. Carries the metrics +
 * thresholds to freeze as the new baseline and the `registry_version` the
 * promotion is bound to (advances with the contract — B-INV-1/5).
 */
export interface BaselinePromotion {
  metrics: Record<string, number>;
  thresholds: Record<string, BaselineThreshold>;
  registryVersion: number;
}

/** A single per-metric delta produced by {@link compareBaselines}. */
export interface BaselineMetricDelta {
  metric_name: string;
  /** The metric value on the first (reference) baseline. */
  baseline_value: number;
  /** The metric value on the second (compared) baseline. */
  current_value: number;
  /** Signed change `current_value - baseline_value` (negative = a drop). */
  delta: number;
}

/** Outcome summary returned by {@link bootstrapBaselinesFromFixtures}. */
export interface BootstrapSummary {
  /** How many fixture suites were seeded into `eval_baselines` rows. */
  seeded: number;
  /** The touchpoint ids seeded (one per fixture file). */
  touchpoints: string[];
}

// ---------------------------------------------------------------------------
// Row → typed projection
// ---------------------------------------------------------------------------

/** Narrow a generated `eval_baselines` row to the typed {@link StoredBaseline}. */
function toStoredBaseline(row: Tables<'eval_baselines'>): StoredBaseline {
  return {
    ...row,
    metrics: (row.metrics ?? {}) as Record<string, number>,
    thresholds: (row.thresholds ?? {}) as Record<string, BaselineThreshold>,
  };
}

// ---------------------------------------------------------------------------
// loadBaseline — resolve the active baseline
// ---------------------------------------------------------------------------

/**
 * Resolve the active baseline for a touchpoint — the newest promoted
 * `eval_baselines` row. Returns `null` when no baseline has been promoted yet
 * (first run — nothing to regress against), mirroring the legacy file-JSON
 * `loadBaseline` "no file" contract.
 */
export async function loadBaseline(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
): Promise<StoredBaseline | null> {
  const row = await sb(
    supabase
      .from('eval_baselines')
      .select('*')
      .eq('touchpoint_id', touchpointId)
      .order('promoted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'eval_baselines.loadActive',
  );

  return row ? toStoredBaseline(row) : null;
}

// ---------------------------------------------------------------------------
// promoteBaseline — freeze a new baseline + write the audit row
// ---------------------------------------------------------------------------

/**
 * Promote a new baseline for a touchpoint: insert an `eval_baselines` row with
 * the promotion's metrics + thresholds, then append an `eval_baseline_audit`
 * row capturing who (`actor`), when (DB-default `at`), and which
 * `registry_version` the promotion was bound to (B-INV-12). Returns the newly
 * promoted baseline.
 *
 * The baseline insert is the load-bearing write; the audit row follows so a
 * failed audit insert never silently leaves a baseline unrecorded — both writes
 * fail-fast via `sb()`.
 */
export async function promoteBaseline(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
  promotion: BaselinePromotion,
  actor: string,
): Promise<StoredBaseline> {
  const inserted = await sb(
    supabase
      .from('eval_baselines')
      .insert({
        touchpoint_id: touchpointId,
        metrics: promotion.metrics as unknown as Json,
        // Cast at the jsonb boundary: `BaselineThreshold`'s optional fields
        // widen to `number | undefined`, which the generated `Json` type
        // rejects even though the stored value is valid JSON (codebase
        // convention — see lib/pipeline/update-progress.ts).
        thresholds: promotion.thresholds as unknown as Json,
        registry_version: promotion.registryVersion,
        promoted_by: actor,
      })
      .select('*')
      .single(),
    'eval_baselines.promote',
  );

  await sb(
    supabase.from('eval_baseline_audit').insert({
      touchpoint_id: touchpointId,
      action: 'promote',
      actor,
      registry_version: promotion.registryVersion,
    }),
    'eval_baseline_audit.promote',
  );

  return toStoredBaseline(inserted);
}

// ---------------------------------------------------------------------------
// baselineHistory — prior baselines, newest first
// ---------------------------------------------------------------------------

/**
 * Return every promoted baseline for a touchpoint, newest first (`promoted_at`
 * DESC). The first element is the active baseline; the remainder are the prior
 * baselines that {@link compareBaselines} diffs against. Returns an empty array
 * when the touchpoint has never been promoted.
 */
export async function baselineHistory(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
): Promise<StoredBaseline[]> {
  const rows = await sb(
    supabase
      .from('eval_baselines')
      .select('*')
      .eq('touchpoint_id', touchpointId)
      .order('promoted_at', { ascending: false }),
    'eval_baselines.history',
  );

  return rows.map(toStoredBaseline);
}

// ---------------------------------------------------------------------------
// compareBaselines — per-metric deltas (verdict-free)
// ---------------------------------------------------------------------------

/**
 * Compute the per-metric deltas between two baselines: for every metric present
 * on EITHER side, `delta = b.metric - a.metric` (a metric absent on one side is
 * treated as 0 there, mirroring the legacy regression math's `?? 0`). This is a
 * pure diff — it carries NO pass/fail verdict; the regression VERDICT belongs to
 * `lib/eval/regression.ts:checkTouchpointRegression` and is intentionally not
 * duplicated here.
 */
export function compareBaselines(
  a: StoredBaseline,
  b: StoredBaseline,
): BaselineMetricDelta[] {
  const metricNames = new Set<string>([
    ...Object.keys(a.metrics),
    ...Object.keys(b.metrics),
  ]);

  return [...metricNames].map((metric_name) => {
    const baseline_value = a.metrics[metric_name] ?? 0;
    const current_value = b.metrics[metric_name] ?? 0;
    return {
      metric_name,
      baseline_value,
      current_value,
      delta: current_value - baseline_value,
    };
  });
}

// ---------------------------------------------------------------------------
// bootstrap — seed the flat-JSON fixtures into rows (one-shot cutover)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** The flat-JSON baseline fixtures retained during the cutover window. */
const FIXTURE_DIR = join(__dirname, '../../__tests__/fixtures/eval-baselines');

/**
 * The four legacy suite fixtures that seed the DB store. Each `suite` is the
 * fixture file stem AND the `touchpoint_id` the seeded row is keyed by — the
 * suites the legacy flat-JSON store carried (VERIFIED: classification,
 * entity-classification, search, summarisation).
 */
const FIXTURE_SUITES = [
  'classification',
  'entity-classification',
  'search',
  'summarisation',
] as const;

/** Shape of a flat-JSON baseline fixture (legacy `EvalBaseline` on disk). */
interface FixtureBaseline {
  suite_name: string;
  created_at: string;
  metrics: Record<string, number>;
  thresholds: Record<string, BaselineThreshold>;
}

/** Read one flat-JSON baseline fixture from disk. */
function readFixture(suite: string): FixtureBaseline {
  const filePath = join(FIXTURE_DIR, `${suite}.baseline.json`);
  return JSON.parse(readFileSync(filePath, 'utf-8')) as FixtureBaseline;
}

/**
 * One-shot cutover bootstrap: seed the four existing flat-JSON baseline
 * fixtures into `eval_baselines` rows so the DB store starts populated. Each
 * seeded row is keyed by the fixture suite name as its `touchpoint_id`, carries
 * the fixture's metrics + thresholds verbatim, and is attributed to `actor`
 * (e.g. a bootstrap operator id) at `registry_version` 1.
 *
 * Intended to run ONCE against an empty store; re-running re-inserts (the table
 * is append-only history, so duplicates surface as additional baseline rows the
 * cutover discards once nightly is green). NOT wired into the request path.
 */
export async function bootstrapBaselinesFromFixtures(
  supabase: SupabaseClient<Database>,
  actor: string,
): Promise<BootstrapSummary> {
  const touchpoints: string[] = [];

  for (const suite of FIXTURE_SUITES) {
    const fixture = readFixture(suite);
    await promoteBaseline(
      supabase,
      suite,
      {
        metrics: fixture.metrics,
        thresholds: fixture.thresholds,
        registryVersion: 1,
      },
      actor,
    );
    touchpoints.push(suite);
  }

  return { seeded: touchpoints.length, touchpoints };
}
