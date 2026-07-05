#!/usr/bin/env bun
/**
 * ID-115 S10 — `api` Data API grant-guard + coverage drift check.
 *
 * Catalog-based CI gate (more robust than SQL-string parsing): runs against the
 * LOCAL stack post-`db reset` and asserts the live api-schema posture. Pairs with
 * `generate-api-views.ts --check` (which enforces the GENERATED migration matches
 * the catalog + every view security_invoker + no api DEFINER + per-fn REVOKE +
 * idempotency). This script is the standing guard on the DB state itself:
 *
 *   1. COVERAGE DRIFT (INV-16) — every `public` BASE TABLE is either in the api
 *      Data API surface (→ has an api view) or in the explicit internal-only
 *      allow-list. A new public table that is neither fails CI, forcing a
 *      deliberate decision (regenerate views, or allow-list it) — keeps the
 *      surface honest as ID-104/ID-71/etc. add tables.
 *   2. security_invoker (INV-3) — every api view has `security_invoker=true`
 *      (mirrors advisor lint 0010 at the catalog level).
 *   3. least-privilege grants (INV-10) — no api view grants anon INSERT/UPDATE/
 *      DELETE.
 *   4. anon-exec (INV-20) — `set_config` is the ONLY anon-EXECUTE api function,
 *      AND the only anon-EXECUTE `public` function (the retired per-fn REVOKE
 *      discipline's invariant, now catalog-checked here instead of diff-parsed).
 *
 * Usage:  bun scripts/check-api-view-coverage.ts
 * DB URL: $API_VIEWS_DB_URL || $SUPABASE_DB_URL || local default. Needs `psql`.
 */
import { execFileSync } from 'node:child_process';
import { SURFACE_TABLES } from './generate-api-views';

const DB_URL =
  process.env.API_VIEWS_DB_URL ??
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Public BASE TABLEs deliberately NOT exposed via the Data API (reached only by
 * direct-Postgres consumers — cocoindex asyncpg, internal RPCs, future/unused
 * workspace-type scaffolding). A new public table must be added EITHER to the
 * generator's SURFACE_TABLES (→ gets an api view) OR here (with justification),
 * else the coverage drift check fails. Originally audited against the 70-table
 * catalog at ID-115 S2 (70 base tables = 60 surface + these 10); counts drift
 * as tables are added/dropped — the live catalog check above is authoritative,
 * this list is not a count assertion.
 *
 * `content_templates` REMOVED at {131.19} M6 (20260706110000_id131_drops.sql
 * `DROP TABLE content_templates`) — the table no longer exists, so it is
 * neither a surface entry nor an internal-only allow-list entry; leaving it
 * here would be a dead reference once the M6 migration applies.
 */
const INTERNAL_ONLY_TABLES: readonly string[] = [
  'competitor_research_workspaces',
  'entity_pair_resolutions',
  'procurement_vehicle_instances',
  'procurement_vehicles',
  'procurement_workspaces',
  'product_guide_workspaces',
  'question_matches',
  'sales_proposal_workspaces',
  'training_onboarding_workspaces',
];

const FS = '\x1f';
const RS = '\x1e';

function psql(sql: string): string[][] {
  const out = execFileSync(
    'psql',
    [
      DB_URL,
      '-X',
      '-A',
      '-t',
      '-F',
      FS,
      '-R',
      RS,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split(RS)
    .map((r) => r.replace(/\n$/, ''))
    .filter((r) => r.length > 0)
    .map((r) => r.split(FS));
}

const errors: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
  if (ok) {
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
  } else {
    console.log(`  \x1b[31mFAIL\x1b[0m ${label} — ${detail}`);
    errors.push(`${label}: ${detail}`);
  }
}

function main(): void {
  console.log('[check-api-view-coverage] auditing local api posture…');

  // 1. Coverage drift — every public base table classified.
  const baseTables = psql(
    `SELECT relname FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname NOT LIKE 'pg_%'
      ORDER BY relname`,
  ).map((r) => r[0]);
  const surface = new Set(SURFACE_TABLES);
  const internal = new Set(INTERNAL_ONLY_TABLES);
  const unclassified = baseTables.filter(
    (t) => !surface.has(t) && !internal.has(t),
  );
  check(
    'coverage drift — every public base table is surfaced or internal-allow-listed (INV-16)',
    unclassified.length === 0,
    `unclassified public base table(s): ${unclassified.join(', ')} — add to the generator SURFACE_TABLES (regenerate) or INTERNAL_ONLY_TABLES`,
  );

  // 1b. Every surface table actually has an api view.
  const apiViews = new Set(
    psql(
      `SELECT relname FROM pg_class WHERE relnamespace='api'::regnamespace AND relkind='v'`,
    ).map((r) => r[0]),
  );
  const missingViews = SURFACE_TABLES.filter((t) => !apiViews.has(t));
  check(
    'every surface table has an api view (INV-4)',
    missingViews.length === 0,
    `surface table(s) without an api view: ${missingViews.join(', ')}`,
  );

  // 2. Every api view is security_invoker.
  const nonInvoker = psql(
    `SELECT c.relname FROM pg_class c
      WHERE c.relnamespace='api'::regnamespace AND c.relkind='v'
        AND NOT (coalesce(c.reloptions,'{}') @> ARRAY['security_invoker=true'])
      ORDER BY 1`,
  ).map((r) => r[0]);
  check(
    'every api view is security_invoker=true (INV-3)',
    nonInvoker.length === 0,
    `view(s) missing security_invoker: ${nonInvoker.join(', ')}`,
  );

  // 3. No api view grants anon a write.
  const anonWrites = psql(
    `SELECT DISTINCT c.relname FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.relnamespace='api'::regnamespace AND c.relkind='v'
        AND a.grantee='anon'::regrole AND a.privilege_type IN ('INSERT','UPDATE','DELETE')
      ORDER BY 1`,
  ).map((r) => r[0]);
  check(
    'no api view grants anon a write (INV-10)',
    anonWrites.length === 0,
    `view(s) with anon write grant: ${anonWrites.join(', ')}`,
  );

  // 4. set_config is the sole anon-EXECUTE function in api AND in public (INV-20).
  for (const schema of ['api', 'public']) {
    const anonExec = psql(
      `SELECT p.proname FROM pg_proc p
        WHERE p.pronamespace='${schema}'::regnamespace
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
        ORDER BY 1`,
    ).map((r) => r[0]);
    const unexpected = anonExec.filter((n) => n !== 'set_config');
    check(
      `set_config is the sole anon-EXECUTE ${schema} function (INV-20)`,
      unexpected.length === 0,
      `unexpected anon-exec ${schema} fn(s): ${unexpected.join(', ')}`,
    );
  }

  if (errors.length > 0) {
    console.error(
      `\n[check-api-view-coverage] ${errors.length} failure(s) — see above.`,
    );
    process.exit(1);
  }
  console.log(
    `\n[check-api-view-coverage] OK — api posture clean (${baseTables.length} base tables: ${SURFACE_TABLES.length} surfaced, ${INTERNAL_ONLY_TABLES.length} internal).`,
  );
}

if (import.meta.main) main();
