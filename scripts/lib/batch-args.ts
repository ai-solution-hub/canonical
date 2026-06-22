/**
 * Shared CLI arg parser for the batch backfill/propagate/seed scripts.
 *
 * Background: every batch-mutation script under `scripts/` re-parsed the same
 * trio of flags via `node:util` `parseArgs`. This consolidates the canonical
 * shape: `--apply` (dry-run by default — the safe default for a mutation
 * script), `--limit=N` (0 / unset = all), and `--env=prod` (the opt-in guard,
 * see `script-env.ts`).
 *
 * Usage:
 *
 *   import { parseBatchArgs } from './lib/batch-args';
 *   const { apply, limit, env } = parseBatchArgs();
 *   const dryRun = !apply;
 */
import { parseArgs } from 'util';

/** Parsed batch-script flags. */
export interface BatchArgs {
  /** True when `--apply` was passed; otherwise the run is a dry run. */
  apply: boolean;
  /** Max rows to process, or `null` for all (`--limit=N`, 0 / unset = null). */
  limit: number | null;
  /** Target-env flag value (`''` by default; `'prod'` opts into the guard). */
  env: string;
}

/**
 * Parse the `--apply` / `--limit=N` / `--env=prod` trio from `argv`
 * (defaults to `process.argv.slice(2)`). A missing or non-positive `--limit`
 * resolves to `null` (process all rows).
 */
export function parseBatchArgs(
  argv: string[] = process.argv.slice(2),
): BatchArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: 'boolean', default: false },
      limit: { type: 'string', default: '' },
      env: { type: 'string', default: '' },
    },
    strict: true,
  });

  const parsedLimit = values.limit ? parseInt(values.limit, 10) : 0;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  return {
    apply: values.apply ?? false,
    limit,
    env: values.env ?? '',
  };
}
