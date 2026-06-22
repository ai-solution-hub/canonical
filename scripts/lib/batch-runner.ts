/**
 * Generic read → transform → write-changed-rows batch loop.
 *
 * Background: every backfill/propagate/seed script under `scripts/` carried a
 * copy of the same loop — fetch a page of rows, compute a transformed value for
 * each, write back only the rows that actually changed, and skip all writes
 * under dry-run. This generalises that loop so the per-script code is reduced to
 * three callbacks (`select`, `transform`, `write`).
 *
 * Contract:
 *   - `select(limit)` fetches the rows to process (the caller owns the query and
 *     applies `limit` if non-null).
 *   - `transform(row)` returns `{ changed, value }` — `value` is written only
 *     when `changed` is true. Returning `changed: false` skips the row entirely.
 *   - `write(row, value)` persists one changed row; only called when `!dryRun`.
 *     It should return an error (truthy) on failure, or a falsy value on success
 *     (mirrors the `{ error }` shape supabase-js returns).
 *
 * Under `dryRun`, `write` is never called — the loop still computes diffs and
 * reports how many rows *would* change. This matches the dry-run-by-default
 * posture of the batch scripts (see `batch-args.ts`).
 *
 * Usage:
 *
 *   const summary = await runBatch({
 *     select: (limit) => fetchRows(limit),
 *     transform: (row) => ({ changed: needsFix(row), value: fix(row) }),
 *     write: (row, value) => supabase.from('t').update(value).eq('id', row.id),
 *     dryRun,
 *     limit,
 *   });
 */

/** Outcome of transforming a single row. */
export interface TransformResult<V> {
  /** Whether the row's value changed and should be written. */
  changed: boolean;
  /** The transformed value to write (only used when `changed` is true). */
  value: V;
}

/** Per-row write outcome — supabase-js-shaped `{ error }` or a falsy success. */
export type WriteOutcome = { error: { message: string } | null } | null | void;

/** Inputs to {@link runBatch}. */
export interface RunBatchOptions<Row, Value> {
  /** Fetch the rows to process; `limit` is `null` for all rows. */
  select: (limit: number | null) => Promise<Row[]>;
  /** Compute the transformed value + changed flag for one row. */
  transform: (
    row: Row,
  ) => TransformResult<Value> | Promise<TransformResult<Value>>;
  /** Persist one changed row. Only called when `!dryRun`. */
  write: (row: Row, value: Value) => Promise<WriteOutcome> | WriteOutcome;
  /** When true, compute diffs but never call `write`. */
  dryRun: boolean;
  /** Max rows to process, or `null` for all. Passed through to `select`. */
  limit?: number | null;
}

/** Aggregate counts returned by {@link runBatch}. */
export interface BatchSummary<Row, Value> {
  /** Total rows returned by `select`. */
  scanned: number;
  /** Rows whose `transform` reported `changed: true`. */
  changed: number;
  /** Rows actually written (0 under dry-run). */
  written: number;
  /** Rows skipped because `transform` reported `changed: false`. */
  skipped: number;
  /** Rows whose `write` reported an error. */
  errors: number;
  /** Per-changed-row diff records (for logging / reporting). */
  changes: Array<{ row: Row; value: Value }>;
}

/**
 * Run the read → transform → write-changed-rows loop. Writes only changed rows,
 * and only when `!dryRun`. Returns aggregate counts plus the per-row diff list.
 */
export async function runBatch<Row, Value>(
  options: RunBatchOptions<Row, Value>,
): Promise<BatchSummary<Row, Value>> {
  const { select, transform, write, dryRun, limit = null } = options;

  const rows = await select(limit);

  const summary: BatchSummary<Row, Value> = {
    scanned: rows.length,
    changed: 0,
    written: 0,
    skipped: 0,
    errors: 0,
    changes: [],
  };

  for (const row of rows) {
    const { changed, value } = await transform(row);

    if (!changed) {
      summary.skipped++;
      continue;
    }

    summary.changed++;
    summary.changes.push({ row, value });

    if (dryRun) continue;

    const outcome = await write(row, value);
    if (
      outcome &&
      typeof outcome === 'object' &&
      'error' in outcome &&
      outcome.error
    ) {
      summary.errors++;
      continue;
    }

    summary.written++;
  }

  return summary;
}
