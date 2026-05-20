#!/usr/bin/env bun
/**
 * audit-opaque-json-rpcs.ts
 *
 * Re-runnable verifier for the 14 opaque-Json RPC inventory
 * (R-WP12 §WP-C, kh-ast-S9 Wave 1 — R-WP19).
 *
 * Outputs one JSON object per line (JSONL) to stdout. Each object records:
 *   - function_name         — PL/pgSQL function name
 *   - database_types_line   — line number in supabase/types/database.types.ts
 *   - ts_callers            — list of { file, line, snippet } from corpus scan
 *   - verdict               — convertible | requires-design | no-ts-callers | leave-as-is
 *   - notes                 — brief rationale
 *
 * Usage:
 *   bun scripts/audit-opaque-json-rpcs.ts
 *   bun scripts/audit-opaque-json-rpcs.ts | jq '.'
 *   bun scripts/audit-opaque-json-rpcs.ts | jq '[.verdict] | group_by(.) | map({verdict: .[0], count: length})'
 *
 * Investigation only — does NOT execute any migrations or DDL.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const DB_TYPES_PATH = resolve(REPO_ROOT, 'supabase/types/database.types.ts');

// ---------------------------------------------------------------------------
// Step 1 — Extract the 14 opaque-Json RPC names from database.types.ts
// ---------------------------------------------------------------------------

function extractOpaqueJsonRpcs(): Array<{ name: string; line: number }> {
  const content = readFileSync(DB_TYPES_PATH, 'utf-8');
  const lines = content.split('\n');
  const results: Array<{ name: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('Returns: Json')) continue;

    // Case A (same-line, single-brace): `foo: { Args: never; Returns: Json }`
    //   or `foo: { Args: { p_x: string }; Returns: Json }`
    // Strategy: find the function-name token before the first `{` on this line.
    const sameLineNameMatch = lines[i].match(/^\s+(\w+):\s*\{/);
    if (sameLineNameMatch) {
      results.push({ name: sameLineNameMatch[1], line: i + 1 });
      continue;
    }

    // Case B (multi-line): `Returns: Json` is indented further and the
    // function name is on a prior line.
    // Search backwards for `      name: {` (6-space indent) within 10 lines.
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      const nameMatch = lines[j].match(/^\s{6}(\w+):\s*\{/);
      if (nameMatch) {
        results.push({ name: nameMatch[1], line: i + 1 });
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Step 2 — Walk the corpus and find TS callers without shelling out
// ---------------------------------------------------------------------------

interface TsCaller {
  file: string;
  line: number;
  snippet: string;
}

/** Recursively collect .ts / .tsx files under dir, skipping node_modules / .next. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next' || name === '.git')
      continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// Build the file list once; the corpus is ~1,200 TS files so this is fast.
const CORPUS_DIRS = ['app', 'lib', 'hooks', 'components', 'contexts'].map((d) =>
  join(REPO_ROOT, d),
);

let _corpusFiles: string[] | null = null;
function getCorpusFiles(): string[] {
  if (!_corpusFiles) {
    _corpusFiles = CORPUS_DIRS.flatMap(collectTsFiles).filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
    );
  }
  return _corpusFiles;
}

function findTsCallers(functionName: string): TsCaller[] {
  const needle = `rpc('${functionName}'`;
  const callers: TsCaller[] = [];

  for (const filePath of getCorpusFiles()) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(needle)) continue;
      callers.push({
        file: filePath.replace(REPO_ROOT + '/', ''),
        line: i + 1,
        snippet: lines[i].trim().slice(0, 120),
      });
    }
  }

  return callers;
}

// ---------------------------------------------------------------------------
// Step 3 — Verdicts (hand-coded from investigation; re-run for verification)
// ---------------------------------------------------------------------------

type Verdict =
  | 'convertible'
  | 'requires-design'
  | 'no-ts-callers'
  | 'leave-as-is';

interface RpcEntry {
  function_name: string;
  database_types_line: number;
  arguments: string;
  ts_callers: TsCaller[];
  verdict: Verdict;
  return_shape_summary: string;
  migration_sketch?: string;
  notes: string;
}

const VERDICTS: Record<
  string,
  {
    verdict: Verdict;
    arguments: string;
    return_shape_summary: string;
    migration_sketch?: string;
    notes: string;
  }
> = {
  get_author_analysis: {
    verdict: 'requires-design',
    arguments: 'p_author_name text',
    return_shape_summary:
      'json_build_object with fixed scalar fields (author_name, total_items, first_item, latest_item, avg_confidence) plus four nested json_agg arrays (domain_breakdown, subtopic_breakdown, top_keywords, content_types). Arrays of heterogeneous objects prevent a flat RETURNS TABLE.',
    notes:
      'Top-level scalar fields are stable and individually convertible. Arrays require composite types or separate RPCs. Recommend split: one RPC for scalars, one or more for breakdowns. Route (app/api/insights/route.ts:71) passes data through without casting — client receives raw opaque Json.',
  },
  get_procurement_summary: {
    verdict: 'no-ts-callers',
    arguments: 'bid_workspace_id uuid',
    return_shape_summary:
      'json_build_object with workspace_id, total_questions, status_breakdown (array), confidence_breakdown (array), responses_count, review_status_breakdown (array), sections (array). Rich nested aggregation.',
    notes:
      'Zero TS callers. Defined in pre_squash_reconciliation migration. Candidate for deletion. No Python callers found in scripts/. Verify against production Supabase usage metrics before deleting.',
  },
  get_content_gaps: {
    verdict: 'requires-design',
    arguments: '(none)',
    return_shape_summary:
      'json_build_object with three nested json_agg arrays: sparse_subtopics, stale_subtopics, domain_summary. Each element has different fields. No single RETURNS TABLE fits all three arrays simultaneously.',
    notes:
      'Route (app/api/insights/route.ts:84) passes data through without casting. Three heterogeneous arrays in one JSON object make a single RETURNS TABLE impractical. Best path: three separate structured RPCs, one per section. Enables partial caching and independent typing.',
  },
  get_dashboard_attention_counts: {
    verdict: 'convertible',
    arguments: "p_user_id uuid, p_role text DEFAULT 'viewer'",
    return_shape_summary:
      'json_build_object with 9 integer scalar fields + 1 nested object (freshness_summary with 4 integer fields). The freshness_summary nesting is the only structural complexity.',
    migration_sketch: [
      '-- RETURNS TABLE with freshness columns flattened (Option A — recommended)',
      'CREATE OR REPLACE FUNCTION public.get_dashboard_attention_counts(',
      '  p_user_id uuid,',
      "  p_role text DEFAULT 'viewer'",
      ')',
      'RETURNS TABLE (',
      '  governance_review_count     integer,',
      '  unverified_count            integer,',
      '  quality_flag_count          integer,',
      '  stale_content_count         integer,',
      '  expired_content_count       integer,',
      '  expiring_content_date_count integer,',
      '  unread_notification_count   integer,',
      '  coverage_gap_count          integer,',
      '  freshness_fresh             integer,',
      '  freshness_aging             integer,',
      '  freshness_stale             integer,',
      '  freshness_expired           integer',
      ')',
      'LANGUAGE plpgsql',
      'SECURITY INVOKER',
      'SET search_path = public, extensions',
      'AS $$ ... $$;',
      '-- Caller: lib/dashboard.ts:287',
      '-- Cast at lib/dashboard.ts:374 removed; access columns directly.',
      '-- Sweep: 1 call site + reconstruction at lib/dashboard.ts:374-403.',
    ].join('\n'),
    notes:
      'lib/dashboard.ts:374 manually constructs a typed shape from the opaque result. Converting to RETURNS TABLE removes that cast and gives direct column access. Freshness sub-object flattened to 4 columns. Low risk — single TS caller.',
  },
  get_entity_list_aggregated: {
    verdict: 'requires-design',
    arguments:
      'p_type text, p_search text, p_variants_only boolean, p_type_conflicts boolean, p_limit integer, p_offset integer',
    return_shape_summary:
      'json_build_object with { entities: json_agg([per-entity objects]), total: integer }. The entities array contains objects with canonical_name, entity_type, mention_count, variant_count, variant_names (array), relationship_count, has_type_conflict, types_seen (array). Pagination envelope (data + total count) prevents a single RETURNS TABLE.',
    notes:
      'The { entities: [...], total: N } envelope is a deliberate pagination design that does not map to RETURNS TABLE without splitting into two RPCs (one for rows, one for count). App/api/entities/route.ts:56 passes data directly as NextResponse.json(data) — the client receives the full envelope. Splitting would require client changes. Requires design discussion.',
  },
  get_filter_counts: {
    verdict: 'convertible',
    arguments: '(none)',
    return_shape_summary:
      'jsonb_build_object with exactly 3 keys: domain, content_type, platform — each a jsonb object mapping string-label to integer count. No arrays, no nesting beyond one level.',
    migration_sketch: [
      '-- RETURNS TABLE with three jsonb columns',
      'CREATE OR REPLACE FUNCTION public.get_filter_counts()',
      'RETURNS TABLE (',
      '  domain       jsonb,   -- e.g. {"Technology": 42, "Finance": 17}',
      '  content_type jsonb,',
      '  platform     jsonb',
      ')',
      'LANGUAGE plpgsql',
      'SECURITY INVOKER',
      'SET search_path = public, extensions',
      'AS $$ ... $$;',
      '-- After: data is a single-row result; callers use data[0].domain, data[0].content_type etc.',
      '-- Both callers already use parseJsonb(FilterCountsSchema, data) for Zod validation.',
      '-- Sweep: 2 call sites — hooks/browse/use-filter-data.ts:62, hooks/browse/use-top-domains.ts:51',
    ].join('\n'),
    notes:
      'Both callers already apply Zod validation via parseJsonb(FilterCountsSchema, data), providing runtime type safety. The main benefit of conversion is compiler-level enforcement. Converting changes the return from a single JSONB to a single-row TABLE — callers would access data[0].domain. Lower urgency than get_dashboard_attention_counts (Zod already fills the gap), but mechanically straightforward.',
  },
  get_reading_patterns: {
    verdict: 'requires-design',
    arguments: 'p_days integer DEFAULT 30',
    return_shape_summary:
      'json_build_object with scalar fields (period_days, total_items, items_read, reading_velocity) plus three nested json_agg arrays: domain_reading, type_reading, reading_timeline. Arrays have different element shapes.',
    notes:
      'Same pattern as get_author_analysis. Scalars are convertible; arrays are not without splitting. Route (app/api/insights/route.ts:95) passes data through without casting. Splitting into sub-RPCs increases network round trips for the insights page.',
  },
  get_review_breakdown_stats: {
    verdict: 'requires-design',
    arguments: '(none)',
    return_shape_summary:
      'json_build_object with scalar fields (total, verified, flagged, draft, overdue) plus four JSONB object breakdowns: by_domain, by_content_type, by_source_file, by_source_document. Breakdown objects use json_object_agg with domain/type names as dynamic keys.',
    notes:
      'Most complex of the 14. The four breakdown objects use json_object_agg with runtime-dynamic keys (domain names, content types, etc.) — RETURNS TABLE cannot model this. Partial conversion is possible: scalar fields as typed TABLE columns, breakdown objects as jsonb columns. Current cast at app/api/review/stats/route.ts:76 (statsResult.data as Omit<ReviewStatsResponse,...>) could be narrowed to only the breakdown fields if scalars become typed columns.',
  },
  get_topic_deep_dive: {
    verdict: 'requires-design',
    arguments: 'p_keyword text',
    return_shape_summary:
      'json_build_object with scalar fields (keyword, total_items) plus five nested json_agg arrays: domain_distribution, top_authors, timeline, co_occurring_keywords, recent_items. Arrays have different element shapes.',
    notes:
      'Same pattern as get_author_analysis and get_reading_patterns. Scalar fields are immediately convertible; arrays are not. Route (app/api/insights/route.ts:52) passes data through without casting.',
  },
  get_user_tag_counts: {
    verdict: 'convertible',
    arguments: '(none)',
    return_shape_summary:
      'jsonb_object_agg(tag, cnt) — a flat JSONB object mapping tag-name to integer count. No nesting, no arrays.',
    migration_sketch: [
      '-- RETURNS TABLE with two columns',
      'CREATE OR REPLACE FUNCTION public.get_user_tag_counts()',
      'RETURNS TABLE (tag text, cnt bigint)',
      'LANGUAGE sql',
      'STABLE',
      'SECURITY INVOKER',
      'SET search_path = public, extensions',
      'AS $$',
      '  SELECT tag, COUNT(*) AS cnt',
      '  FROM content_items ci, unnest(ci.user_tags) AS tag',
      "  WHERE user_tags IS NOT NULL AND user_tags != '{}'",
      '  GROUP BY tag',
      '  ORDER BY cnt DESC;',
      '$$;',
      '-- Caller: hooks/browse/use-filter-data.ts:125-128',
      '-- Current: data as Record<string, number> → Object.entries(tagCounts)',
      '-- After: data (typed array) → data.map(row => ({ tag: row.tag, count: Number(row.cnt) }))',
      '-- Sweep: 1 call site.',
    ].join('\n'),
    notes:
      "Caller at hooks/browse/use-filter-data.ts:125 uses 'data as Record<string, number>' cast. Converting to RETURNS TABLE removes that cast entirely. The Object.entries() pattern becomes a direct .map() on the typed row array. Very low risk — single call site, no nested structures. Simplest convertible function in the set.",
  },
  get_verification_stats: {
    verdict: 'no-ts-callers',
    arguments: '(none)',
    return_shape_summary:
      'json_build_object with scalar fields (total, verified, unverified, recent_7d) plus a domains json_agg array. Defined in pre_squash_reconciliation migration.',
    notes:
      'Zero TS callers. No Python callers found. Analytics/reporting function likely superseded by get_review_breakdown_stats (which is actively used). Candidate for deletion. Confirm via production Supabase usage metrics or Edge Function logs before deleting.',
  },
  get_workspace_counts: {
    verdict: 'convertible',
    arguments: '(none)',
    return_shape_summary:
      'jsonb_object_agg(name, cnt) — a flat JSONB object mapping workspace-name to item count. Same structural pattern as get_user_tag_counts.',
    migration_sketch: [
      '-- RETURNS TABLE with two columns',
      'CREATE OR REPLACE FUNCTION public.get_workspace_counts()',
      'RETURNS TABLE (workspace_name text, item_count bigint)',
      'LANGUAGE sql',
      'STABLE',
      'SECURITY INVOKER',
      'SET search_path = public, extensions',
      'AS $$',
      '  SELECT w.name AS workspace_name, COUNT(*) AS item_count',
      '  FROM content_item_workspaces ciw',
      '  JOIN workspaces w ON w.id = ciw.workspace_id',
      '  WHERE w.is_archived = false',
      '  GROUP BY w.name',
      '  ORDER BY item_count DESC;',
      '$$;',
      '-- No active TS callers — zero sweep cost.',
      '-- Recommend converting to establish correct pattern for future callers.',
    ].join('\n'),
    notes:
      'Zero TS callers. Converting to RETURNS TABLE is still recommended to prevent future callers inheriting the opaque-Json pattern. Trivial migration (~30 min). Can be combined with get_user_tag_counts in a single sprint.',
  },
  hook_restrict_signup_to_example-client_domain: {
    verdict: 'leave-as-is',
    arguments: 'event jsonb',
    return_shape_summary:
      "Supabase Auth Hook. Accepts event jsonb; returns '{}' on allowed domain or jsonb_build_object('error', ...) with http_code on reject. Return shape is conditional (success vs rejection).",
    notes:
      'This is a Supabase Auth Hook, not an application RPC. The function is registered as a hook via pg-functions://postgres/public/hook_restrict_signup_to_example-client_domain (see docs/audits/kh-production-readiness-phase-1). The JSONB input/output contract is defined by the Supabase Auth Hook protocol — converting to RETURNS TABLE would break the hook registration. Zero TS callers by design. Must remain RETURNS JSONB.',
  },
  merge_entities: {
    verdict: 'convertible',
    arguments: 'p_source_names text[], p_target_name text, p_entity_type text',
    return_shape_summary:
      'jsonb_build_object with exactly 7 scalar fields: merged (boolean), target (text), entity_type (text), mentions_updated (integer), relationship_sources_updated (integer), relationship_targets_updated (integer), duplicates_removed (integer). All scalars — no nested arrays.',
    migration_sketch: [
      '-- RETURNS TABLE (single-row result)',
      'CREATE OR REPLACE FUNCTION public.merge_entities(',
      '  p_source_names text[],',
      '  p_target_name  text,',
      '  p_entity_type  text',
      ')',
      'RETURNS TABLE (',
      '  merged                       boolean,',
      '  target                       text,',
      '  entity_type                  text,',
      '  mentions_updated             integer,',
      '  relationship_sources_updated integer,',
      '  relationship_targets_updated integer,',
      '  duplicates_removed           integer',
      ')',
      'LANGUAGE plpgsql',
      'SECURITY INVOKER',
      'SET search_path = public, extensions',
      'AS $$ ... $$;',
      '-- Caller: app/api/entities/merge/route.ts:48-70',
      '-- Current: data cast as { merged: boolean; target: string; ... }',
      '-- After: data[0] — remove cast, access typed columns directly.',
      '-- Sweep: 1 call site.',
    ].join('\n'),
    notes:
      'Single TS caller (app/api/entities/merge/route.ts:62) with explicit typed cast. Converting to RETURNS TABLE removes the cast and makes the field list compiler-enforced. Function performs DML (UPDATE, DELETE in transaction) — cannot be STABLE; mark VOLATILE. Medium risk due to DML nature; integration test recommended post-migration.',
  },
};

// ---------------------------------------------------------------------------
// Step 4 — Run and emit JSONL
// ---------------------------------------------------------------------------

const rpcs = extractOpaqueJsonRpcs();

for (const rpc of rpcs) {
  const callers = findTsCallers(rpc.name);
  const meta = VERDICTS[rpc.name];

  if (!meta) {
    process.stdout.write(
      JSON.stringify({
        function_name: rpc.name,
        database_types_line: rpc.line,
        ts_callers: callers,
        verdict: 'requires-design',
        return_shape_summary: 'NOT YET CATALOGUED',
        notes:
          'Function found in database.types.ts but not in VERDICTS map — update script.',
      }) + '\n',
    );
    continue;
  }

  const entry: RpcEntry = {
    function_name: rpc.name,
    database_types_line: rpc.line,
    arguments: meta.arguments,
    ts_callers: callers,
    verdict: meta.verdict,
    return_shape_summary: meta.return_shape_summary,
    ...(meta.migration_sketch
      ? { migration_sketch: meta.migration_sketch }
      : {}),
    notes: meta.notes,
  };

  process.stdout.write(JSON.stringify(entry) + '\n');
}

// Summary line to stderr (does not pollute JSONL stdout)
const allVerdicts = rpcs.map(
  (r) => VERDICTS[r.name]?.verdict ?? 'requires-design',
);
const counts = {
  convertible: allVerdicts.filter((v) => v === 'convertible').length,
  'requires-design': allVerdicts.filter((v) => v === 'requires-design').length,
  'no-ts-callers': allVerdicts.filter((v) => v === 'no-ts-callers').length,
  'leave-as-is': allVerdicts.filter((v) => v === 'leave-as-is').length,
};
process.stderr.write(
  `\n=== Audit summary ===\n` +
    `Total opaque-Json RPCs catalogued: ${rpcs.length}\n` +
    `  convertible:     ${counts.convertible}\n` +
    `  requires-design: ${counts['requires-design']}\n` +
    `  no-ts-callers:   ${counts['no-ts-callers']}\n` +
    `  leave-as-is:     ${counts['leave-as-is']}\n`,
);
