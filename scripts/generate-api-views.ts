#!/usr/bin/env bun
/**
 * ID-115 — `api` Data API surface generator.
 *
 * Reads the LOCAL Supabase Postgres catalog (post-`db reset`) and emits the
 * idempotent migration
 * `supabase/migrations/20260625160000_id130_api_views_regen.sql` (re-timestamped
 * after the ID-130 spine — see OUTPUT_FILE below):
 *
 *   1. 59 × `CREATE VIEW api.<t> WITH (security_invoker = true)` — 1:1 over the
 *      public base tables in the Data API surface, EXPLICIT ordered column lists
 *      (never `SELECT *`), every FK column projected verbatim so PostgREST
 *      relationship inference fires (S1 spike GREEN). Generated columns
 *      (content_items.content_text_hash) are plain passthrough — selectable,
 *      never insertable (the base rejects writes, which is correct). DROP/CREATE
 *      (not REPLACE) so an `ADD COLUMN` propagates on regen (INV-9).
 *   2. api RPC entrypoints — thin `SECURITY INVOKER` wrappers (LANGUAGE sql,
 *      `SET search_path = public, extensions`) delegating to `public.<fn>`.
 *      Covers both the INVOKER `.rpc` surface and the 10 SECURITY DEFINER fns
 *      (the privileged body keeps running as postgres inside `public`; the
 *      wrapper is INVOKER — INV-6). DROP/CREATE by identity-args so a future
 *      return-type change (ID-70: json -> TABLE) regenerates cleanly.
 *   3. Least-privilege grants:
 *        - views: GRANT only (api views get NO default grants — fail-closed);
 *          per-role intersect of base-table privileges among {S,I,U,D}, anon
 *          CAPPED at SELECT (INV-10).
 *        - functions: `REVOKE EXECUTE ... FROM PUBLIC` (Postgres hard-wires
 *          EXECUTE-to-PUBLIC on every new function in every schema — empirically
 *          confirmed) then GRANT to exactly the roles the public original grants
 *          (mirrors `proacl`). `set_config` ends up the sole anon-exec api fn
 *          (INV-20).
 *
 * Idempotent: re-running after a new public table/column/fn lands produces a
 * superset migration; same DB state -> byte-identical file (INV-16).
 *
 * Usage:
 *   bun scripts/generate-api-views.ts            # write the migration
 *   bun scripts/generate-api-views.ts --check    # generate to a temp buffer and
 *                                                 # diff vs the committed file;
 *                                                 # non-zero exit on drift (CI)
 *
 * DB URL: $API_VIEWS_DB_URL || $SUPABASE_DB_URL || the local default.
 * Requires `psql` on PATH and the local stack running.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// --- config ---------------------------------------------------------------

const DB_URL =
  process.env.API_VIEWS_DB_URL ??
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'supabase', 'migrations');
// Fixed filename — stable across regens so the idempotency diff is meaningful.
// Re-timestamped to AFTER the {131.19} coordinated-GO DDL (M6 id131_drops,
// 20260706110000, and the un-quarantined drop_inline_vector_cols, 20260706120000):
// this whole-surface regen must run LAST — it rebuilds api.record_lifecycle /
// api.record_embeddings, drops every api.* wrapper/view for a fn/table the GO
// retires (content_items, content_item_workspaces, content_history, read_marks,
// the tag/author/toggle_star/reading/filter/workspace/topic/gaps/dedup/quality-
// flag/activity-feed function families), and picks up the 8 new id138 SECURITY
// DEFINER wrappers (EXTRA_DEFINER_RPCS) live from the catalog. The earlier
// 20260625160000_id130_api_views_regen.sql STAYS as the pre-{131.19} snapshot
// (mirrors the 20260623140000_id115_api_views_and_rpcs.sql precedent from the
// prior re-timestamp) — this forward migration re-emits the FULL post-{131.19}
// surface as idempotent DROP/CREATE, so it applies cleanly on a fresh stack and
// is a no-op rebuild on hosted where surviving objects already exist. Both files
// fold into the next squash baseline. GENERATED, NOT YET WRITTEN — this Subtask
// only re-points the constant; the file itself is produced by running this
// script against a live local Postgres catalog (owner-gated, not run here).
const OUTPUT_FILE = join(
  MIGRATIONS_DIR,
  '20260706130000_id131_api_views_regen.sql',
);

const ROLES = ['anon', 'authenticated', 'service_role'] as const;
type Role = (typeof ROLES)[number];

/**
 * The Data API surface — 57 string-literal `.from()` targets + the 3
 * dynamic-only tables (signup_policy, tenant_config, content_propagation_version)
 * that never appear as a `.from('literal')` but are reached via `.from(variable)`
 * (SURFACE.md §3). Each MUST be a public BASE TABLE (asserted below).
 */
export const SURFACE_TABLES: readonly string[] = [
  'ai_call_events',
  'application_types',
  'change_reports',
  'citations',
  'classification_disputes',
  'company_profiles',
  'content_chunks',
  'content_propagation_version',
  'coverage_targets',
  'entity_aliases',
  'entity_mentions',
  'entity_relationships',
  'eval_baseline_audit',
  'eval_baselines',
  'eval_runs',
  'eval_touchpoints',
  'feed_articles',
  'feed_flags',
  'feed_prompts',
  'feed_sources',
  'form_outcome_types',
  'form_questions',
  'form_response_history',
  'form_responses',
  'form_template_fields',
  'form_template_requirements',
  'form_templates',
  'form_types',
  'governance_config',
  'guide_sections',
  'guides',
  'ingestion_quality_log',
  'intelligence_workspaces',
  'layer_vocabulary',
  'notifications',
  'pipeline_runs',
  'processing_queue',
  'q_a_extractions',
  'q_a_pair_dedup_proposals',
  'q_a_pair_history',
  'q_a_pairs',
  'record_embeddings',
  'record_lifecycle',
  'reference_items',
  'review_assignments',
  'si_processing_queue',
  'signup_policy',
  'source_documents',
  'tag_morphology_drift_flags',
  'taxonomy_domains',
  'taxonomy_subtopics',
  'taxonomy_sync_state',
  'template_completions',
  'tenant_config',
  'user_notification_prefs',
  'user_profiles',
  'user_roles',
  'verification_history',
  'workspaces',
];

/**
 * RPC entrypoints to mirror into `api`. = the surviving `.rpc()`-surface names
 * (SURFACE.md §2) MINUS the 3 that do not exist in the DB (dead `.rpc()` calls
 * with deliberate fallbacks — confirmed never-created, see ID-115 research)
 * MINUS the {131.19} M6 DROP set (20260706110000_id131_drops.sql — the tag/
 * author/toggle_star/reading/filter/workspace/topic/gaps/dedup families,
 * filter_by_keywords BOTH overloads, get_grouped_activity_feed,
 * get_items_with_quality_flags, get_quality_issue_counts), PLUS the SECURITY
 * DEFINER fns reached via lib/mcp/plugin-bundle.ts + app/api/ingest/url
 * (excluded from the SURFACE scan — see EXTRA_DEFINER_RPCS below). The
 * generator introspects EACH name's overloads from pg_proc and emits one
 * entrypoint per overload, so the actual entrypoint count >= name count.
 *
 * get_dashboard_attention_counts / get_coverage_matrix / get_coverage_summary
 * deliberately STAY here despite the content_items drop — see
 * 20260706110000_id131_drops.sql's header for why (2 of the first function's
 * 9 fields, and the entire body of the next two, are still content_items-
 * shaped and will error post-M6 pending a product-level re-point).
 *
 * get_content_win_rate ALSO stays (unrelated to the content_items drop): its
 * public function was already re-anchored to q_a_pair by CITE-EXT
 * (20260628191703, APPLIED) — the stale api.* wrapper still exposing the old
 * p_content_item_id signature (last regenerated before CITE-EXT landed) is
 * fixed by THIS regen picking up the live, already-renamed parameter.
 */
const SURFACE_RPCS: readonly string[] = [
  'check_content_exists',
  'claim_next_job',
  'cleanup_filtered_articles',
  'count_auth_users',
  'find_related_items',
  'get_aggregate_win_rate_stats',
  'get_check_constraint_values',
  'get_content_owner_stats',
  'get_content_win_rate',
  'get_coverage_matrix',
  'get_coverage_summary',
  'get_dashboard_attention_counts',
  'get_dashboard_summary',
  'get_due_feed_sources',
  'get_entity_list_aggregated',
  'get_entity_summary',
  'get_filter_ratio_trend',
  'get_form_question_stats',
  'get_form_question_stats_batch',
  'get_freshness_breakdown',
  'get_guide_content',
  'get_guide_coverage',
  'get_items_needing_layer',
  'get_popular_keywords',
  'get_review_breakdown_stats',
  'get_user_display_names',
  'hybrid_search',
  'list_public_tables',
  'merge_entities',
  'merge_item_metadata',
  'q_a_extractions_promotion_candidates',
  'reap_stuck_jobs',
  'recalculate_all_freshness',
  'search_for_form_response',
  'set_config',
];

/**
 * `.rpc()` names that have NO matching public function (confirmed never created;
 * each call site has a deliberate fallback / is a JSDoc example). Skipped — you
 * cannot wrap a function that does not exist. Tracked for a separate cleanup.
 */
const MISSING_RPCS: readonly string[] = [
  // Deliberately dual-listed: each also appears in SURFACE_RPCS above. The
  // RPC_NAMES filter (`SURFACE_RPCS.filter((n) => !MISSING_RPCS.includes(n))`)
  // subtracts these out, so they are SKIPPED from wrapper generation. Do NOT
  // remove an entry here without first confirming the function exists in the
  // `api` schema — dropping it un-skips the name and emits a wrapper around a
  // non-existent function (a broken view that fails the §2 SURFACE checks).
  'get_check_constraint_values',
  'get_dashboard_summary',
  'get_items_needing_layer',
];

/**
 * SECURITY DEFINER `.rpc()`-reachable fns NOT in the SURFACE.md §2 list because
 * the scan excluded lib/mcp/plugin-bundle.ts. They MUST get api INVOKER wrappers
 * (INV-6). reference_ingest is also reached at app/api/ingest/url/route.ts:208.
 *
 * _test_delete_broken_auth_user / _test_insert_broken_auth_user (S156 WP-1 test
 * helpers, SECURITY DEFINER, GRANT service_role only) are reached by the
 * integration suite's serviceClient, which also threads DB_OPTION → routes
 * `.rpc()` to `api` post-cutover. Wrapping them (rather than rewriting the tests
 * to `.schema('public')`) keeps the ID-115 S9 "zero per-call-site rewrites"
 * invariant and mirrors api.count_auth_users — a sibling SECDEF auth helper
 * already wrapped with REVOKE-PUBLIC + service_role GRANT, so anon cannot reach
 * them.
 *
 * ID-138 additions ({131.19} GO-PREP): 6 SECURITY DEFINER fns that
 * 20260703210000_id138_api_rpc_wrappers.sql hand-authored api.* wrappers for
 * (resolve_or_mint_source_identity, tombstone_source_document,
 * reap_orphaned_source_documents, citations_cascade_preflight,
 * corpus_writer_fence_try_acquire, corpus_writer_fence_release) — added here
 * so the generator's whole-surface regen supersedes that one-off hand
 * migration instead of leaving it as a permanent side channel outside the
 * generator's purview. Plus corpus_writer_fence_lease_acquire/_release
 * (20260704140000_id138_writer_fence_lease.sql, SECURITY DEFINER, landed
 * AFTER the hand-authored wrapper migration) — these have NEVER had an api.*
 * wrapper at all (hand-written or generated) until now.
 */
const EXTRA_DEFINER_RPCS: readonly string[] = [
  '_test_delete_broken_auth_user',
  '_test_insert_broken_auth_user',
  'q_a_search',
  'q_a_get_verbatim',
  'question_match_search',
  'question_match_recompute',
  'reference_search',
  'reference_get_verbatim',
  'reference_ingest',
  'resolve_or_mint_source_identity',
  'tombstone_source_document',
  'reap_orphaned_source_documents',
  'citations_cascade_preflight',
  'corpus_writer_fence_try_acquire',
  'corpus_writer_fence_release',
  'corpus_writer_fence_lease_acquire',
  'corpus_writer_fence_lease_release',
];

const RPC_NAMES: readonly string[] = [
  ...SURFACE_RPCS.filter((n) => !MISSING_RPCS.includes(n)),
  ...EXTRA_DEFINER_RPCS,
];

// --- psql plumbing --------------------------------------------------------

const FS = '\x1f'; // unit separator — never appears in catalog text
const RS = '\x1e'; // record separator

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

function fail(msg: string): never {
  console.error(`\x1b[31m[generate-api-views] ${msg}\x1b[0m`);
  process.exit(1);
}

// --- introspection --------------------------------------------------------

function assertBaseTable(t: string): void {
  const rows = psql(
    `SELECT c.relkind FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=${lit(t)}`,
  );
  if (rows.length === 0) fail(`surface table public.${t} does not exist`);
  if (rows[0][0] !== 'r')
    fail(
      `surface entry public.${t} is relkind='${rows[0][0]}', expected base table 'r'`,
    );
}

function columnsOf(t: string): { name: string; generated: boolean }[] {
  return psql(
    `SELECT a.attname, (a.attgenerated <> '')::text
       FROM pg_attribute a
      WHERE a.attrelid = ${lit('public.' + t)}::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
  ).map((r) => ({ name: r[0], generated: r[1] === 'true' }));
}

/** Base-table privileges per role among {SELECT,INSERT,UPDATE,DELETE}. */
function tableGrants(t: string): Record<Role, Set<string>> {
  const acc: Record<Role, Set<string>> = {
    anon: new Set(),
    authenticated: new Set(),
    service_role: new Set(),
  };
  for (const [grantee, priv] of psql(
    `SELECT a.grantee::regrole::text, a.privilege_type
       FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = ${lit('public.' + t)}::regclass
        AND a.grantee::regrole::text = ANY (ARRAY['anon','authenticated','service_role'])
        AND a.privilege_type = ANY (ARRAY['SELECT','INSERT','UPDATE','DELETE'])`,
  )) {
    acc[grantee as Role].add(priv);
  }
  return acc;
}

interface FnOverload {
  name: string;
  argsCreate: string; // pg_get_function_arguments — names + types + DEFAULTs
  identityArgs: string; // pg_get_function_identity_arguments — for GRANT/DROP
  result: string; // pg_get_function_result
  retset: boolean;
  definer: boolean;
  grantRoles: Role[];
}

function overloadsOf(name: string): FnOverload[] {
  const rows = psql(
    `SELECT pg_get_function_arguments(p.oid),
            pg_get_function_identity_arguments(p.oid),
            pg_get_function_result(p.oid),
            p.proretset::text,
            p.prosecdef::text,
            COALESCE((
              SELECT string_agg(DISTINCT a.grantee::regrole::text, ',')
              FROM aclexplode(p.proacl) a
              WHERE a.privilege_type = 'EXECUTE'
                AND a.grantee::regrole::text = ANY (ARRAY['anon','authenticated','service_role'])
            ), '') AS grant_roles
       FROM pg_proc p
      WHERE p.pronamespace='public'::regnamespace AND p.proname=${lit(name)}
      ORDER BY pg_get_function_identity_arguments(p.oid)`,
  );
  return rows.map((r) => ({
    name,
    argsCreate: r[0],
    identityArgs: r[1],
    result: r[2],
    retset: r[3] === 'true',
    definer: r[4] === 'true',
    grantRoles: (r[5] ? r[5].split(',') : []).filter((x): x is Role =>
      (ROLES as readonly string[]).includes(x),
    ),
  }));
}

// --- SQL helpers ----------------------------------------------------------

/** SQL string literal (single-quote escaped). */
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Extract input arg NAMES from an identity-args string ("p_a uuid, p_b text").
 * Splits on top-level commas (none of our types contain commas) and takes the
 * leading identifier of each segment. Empty -> no-arg fn.
 */
function argNames(identityArgs: string): string[] {
  const trimmed = identityArgs.trim();
  if (trimmed === '') return [];
  return trimmed.split(',').map((seg) => {
    const m = seg.trim().match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+/);
    if (!m)
      fail(`cannot parse arg name from segment '${seg}' in '${identityArgs}'`);
    return m[1];
  });
}

/**
 * Schema-qualify a composite `SETOF <relname>` return so it resolves to the
 * public base table regardless of the CREATE-time search_path. TABLE(...) and
 * `SETOF <builtin>` are left untouched (their types live in pg_catalog).
 */
function qualifyResult(result: string): string {
  const m = result.match(/^SETOF\s+([a-z_][a-z0-9_]*)$/i);
  if (m && (SURFACE_TABLES as readonly string[]).includes(m[1])) {
    return `SETOF public.${m[1]}`;
  }
  return result;
}

// --- emission -------------------------------------------------------------

function emitView(t: string): string {
  const cols = columnsOf(t);
  if (cols.length === 0) fail(`public.${t} has no columns`);
  const grants = tableGrants(t);
  const colLines = cols
    .map((c, i) => {
      const comma = i < cols.length - 1 ? ',' : '';
      const note = c.generated
        ? '  -- generated: passthrough (selectable, never insertable)'
        : '';
      return `    ${c.name}${comma}${note}`;
    })
    .join('\n');

  const grantLines: string[] = [];
  // anon: capped at SELECT (INV-10), and only if the base grants anon SELECT.
  if (grants.anon.has('SELECT'))
    grantLines.push(`GRANT SELECT ON api.${t} TO anon;`);
  // authenticated / service_role: mirror the base subset of {S,I,U,D}.
  for (const role of ['authenticated', 'service_role'] as const) {
    const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].filter((p) =>
      grants[role].has(p),
    );
    if (privs.length > 0)
      grantLines.push(`GRANT ${privs.join(', ')} ON api.${t} TO ${role};`);
  }

  return [
    `-- ${t} ${'─'.repeat(Math.max(1, 70 - t.length))}`,
    `DROP VIEW IF EXISTS api.${t};`,
    `CREATE VIEW api.${t} WITH (security_invoker = true) AS`,
    `  SELECT`,
    colLines,
    `  FROM public.${t};`,
    ...grantLines,
    '',
  ].join('\n');
}

function emitFunction(o: FnOverload): string {
  const names = argNames(o.identityArgs);
  // Named-argument notation (`name => name`) so the inner call disambiguates
  // overloads by parameter name (e.g. filter_by_keywords' 1-arg vs defaulted
  // 2-arg form, where a positional 1-arg call matches BOTH → 42725) and by
  // argument type (find_similar_content's double-precision vs numeric pair).
  // This mirrors how PostgREST itself binds RPC args from the JSON body.
  const callArgs = names.map((n) => `${n} => ${n}`).join(', ');
  const result = qualifyResult(o.result);
  const body = o.retset
    ? `SELECT * FROM public.${o.name}(${callArgs})`
    : `SELECT public.${o.name}(${callArgs})`;

  // Mirror the public original's grants; if the original somehow granted no
  // app role (unexpected), default to the server roles rather than nothing.
  const roles =
    o.grantRoles.length > 0
      ? o.grantRoles
      : (['authenticated', 'service_role'] as Role[]);

  const sigForCreate = `api.${o.name}(${o.argsCreate})`;
  const sigForGrant = `api.${o.name}(${o.identityArgs})`;
  const kind = o.definer
    ? 'INVOKER wrapper over SECURITY DEFINER public fn'
    : 'INVOKER entrypoint';

  return [
    `-- api.${o.name}(${o.identityArgs})  [${kind}]`,
    `DROP FUNCTION IF EXISTS ${sigForGrant};`,
    `CREATE FUNCTION ${sigForCreate}`,
    `  RETURNS ${result}`,
    `  LANGUAGE sql`,
    `  SECURITY INVOKER`,
    `  SET search_path = public, extensions`,
    `AS $api$`,
    `  ${body};`,
    `$api$;`,
    `REVOKE EXECUTE ON FUNCTION ${sigForGrant} FROM PUBLIC;`,
    `GRANT EXECUTE ON FUNCTION ${sigForGrant} TO ${roles.join(', ')};`,
    '',
  ].join('\n');
}

// --- main -----------------------------------------------------------------

function generate(): string {
  // 1. Validate the surface against the catalog.
  const sortedTables = [...SURFACE_TABLES].sort();
  for (const t of sortedTables) assertBaseTable(t);

  // 2. Views.
  const viewBlocks = sortedTables.map(emitView);

  // 3. RPC entrypoints (sorted by name then identity-args for determinism).
  const sortedRpcNames = [...new Set(RPC_NAMES)].sort();
  const fnBlocks: string[] = [];
  let fnCount = 0;
  for (const name of sortedRpcNames) {
    const overloads = overloadsOf(name);
    if (overloads.length === 0) {
      fail(
        `RPC '${name}' has no matching public function (add to MISSING_RPCS if intentionally absent)`,
      );
    }
    for (const o of overloads) {
      fnBlocks.push(emitFunction(o));
      fnCount += 1;
    }
  }

  const header = [
    '-- =============================================================================',
    '-- ID-115 — api Data API surface (GENERATED — do not hand-edit)',
    '-- =============================================================================',
    '--',
    '-- Produced by scripts/generate-api-views.ts from the local Postgres catalog.',
    '-- Re-run the generator (not a hand edit) after a public table/column/RPC lands;',
    '-- the api-grant-guard drift check (ID-115 S10) fails CI on an un-mirrored table.',
    '--',
    `-- Views:     ${sortedTables.length} security_invoker 1:1 views (explicit cols, FK verbatim).`,
    `-- Functions: ${fnCount} INVOKER entrypoints/wrappers (search_path=public,extensions).`,
    '-- Grants:    views fail-closed (explicit GRANT, anon<=SELECT); functions REVOKE',
    '--            EXECUTE FROM PUBLIC then GRANT mirrored roles (set_config sole anon-exec).',
    '-- =============================================================================',
    '',
    '-- Pin the search_path for the whole migration transaction so unqualified type',
    '-- refs in function signatures (notably `vector`, which lives in `extensions`)',
    '-- resolve at CREATE time regardless of the connecting role: a cached-creds',
    '-- `supabase db push` runs as a temp login role whose search_path omits',
    '-- `extensions`, whereas the postgres role includes it (ID-115 prod-cutover fix).',
    'SET search_path = public, extensions;',
    '',
    '-- ----------------------------------------------------------------------------',
    `-- VIEWS (${sortedTables.length})`,
    '-- ----------------------------------------------------------------------------',
    '',
  ].join('\n');

  const fnHeader = [
    '-- ----------------------------------------------------------------------------',
    `-- RPC ENTRYPOINTS (${fnCount})`,
    '-- ----------------------------------------------------------------------------',
    '',
  ].join('\n');

  const sql =
    header +
    viewBlocks.join('\n') +
    '\n' +
    fnHeader +
    fnBlocks.join('\n') +
    '\n';

  // 4. Self-checks (fail loudly before writing).
  selfCheck(sql, sortedTables.length, fnCount);
  return sql;
}

function selfCheck(sql: string, nViews: number, nFns: number): void {
  const allCreateViews = [...sql.matchAll(/CREATE VIEW api\.\w+/g)].length;
  const siViews = [
    ...sql.matchAll(/CREATE VIEW api\.\w+ WITH \(security_invoker = true\)/g),
  ].length;
  if (siViews !== nViews)
    fail(`expected ${nViews} security_invoker views, found ${siViews}`);
  // Any CREATE VIEW api.* lacking the storage param is a hard error (INV-3).
  if (allCreateViews !== siViews) {
    fail(
      `found ${allCreateViews - siViews} CREATE VIEW api.* without security_invoker`,
    );
  }
  // No api function is SECURITY DEFINER — match the emitted clause (line-anchored,
  // so `-- ...` comment mentions don't false-trip) (INV-6).
  if (/^[ \t]*SECURITY DEFINER\b/m.test(sql)) {
    fail(
      'an api function is SECURITY DEFINER — all api functions must be INVOKER (INV-6)',
    );
  }
  const createFns = [...sql.matchAll(/CREATE FUNCTION api\.\w+\(/g)];
  if (createFns.length !== nFns)
    fail(`expected ${nFns} api functions, found ${createFns.length}`);
  // Every api function REVOKEs from PUBLIC (least-privilege, no anon-exec leak).
  const revokes = [
    ...sql.matchAll(
      /REVOKE EXECUTE ON FUNCTION api\.\w+\([^)]*\) FROM PUBLIC;/g,
    ),
  ];
  if (revokes.length !== nFns)
    fail(`expected ${nFns} REVOKE-FROM-PUBLIC, found ${revokes.length}`);
}

function main(): void {
  const check = process.argv.includes('--check');
  const sql = generate();
  if (check) {
    if (!existsSync(OUTPUT_FILE))
      fail(`--check: ${OUTPUT_FILE} does not exist; run the generator`);
    const current = readFileSync(OUTPUT_FILE, 'utf8');
    if (current !== sql) {
      fail(
        '--check: generated output differs from the committed migration (run `bun scripts/generate-api-views.ts`)',
      );
    }
    console.log(
      '[generate-api-views] --check OK — committed migration matches the catalog.',
    );
    return;
  }
  writeFileSync(OUTPUT_FILE, sql);
  const nViews = SURFACE_TABLES.length;
  console.log(`[generate-api-views] wrote ${OUTPUT_FILE}`);
  console.log(
    `[generate-api-views]   ${nViews} views, ${RPC_NAMES.length} RPC names (overloads expanded).`,
  );
}

if (import.meta.main) main();
