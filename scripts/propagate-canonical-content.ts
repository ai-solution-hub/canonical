/**
 * PI-18 canonical-content propagation worker (ID-95 {95.13}).
 *
 * A one-way, platform -> client fan-out worker. It READS the platform-curated
 * canonical baseline from a SOURCE Supabase DB and WRITES it into one or more
 * TARGET client DBs by upsert-on-stable-key + tombstone delete, recording the
 * applied state per table in `content_propagation_version`.
 *
 * HARD INVARIANTS (these ARE the spec — see PAYLOAD_CONTRACT and PLAN.md
 * §"D-2 PI-18 worker mechanism"):
 *
 *  1. ONE-WAY ONLY. The worker reads from SOURCE and writes to TARGETS. It
 *     NEVER writes to the source, and NEVER reads client-provenance tables back
 *     from a target into the source. No `postgres_fdw`, no logical replication —
 *     plain service-role upserts over per-target connections (PI-18/PI-19).
 *  2. CATALOG = config-as-data, out-of-band and gitignored
 *     (`scripts/.propagation-catalog.json`). It holds service-role DSNs and MUST
 *     NEVER be committed.
 *  3. CONNECTION construction follows the existing script idiom
 *     (`createClient<Database>(url, key, { auth: { persistSession: false,
 *     autoRefreshToken: false } })`). It deliberately does NOT import
 *     `lib/env-server.ts` / `lib/supabase/server.ts` (their Zod boot-parse binds
 *     every connection to the app's own service-role key / single DB).
 *  4. PER-TABLE sync iterates `PAYLOAD_CONTRACT` IN ORDER: fetch source rows ->
 *     resolve fkRemap on the target -> upsert on the real conflict target ->
 *     tombstone delete-absent -> record version.
 *  5. reference_items is SKIP-LOUD in v1 (its source_document_id FK points at a
 *     client-provenance table the payload excludes — open seam, ID-95.13 OQ).
 *  6. SAFETY: `--dry-run` writes nothing; fail LOUD on source-fetch errors (no
 *     silent catch, no partial-sync fallback); non-zero exit on any per-target
 *     failure (continue to next target, but overall exit reflects any failure).
 *
 * Spec: PLAN.md §"D-2 PI-18 worker mechanism" (id-95-per-client-topology);
 * contract: scripts/propagation/payload-contract.ts.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Database } from '@/supabase/types/database.types';
import {
  PAYLOAD_CONTRACT,
  type PayloadTableContract,
} from './propagation/payload-contract';

// ---------------------------------------------------------------------------
// content_propagation_version — staging-only local type (see invariant 7).
//
// This ledger table is on STAGING only this session ({95.11} migration has not
// yet reached prod), so the prod-generated `Database` type does not contain it.
// We define a narrow local row type and cast the client call for that ONE table
// rather than regenerating database.types.ts. (staging-only until {95.11}
// migration reaches prod.)
// ---------------------------------------------------------------------------
export interface ContentPropagationVersionRow {
  payload_key: string;
  version: number;
  payload_checksum: string;
  applied_at: string;
}

const VERSION_TABLE = 'content_propagation_version';

/** Tables we read from the source. We NEVER read these from a target. */
type PayloadRow = Record<string, unknown>;

/**
 * Minimal structural subset of the Supabase client the worker uses. Keeping the
 * surface narrow lets the unit tests inject a small chainable mock for BOTH
 * source and target without a full `SupabaseClient` cast, and makes the one-way
 * invariant assertable (the source mock's write methods are never called).
 */
export interface PropagationClient {
  from: (table: string) => PropagationQueryBuilder;
}

export interface PropagationQueryBuilder {
  select: (columns?: string) => PropagationQueryBuilder;
  upsert: (
    values: PayloadRow | PayloadRow[],
    options?: { onConflict?: string },
  ) => PropagationQueryBuilder;
  delete: () => PropagationQueryBuilder;
  in: (column: string, values: readonly unknown[]) => PropagationQueryBuilder;
  not: (
    column: string,
    operator: string,
    value: unknown,
  ) => PropagationQueryBuilder;
  then: <TResult>(
    onfulfilled: (value: {
      data: unknown;
      error: unknown;
      count?: number | null;
    }) => TResult,
  ) => Promise<TResult>;
}

export interface CatalogTarget {
  readonly ref: string;
  readonly url: string;
  readonly serviceRoleKey: string;
}

export interface PropagateOptions {
  /** When true, compute and log the plan but write nothing. */
  readonly dryRun: boolean;
  /** Structured logger sink (defaults to console). Injected in tests. */
  readonly log?: (event: PropagationLogEvent) => void;
}

export interface PropagationLogEvent {
  readonly level: 'info' | 'warn' | 'error';
  readonly msg: string;
  readonly ref?: string;
  readonly table?: string;
  readonly [key: string]: unknown;
}

/** Result of syncing one table to one target. */
export interface TablePropagationResult {
  readonly table: string;
  readonly skipped: boolean;
  readonly upserted: number;
  readonly deleted: number;
  readonly checksum: string | null;
}

/** Result of syncing one whole target. */
export interface TargetPropagationResult {
  readonly ref: string;
  readonly ok: boolean;
  readonly tables: TablePropagationResult[];
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Stable sha256 checksum over the canonical-JSON of the payload. Rows are
 * sorted by their stableKey tuple and each row's keys are emitted in sorted
 * order, so the checksum is invariant to row/column ordering from the source.
 */
export function canonicalChecksum(
  rows: readonly PayloadRow[],
  stableKey: readonly string[],
): string {
  const sorted = [...rows].sort((a, b) => {
    for (const k of stableKey) {
      const av = String(a[k] ?? '');
      const bv = String(b[k] ?? '');
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
  const canonical = JSON.stringify(sorted.map((r) => sortedEntries(r)));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortedEntries(row: PayloadRow): Array<[string, unknown]> {
  return Object.keys(row)
    .sort()
    .map((k) => [k, row[k]] as [string, unknown]);
}

/** Build the identity string for a row from its stableKey columns. */
function stableKeyIdentity(
  row: PayloadRow,
  stableKey: readonly string[],
): string {
  return stableKey.map((k) => String(row[k] ?? '')).join(' ');
}

/**
 * Resolve the real ON CONFLICT column set for a table: the fkRemap-resolved FK
 * column(s) UNION the stableKey. For taxonomy_subtopics that is
 * `(domain_id, name)` (= DB constraint taxonomy_subtopics_domain_id_name_key);
 * for the others it is the stableKey itself.
 */
export function conflictColumns(contract: PayloadTableContract): string[] {
  if (contract.fkRemap) {
    return [contract.fkRemap.column, ...contract.stableKey];
  }
  return [...contract.stableKey];
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return JSON.stringify(error);
}

// ---------------------------------------------------------------------------
// Source fetch (fail-loud)
// ---------------------------------------------------------------------------

/**
 * Fetch every row of a source table. Throws (fail-loud) on a source error so
 * the tombstone step never mass-deletes a target off a failed read.
 */
async function fetchSourceRows(
  source: PropagationClient,
  table: string,
): Promise<PayloadRow[]> {
  const { data, error } = await source.from(table).select('*');
  if (error) {
    throw new Error(
      `Source fetch failed for "${table}": ${describeError(error)}`,
    );
  }
  return (data as PayloadRow[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// fkRemap resolution (bidirectional, bridged through the referenced natural key)
//
// The per-DB uuid FK (e.g. taxonomy_subtopics.domain_id) differs between source
// and target. We bridge it through the referenced row's NATURAL key:
//   source FK uuid --(source referencesTable)--> natural key
//   natural key    --(target referencesTable)--> target FK uuid
// We never assume the source row carries the referenced natural key inline.
// ---------------------------------------------------------------------------

/** referenced-row uuid `id` -> its natural key (source side). */
async function buildUuidToNaturalKey(
  client: PropagationClient,
  referencesTable: string,
  referencesStableKey: readonly string[],
): Promise<Map<string, string>> {
  const rows = await fetchReferenceRows(client, referencesTable);
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = referencesStableKey.map((k) => String(row[k] ?? '')).join(' ');
    map.set(String(row.id), key);
  }
  return map;
}

/** referenced-row natural key -> its uuid `id` (target side). */
async function buildNaturalKeyToUuid(
  client: PropagationClient,
  referencesTable: string,
  referencesStableKey: readonly string[],
): Promise<Map<string, string>> {
  const rows = await fetchReferenceRows(client, referencesTable);
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = referencesStableKey.map((k) => String(row[k] ?? '')).join(' ');
    map.set(key, String(row.id));
  }
  return map;
}

async function fetchReferenceRows(
  client: PropagationClient,
  referencesTable: string,
): Promise<PayloadRow[]> {
  const { data, error } = await client.from(referencesTable).select('*');
  if (error) {
    throw new Error(
      `FK-resolver fetch failed for "${referencesTable}": ${describeError(error)}`,
    );
  }
  return (data as PayloadRow[] | null) ?? [];
}

function stripColumn(row: PayloadRow, column: string): PayloadRow {
  const { [column]: _omit, ...rest } = row;
  void _omit;
  return rest;
}

// ---------------------------------------------------------------------------
// Per-table sync
// ---------------------------------------------------------------------------

/**
 * Propagate one contract table from source to a single target. Pure of any CLI
 * concern; takes injected clients so it is unit-testable mock-only.
 */
export async function propagateTableToTarget(
  source: PropagationClient,
  target: PropagationClient,
  contract: PayloadTableContract,
  opts: PropagateOptions,
): Promise<TablePropagationResult> {
  const log = opts.log ?? consoleLog;
  const { table, stableKey, fkRemap } = contract;

  // --- Invariant 5: reference_items SKIP-LOUD guard ----------------------
  // reference_items.source_document_id is a NOT-NULL uuid FK into
  // source_documents — a CLIENT-PROVENANCE table the payload EXCLUDES — so it
  // cannot be cleanly propagated yet (open seam OQ A/B/C). Flip this single
  // guard once the seam is decided.
  if (table === 'reference_items') {
    log({
      level: 'warn',
      table,
      msg: 'reference_items propagation deferred pending source_document seam (ID-95.13 OQ)',
    });
    return { table, skipped: true, upserted: 0, deleted: 0, checksum: null };
  }

  // (a) Fetch source rows — fail-loud on error.
  const sourceRows = await fetchSourceRows(source, table);
  const checksum = canonicalChecksum(sourceRows, stableKey);

  // (b) fkRemap resolution — resolve the target-side FK BEFORE upsert.
  let rowsToUpsert: PayloadRow[] = sourceRows;
  if (fkRemap) {
    const sourceUuidToKey = await buildUuidToNaturalKey(
      source,
      fkRemap.referencesTable,
      fkRemap.referencesStableKey,
    );
    const targetKeyToUuid = await buildNaturalKeyToUuid(
      target,
      fkRemap.referencesTable,
      fkRemap.referencesStableKey,
    );
    rowsToUpsert = sourceRows.map((row) => {
      const sourceFkUuid = String(row[fkRemap.column] ?? '');
      const naturalKey = sourceUuidToKey.get(sourceFkUuid);
      const targetId =
        naturalKey !== undefined ? targetKeyToUuid.get(naturalKey) : undefined;
      if (targetId === undefined) {
        // Fail LOUD — never insert a dangling/null FK.
        throw new Error(
          `fkRemap failed for "${table}": no target "${fkRemap.referencesTable}" ` +
            `row with ${fkRemap.referencesStableKey.join(',')}="${naturalKey ?? '<unresolved-source-uuid>'}" ` +
            `(source ${fkRemap.column}="${sourceFkUuid}", source stableKey="${stableKeyIdentity(row, stableKey)}")`,
        );
      }
      return {
        ...stripColumn(row, fkRemap.column),
        [fkRemap.column]: targetId,
      };
    });
  }

  const onConflict = conflictColumns(contract).join(',');

  if (opts.dryRun) {
    const activeKeys = sourceRows.map((r) => stableKeyIdentity(r, stableKey));
    log({
      level: 'info',
      table,
      msg:
        `[dry-run] would upsert ${rowsToUpsert.length} row(s) ON CONFLICT (${onConflict}); ` +
        `tombstone-delete target rows absent from ${activeKeys.length} active source key(s)`,
      checksum,
    });
    return { table, skipped: false, upserted: 0, deleted: 0, checksum };
  }

  // (c) Upsert by the real conflict target.
  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await target
      .from(table)
      .upsert(rowsToUpsert, { onConflict });
    if (upsertError) {
      throw new Error(
        `Target upsert failed for "${table}": ${describeError(upsertError)}`,
      );
    }
  }

  // (d) Tombstone delete-absent.
  const deleted = await tombstoneDeleteAbsent(target, contract, sourceRows);

  // (e) Record the version.
  await recordVersion(target, table, checksum);

  log({
    level: 'info',
    table,
    msg: `synced: upserted ${rowsToUpsert.length}, tombstoned ${deleted}`,
    checksum,
  });

  return {
    table,
    skipped: false,
    upserted: rowsToUpsert.length,
    deleted,
    checksum,
  };
}

/**
 * Delete TARGET rows whose stableKey identity is absent from the SOURCE active
 * set. Mass-delete guard: a genuinely-empty source active set never wipes a
 * target (and a failed source fetch already threw upstream, so we never reach
 * here on a read error).
 */
async function tombstoneDeleteAbsent(
  target: PropagationClient,
  contract: PayloadTableContract,
  sourceRows: readonly PayloadRow[],
): Promise<number> {
  const { table, stableKey } = contract;

  if (sourceRows.length === 0) {
    return 0;
  }

  // Single-column stableKey: delete WHERE col NOT IN (active values).
  if (stableKey.length === 1) {
    const col = stableKey[0];
    const activeValues = sourceRows.map((r) => r[col]);
    const { data, error } = await target
      .from(table)
      .delete()
      .not(col, 'in', `(${activeValues.map(formatInValue).join(',')})`);
    if (error) {
      throw new Error(
        `Tombstone delete failed for "${table}": ${describeError(error)}`,
      );
    }
    return Array.isArray(data) ? data.length : 0;
  }

  // Composite stableKey (v1: only form_template_requirements). A NOT-IN over a
  // synthesised identity is not expressible in PostgREST, so fetch target rows
  // and delete those whose composite identity is absent from the source set.
  const { data: targetData, error: targetErr } = await target
    .from(table)
    .select('*');
  if (targetErr) {
    throw new Error(
      `Tombstone target fetch failed for "${table}": ${describeError(targetErr)}`,
    );
  }
  const activeSet = new Set(
    sourceRows.map((r) => stableKeyIdentity(r, stableKey)),
  );
  const targetRows = (targetData as PayloadRow[] | null) ?? [];
  let deleted = 0;
  for (const row of targetRows) {
    if (activeSet.has(stableKeyIdentity(row, stableKey))) continue;
    let builder = target.from(table).delete();
    for (const col of stableKey) {
      builder = builder.in(col, [row[col]]);
    }
    const { error } = await builder;
    if (error) {
      throw new Error(
        `Tombstone composite delete failed for "${table}": ${describeError(error)}`,
      );
    }
    deleted += 1;
  }
  return deleted;
}

function formatInValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  // PostgREST in-list string values are double-quoted.
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

/**
 * Upsert the content_propagation_version ledger row for a table with a
 * monotonic version + payload checksum + applied_at. Cast for the staging-only
 * local row type (invariant 7) — this table is not in the prod-generated
 * Database type.
 */
async function recordVersion(
  target: PropagationClient,
  table: string,
  checksum: string,
): Promise<void> {
  const row: ContentPropagationVersionRow = {
    payload_key: table,
    // Monotonic version from wall-clock millis — strictly increasing per run,
    // sufficient for the "latest-applied" semantics of the ledger.
    version: Date.now(),
    payload_checksum: checksum,
    applied_at: new Date().toISOString(),
  };
  const { error } = await target
    .from(VERSION_TABLE)
    .upsert(row as unknown as PayloadRow, { onConflict: 'payload_key' });
  if (error) {
    throw new Error(
      `content_propagation_version upsert failed for "${table}": ${describeError(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Whole-target sync
// ---------------------------------------------------------------------------

/**
 * Propagate the entire PAYLOAD_CONTRACT (in order) from source to a single
 * target. Stops at the first hard error for THIS target (fail-loud) and
 * surfaces it on the result; the caller decides whether to continue to others.
 */
export async function propagateAllToTarget(
  source: PropagationClient,
  target: PropagationClient,
  ref: string,
  opts: PropagateOptions,
): Promise<TargetPropagationResult> {
  const log = opts.log ?? consoleLog;
  // Invariant 3 analogue: log the authoritative catalog ref before writing.
  log({
    level: 'info',
    ref,
    msg: `propagating to target ref=${ref}${opts.dryRun ? ' [dry-run]' : ''}`,
  });

  const tables: TablePropagationResult[] = [];
  try {
    for (const contract of PAYLOAD_CONTRACT) {
      tables.push(await propagateTableToTarget(source, target, contract, opts));
    }
    return { ref, ok: true, tables };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({ level: 'error', ref, msg: `target failed: ${message}` });
    return { ref, ok: false, tables, error: message };
  }
}

// ---------------------------------------------------------------------------
// Catalog + connection
// ---------------------------------------------------------------------------

/**
 * Read the gitignored catalog (config-as-data, invariant 2). Each entry is
 * `{ ref, url, serviceRoleKey }`. Fail-loud on a malformed catalog.
 */
export function readCatalog(path: string): CatalogTarget[] {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Catalog at ${path} must be a JSON array of targets`);
  }
  return parsed.map((entry, i) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as CatalogTarget).ref !== 'string' ||
      typeof (entry as CatalogTarget).url !== 'string' ||
      typeof (entry as CatalogTarget).serviceRoleKey !== 'string'
    ) {
      throw new Error(
        `Catalog entry ${i} at ${path} must have string {ref, url, serviceRoleKey}`,
      );
    }
    return entry as CatalogTarget;
  });
}

/**
 * Construct a service-role client. Follows the existing script idiom; does NOT
 * import lib/env-server.ts or lib/supabase/server.ts (invariant 3).
 */
export function makeClient(
  url: string,
  serviceRoleKey: string,
): PropagationClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PropagationClient;
}

function consoleLog(event: PropagationLogEvent): void {
  const line = JSON.stringify(event);
  if (event.level === 'error') console.error(line);
  else if (event.level === 'warn') console.warn(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// CLI bootstrap
// ---------------------------------------------------------------------------

export interface CliArgs {
  sourceUrl?: string;
  sourceKey?: string;
  targetsPath: string;
  targetUrl?: string;
  targetKey?: string;
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };
  return {
    sourceUrl: get('--source-url') ?? process.env.SOURCE_SUPABASE_URL,
    sourceKey:
      get('--source-key') ?? process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY,
    targetsPath: get('--targets') ?? 'scripts/.propagation-catalog.json',
    targetUrl: get('--target-url'),
    targetKey: get('--target-key'),
    dryRun: argv.includes('--dry-run'),
  };
}

/**
 * Resolve the target list: an explicit --target-url/--target-key pair wins,
 * otherwise the gitignored catalog at --targets.
 */
export function resolveTargets(args: CliArgs): CatalogTarget[] {
  if (args.targetUrl && args.targetKey) {
    return [
      {
        ref:
          new URL(args.targetUrl).hostname.split('.')[0] ?? 'explicit-target',
        url: args.targetUrl,
        serviceRoleKey: args.targetKey,
      },
    ];
  }
  return readCatalog(args.targetsPath);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceUrl || !args.sourceKey) {
    throw new Error(
      'Source connection required: pass --source-url/--source-key or set ' +
        'SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  const source = makeClient(args.sourceUrl, args.sourceKey);
  const targets = resolveTargets(args);
  if (targets.length === 0) {
    throw new Error('No targets resolved (empty catalog / no --target-url)');
  }

  const opts: PropagateOptions = { dryRun: args.dryRun };
  let anyFailed = false;
  for (const t of targets) {
    const target = makeClient(t.url, t.serviceRoleKey);
    const result = await propagateAllToTarget(source, target, t.ref, opts);
    if (!result.ok) anyFailed = true;
  }
  if (anyFailed) {
    process.exitCode = 1;
  }
}

// Run only when invoked directly (never on import — tests import the functions).
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('propagate-canonical-content.ts')
) {
  main().catch((err) => {
    console.error(
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exitCode = 1;
  });
}
