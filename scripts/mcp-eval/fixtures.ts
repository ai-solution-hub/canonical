/**
 * MCP Evaluation Fixtures — constants, auth, and test data helpers.
 *
 * Provides:
 *   - Canonical lists of tool names, resource URIs, and prompt names
 *   - Env loading and Supabase auth helpers
 *   - Eval content item lifecycle (create at suite start, delete at end)
 *   - Known UUID lookup from the live database
 */
import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { loadScriptEnv } from '@/scripts/lib/load-script-env';
import {
  MCP_EVAL_SEED_ITEMS,
  MCP_EVAL_SEED_METADATA_FLAG,
  MCP_EVAL_SEED_ROLE_SIMILARITY_SOURCE,
} from './seed-data.js';

// ---------------------------------------------------------------------------
// Env loading (shared scriptDir+cwd loader — bl-356)
// ---------------------------------------------------------------------------

export function loadEnv(): void {
  loadScriptEnv(import.meta.url);
}

// ---------------------------------------------------------------------------
// Canonical lists — 41 tools (42 after S357 Wave-1; ID-117.12 retired
// get_document_diff, 42 → 41). S357 Wave-1 surface consolidation:
// ID-71.7 (M27/B-INV-27) collapsed the search trio (search_knowledge_base /
// search_qa_library / search_content_chunks) + find_similar_items into ONE `find`
// entry; ID-71.10 (M32) collapsed get_content_item+get_content_items → `get` and
// assign_content_owner+bulk_assign_owner → `assign`. find_duplicate_candidates
// retained (dedup consolidation is a later slice). 58 → 53.
// ID-71.8 (M29/M4, B-INV-4/29) collapsed the 8 exposure reads
// (get_freshness_report, get_expiring_content, get_coverage_gaps, audit_content,
// get_quality_summary, get_quality_briefing, get_quality_actions,
// get_certification_status) into ONE `where_are_we_exposed` five-layer entry;
// suggest_content_creation KEPT as the resolution affordance. 53 → 46 (−8 +1).
// ID-71.9 (M30/OQ-5, B-INV-30) collapsed the 4 fragmented queue reads
// (get_governance_queue, get_review_queue, get_assignments_for_user,
// get_dashboard_summary) into ONE faceted `whats_in_my_queue` entry over the
// lib/attention.ts producer substrate. 46 → 43 (−4 +1).
// ID-71.10 PART 2 (M32, B-INV-32 dedup portion) collapsed the dedup pair
// (find_duplicate_candidates single-item + find_all_duplicates whole-KB
// batch) into ONE `find_duplicates` entry in lib/mcp/tools/search.ts.
// 43 → 42 (−2 +1). ID-131.15 (G-DEDUP legacy dedup-family retirement, S446)
// later removed the whole-KB batch-scan branch (the find_duplicate_pairs RPC
// it depended on was dropped) — find_duplicates is now single-item-only, no
// `scope` param. ID-131.19 (M6, S450 GO tail) RETIRED get_workspace_items —
// its sole mechanism (content_item_workspaces junction table) was dropped at
// M6, no production caller existed. 42 → 41 → 40.
// ---------------------------------------------------------------------------

/** Canonical set of all 40 MCP tool names. Compared as a set (not an ordered list) by `mcp-fixture-sync.test.ts`. */
export const CANONICAL_TOOL_NAMES = [
  // ID-71.7 — ONE consolidated find/answer entry (search + QA + chunk + similar).
  'find', // 1
  'get_reorientation', // 5
  // ID-71.8 — ONE consolidated five-layer exposure entry (was get_freshness_report,
  // get_expiring_content, get_coverage_gaps, audit_content, get_quality_summary,
  // get_quality_briefing, get_quality_actions, get_certification_status).
  'where_are_we_exposed',
  'list_active_procurement', // 8
  'get_procurement_detail', // 9
  'get_form_question', // 10
  'cite_content', // 11
  'get_content_effectiveness', // 12
  'get', // 13 (ID-71.10 — one-or-many; was get_content_item + get_content_items)
  'create_content_item', // 14
  'update_content_item', // 15
  // get_workspace_items RETIRED (ID-131.19, M6) — content_item_workspaces dropped.
  'assign', // 17 (ID-71.10 — one-or-many; was assign_content_owner + bulk_assign_owner)
  'get_document_versions', // 18
  // get_document_diff RETIRED (ID-117.12) — legacy diff-display surface removed.
  // ID-71.10 PART 2 — dedup entry; was find_duplicate_candidates
  // (single-item) + find_all_duplicates (batch). Single-item-only since
  // ID-131.15 retired the whole-KB batch-scan branch.
  'find_duplicates',
  'suggest_content_creation', // 26 (KEPT — ID-71.8 resolution affordance, B-INV-4)
  'classify_content', // 29
  'generate_summary', // 30
  'get_entity_relationships', // 31
  'list_templates', // 33
  'get_template_coverage', // 34
  'get_template_gaps', // 35
  'show_coverage_matrix', // 36
  'show_procurement_dashboard', // 37
  'show_reorient_me', // 38
  'show_intelligence_feed', // 39
  'delete_content_item', // 40
  'update_governance_status', // 41
  'get_intelligence_summary', // 42
  'list_guides', // 44
  'get_guide', // 45
  'create_guide', // 46
  'update_guide', // 47
  'trigger_intelligence_poll', // 48
  // S180 P0-23 — review + governance additions.
  // ID-71.9 — ONE faceted queue entry (was get_governance_queue,
  // get_review_queue, get_assignments_for_user, get_dashboard_summary).
  'whats_in_my_queue',
  'review_governance_item', // 50
  'create_review_assignment', // 53
  // S180 P1-35 — change-report tool (WP6, 52 → 53).
  'get_change_report', // 54
  // S186 WP-B.4 — supersession model (53 → 54).
  'supersede_content_item', // 55
  // S194 UI-simp WP4.2 — P1-34 workspace resolution helper (55 → 56).
  'list_user_workspaces', // 56
  // S202 §5.2 Phase 2 / T7 — publication-lifecycle MCP surface (56 → 57).
  'update_publication_status', // 57
] as const;

export const TOOL_COUNT = CANONICAL_TOOL_NAMES.length; // 40 (ID-117.12 retired get_document_diff: 42 − 1; ID-131.19 retired get_workspace_items: 41 − 1)

/** Read-only tools (no side effects). */
export const READ_ONLY_TOOLS = new Set([
  'find',
  'find_duplicates', // ID-71.10 part 2 — consolidated dedup entry
  'get_reorientation',
  'where_are_we_exposed', // ID-71.8 — five-layer exposure consolidation
  'whats_in_my_queue', // ID-71.9 — faceted queue consolidation
  'list_active_procurement',
  'get_procurement_detail',
  'get_form_question',
  'get_content_effectiveness',
  'get', // ID-71.10 — one-or-many (was get_content_item + get_content_items)
  // get_workspace_items RETIRED (ID-131.19, M6) — content_item_workspaces dropped.
  'suggest_content_creation',
  'get_entity_relationships',
  'list_templates',
  'get_template_coverage',
  'get_template_gaps',
  'show_coverage_matrix',
  'show_procurement_dashboard',
  'show_reorient_me',
  'show_intelligence_feed',
  'get_document_versions',
  'get_intelligence_summary',
  'get_guide',
  'list_guides',
  // S180 P1-35
  'get_change_report',
  // S194 UI-simp WP4.2 — P1-34
  'list_user_workspaces',
]);

/** Write tools that modify data. */
export const WRITE_TOOLS = new Set([
  'classify_content', // 10
  'generate_summary', // 11
  'create_content_item', // 12
  'cite_content', // 15
  'update_content_item', // 19
  'delete_content_item', // 25
  'update_governance_status', // 30
  'assign', // ID-71.10 — one-or-many (was assign_content_owner + bulk_assign_owner)
  'create_guide',
  'update_guide',
  'trigger_intelligence_poll',
  // S180 P0-23 additions
  'review_governance_item',
  'create_review_assignment',
  // S186 WP-B.4
  'supersede_content_item',
  // S202 §5.2 Phase 2 / T7 — publication lifecycle write tool
  'update_publication_status',
]);

/**
 * Tools that call the Claude API (classification/summarisation) — skip with --skip-ai.
 * Embedding-only tools (search, create draft) are NOT skipped: they use OpenAI
 * embeddings which are fast and cheap (<$0.001 per call).
 */
export const AI_TOOLS = new Set([
  'classify_content', // calls Claude API
  'generate_summary', // calls Claude API
]);

/** All 7 prompt names. */
export const CANONICAL_PROMPT_NAMES = [
  'reorient',
  'form_briefing',
  'coverage_analysis',
  'draft_response',
  'review_item',
  'sector_briefing',
  'form_pipeline_review',
] as const;

export const PROMPT_COUNT = CANONICAL_PROMPT_NAMES.length; // 7

/** Resource template URIs (3 templates). */
export const RESOURCE_TEMPLATE_URIS = [
  'kb://items/{id}',
  'kb://forms/{id}',
  'kb://qa/{id}',
] as const;

/** Static resource URIs (8 static + 4 app). */
export const STATIC_RESOURCE_URIS = [
  'kb://coverage',
  'kb://dashboard',
  'kb://taxonomy',
  'kb://entities',
  'kb://quality-briefing',
  'ui://coverage-matrix/app.html',
  'ui://form-dashboard/app.html',
  'ui://reorient-me/app.html',
  'ui://intelligence-feed/app.html',
] as const;

// ---------------------------------------------------------------------------
// Auth helper — sign in as test user, return access token
// ---------------------------------------------------------------------------

export async function getAuthToken(): Promise<{
  accessToken: string;
  supabase: SupabaseClient;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.TEST_USER_1_EMAIL;
  const password = process.env.TEST_USER_1_PASSWORD;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  }
  if (!email || !password) {
    throw new Error(
      'Missing TEST_USER_1_EMAIL or TEST_USER_1_PASSWORD. ' +
        'Set these in .env to an admin test user.',
    );
  }

  const supabase = createScriptClient(url, anonKey);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error(`Auth failed: ${error?.message ?? 'No session returned'}`);
  }

  return {
    accessToken: data.session.access_token,
    supabase,
  };
}

// ---------------------------------------------------------------------------
// Known UUIDs — query from live database
// ---------------------------------------------------------------------------

export interface KnownUUIDs {
  contentItemId: string;
  procurementId: string | null;
  questionId: string | null;
  procurementResponseId: string | null;
}
interface SeedContentItemRow {
  id: string;
  metadata: Record<string, unknown> | null;
}

function isMcpEvalSeedMetadata(metadata: unknown): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as Record<string, unknown>)[MCP_EVAL_SEED_METADATA_FLAG] === true
  );
}

function getMcpEvalSeedRole(metadata: unknown): string | null {
  if (!isMcpEvalSeedMetadata(metadata)) return null;
  const role = (metadata as Record<string, unknown>).mcp_eval_seed_role;
  return typeof role === 'string' ? role : null;
}

export async function getKnownUUIDs(
  supabase: SupabaseClient,
): Promise<KnownUUIDs> {
  // Get a deterministic seeded Q&A item with an embedding. The MCP eval seed
  // job runs once before L1/L3/L4 fan-out; missing rows are a real setup error,
  // not a graceful skip, because otherwise eval jobs appear green while testing
  // no search/Q&A behaviour.
  const { data: seedItems, error: seedError } = await supabase
    .from('content_items')
    .select('id, metadata')
    .eq('content_type', 'q_a_pair')
    .eq('publication_status', 'published')
    .contains('metadata', { [MCP_EVAL_SEED_METADATA_FLAG]: true })
    .not('embedding', 'is', null)
    .is('archived_at', null)
    .order('title', { ascending: true });

  if (seedError) {
    throw new Error(
      `Failed to query MCP eval seed Q&A items: ${seedError.message}`,
    );
  }

  const seededRows = (seedItems ?? []) as SeedContentItemRow[];
  const contentItem =
    seededRows.find(
      (row) =>
        getMcpEvalSeedRole(row.metadata) ===
        MCP_EVAL_SEED_ROLE_SIMILARITY_SOURCE,
    ) ?? seededRows[0];

  if (!contentItem) {
    throw new Error(
      '\n[MCP eval setup failed] no seeded Q&A content_items with embeddings found.\n' +
        `  Expected: ${MCP_EVAL_SEED_ITEMS.length} published q_a_pair rows with metadata.${MCP_EVAL_SEED_METADATA_FLAG}=true.\n` +
        '  Action: run `bun run seed:mcp-eval` against the target Supabase environment before MCP eval L1/L3/L4.\n',
    );
  }

  // Get a known bid workspace. Post-T2: discriminator is application_types.key
  // via JOIN; 'bid' maps to 'procurement'.
  const { data: bid } = await supabase
    .from('workspaces')
    .select('id, application_types!inner(key)')
    .eq('application_types.key', 'procurement')
    .eq('is_archived', false)
    .limit(1)
    .single();

  // Get a known bid question (if bid exists)
  let questionId: string | null = null;
  if (bid) {
    const { data: question } = await supabase
      .from('form_questions')
      .select('id')
      .eq('workspace_id', bid.id)
      .limit(1)
      .single();
    questionId = question?.id ?? null;
  }

  let procurementResponseId: string | null = null;
  if (questionId) {
    const { data: response } = await supabase
      .from('form_responses')
      .select('id')
      .eq('question_id', questionId)
      .limit(1)
      .single();
    procurementResponseId = response?.id ?? null;
  }

  return {
    contentItemId: contentItem.id,
    procurementId: bid?.id ?? null,
    questionId,
    procurementResponseId,
  };
}

// ---------------------------------------------------------------------------
// Eval content item lifecycle
// ---------------------------------------------------------------------------

const EVAL_TITLE = '[MCP-EVAL] Protocol compliance test item';
const EVAL_CONTENT =
  'This is a temporary item created by the MCP evaluation harness. It tests write tool functionality and will be deleted at the end of the test run.';
const DEFAULT_STALE_EVAL_ITEM_MIN_AGE_MINUTES = 60;

export interface EvalItem {
  id: string;
  title: string;
}

/**
 * Creates a dedicated eval content item via the Supabase client (not MCP).
 * This ensures the item exists before testing MCP write tools against it.
 */
export async function createEvalItem(
  supabase: SupabaseClient,
): Promise<EvalItem> {
  // Clean up any leftover eval items from previous runs. Use the shared
  // lifecycle helper so content_history is deleted before content_items; a raw
  // parent delete leaves ON DELETE SET NULL history orphans in staging.
  await cleanupStaleEvalItems(supabase);

  const { data, error } = await supabase
    .from('content_items')
    .insert({
      title: EVAL_TITLE,
      suggested_title: EVAL_TITLE,
      content: EVAL_CONTENT,
      content_type: 'note',
      platform: 'manual',
      captured_date: new Date().toISOString(),
    })
    .select('id, title')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create eval item: ${error?.message ?? 'Unknown error'}`,
    );
  }

  return { id: data.id, title: data.title ?? EVAL_TITLE };
}

/**
 * Deletes the eval content item and any related data.
 */
export async function deleteEvalItem(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  // Delete citations referencing the eval item
  await supabase.from('citations').delete().eq('cited_content_item_id', id);
  // Delete content history
  await supabase.from('content_history').delete().eq('content_item_id', id);
  // Delete the item itself
  await supabase.from('content_items').delete().eq('id', id);
}

/**
 * Cleans up any eval items left over from previous runs.
 */
export async function cleanupStaleEvalItems(
  supabase: SupabaseClient,
): Promise<number> {
  const minAgeMinutes = Number.parseInt(
    process.env.MCP_EVAL_STALE_ITEM_MIN_AGE_MINUTES ??
      String(DEFAULT_STALE_EVAL_ITEM_MIN_AGE_MINUTES),
    10,
  );
  const safeMinAgeMinutes =
    Number.isFinite(minAgeMinutes) && minAgeMinutes >= 0
      ? minAgeMinutes
      : DEFAULT_STALE_EVAL_ITEM_MIN_AGE_MINUTES;
  const cutoffIso = new Date(
    Date.now() - safeMinAgeMinutes * 60_000,
  ).toISOString();
  const { data } = await supabase
    .from('content_items')
    .select('id, metadata, created_at')
    .like('title', '[MCP-EVAL]%')
    .lt('created_at', cutoffIso);

  if (!data || data.length === 0) return 0;
  const staleItems = (
    data as Array<{ id: string; metadata: unknown; created_at: string | null }>
  ).filter((item) => !isMcpEvalSeedMetadata(item.metadata));

  for (const item of staleItems) {
    await deleteEvalItem(supabase, item.id);
  }
  return staleItems.length;
}

// ---------------------------------------------------------------------------
// Minimal valid arguments per tool
// ---------------------------------------------------------------------------

/**
 * Returns minimal valid arguments for a tool call.
 * Uses known UUIDs for tools that require them.
 * Eval item ID is used for write tools.
 */
export function getMinimalArgs(
  toolName: string,
  knownUUIDs: KnownUUIDs,
  evalItemId: string,
): Record<string, unknown> {
  switch (toolName) {
    // Read tools — no args or minimal args
    // ID-71.7 — consolidated find/answer entry (search + QA + chunk + similar).
    case 'find':
      return { query: 'test' };
    case 'whats_in_my_queue':
      // ID-71.9 — faceted queue; no args = all facets.
      return {};
    case 'list_active_procurement':
      return {};
    case 'get':
      // ID-71.10 one-or-many: single `id` exercises the verbatim/two-step path.
      return { id: knownUUIDs.contentItemId };
    case 'get_reorientation':
      return {};
    case 'get_procurement_detail':
      return {
        id: knownUUIDs.procurementId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'get_form_question':
      return {
        question_id:
          knownUUIDs.questionId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'where_are_we_exposed':
      // ID-71.8 — five-layer exposure consolidation; no args = whole-KB view.
      return {};
    case 'get_entity_relationships':
      return { entity_type: 'certification' };
    case 'get_content_effectiveness':
      return { content_item_id: knownUUIDs.contentItemId };
    case 'find_duplicates':
      // ID-71.10 part 2 — single-item admin dedup, requires `id`. The
      // `scope: 'all'` whole-KB batch scan branch was retired under
      // ID-131.15 (G-DEDUP legacy dedup-family retirement, S446) — the
      // find_duplicate_pairs RPC it depended on was dropped.
      return { id: knownUUIDs.contentItemId };
    case 'show_coverage_matrix':
      return {};
    case 'show_procurement_dashboard':
      return {};
    case 'show_reorient_me':
      return {};
    case 'show_intelligence_feed':
      return {
        workspace_id:
          knownUUIDs.procurementId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'get_intelligence_summary':
      return {
        workspace_id:
          knownUUIDs.procurementId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'list_templates':
      return {};
    case 'get_template_coverage':
      return { template_name: 'Standard Selection Questionnaire' };
    case 'get_template_gaps':
      return { template_name: 'Standard Selection Questionnaire' };
    case 'get_document_versions':
      return {};

    // Guide read tools
    case 'list_guides':
      return {};
    case 'get_guide':
      return { slug: 'test-guide' };

    // Write tools — use eval item
    case 'classify_content':
      return { item_id: evalItemId, force: true };
    case 'generate_summary':
      return { item_id: evalItemId, force: true };
    case 'create_content_item':
      return {
        title: '[MCP-EVAL] Created by protocol test',
        content: 'Protocol compliance test content',
        content_type: 'note',
        governance_review_status: 'draft',
      };
    case 'cite_content':
      // Use eval item + a fake form response UUID — will return a structured error
      return {
        content_item_id: evalItemId,
        form_response_id: '00000000-0000-0000-0000-000000000000',
      };
    case 'update_content_item':
      // `notes` was dropped in ID-64.13 (migration 20260612102255); use a
      // surviving allowed field so the protocol fixture stays a real update.
      return {
        id: evalItemId,
        fields: { priority: 'medium' },
      };
    case 'delete_content_item':
      // Will be tested separately with a dedicated item
      return {
        id: evalItemId,
        mode: 'archive',
        reason: '[MCP-EVAL] Protocol compliance test',
      };
    case 'update_governance_status':
      return { item_ids: [evalItemId], status: 'draft' };
    case 'assign':
      // ID-71.10 one-or-many: explicit `item_ids` exercises the direct path.
      return {
        item_ids: [evalItemId],
        owner_id: '00000000-0000-0000-0000-000000000000',
      };

    // Guide write tools
    case 'create_guide':
      return {
        name: '[MCP-EVAL] Protocol test guide',
        slug: 'mcp-eval-protocol-test',
        guide_type: 'custom',
      };
    case 'update_guide':
      return {
        id: '00000000-0000-0000-0000-000000000000',
        fields: { description: '[MCP-EVAL] Protocol compliance test' },
      };

    // Intelligence write tools
    case 'trigger_intelligence_poll':
      return {};

    // S180 P0-23 review + governance write tools. The review-verdict tool
    // requires an item currently in `pending` state — the eval item typically
    // is not, so Layer 1 will exercise the precondition error path rather
    // than a successful update. This is the intended eval behaviour for
    // protocol compliance (the tool still has to return a valid structured
    // response, just with `isError: true`).
    case 'review_governance_item':
      return { item_id: evalItemId, action: 'approve' };
    case 'create_review_assignment':
      // Use a deterministic v4-compliant UUID for reviewer_id (Zod enforces
      // RFC 4122). The reviewer does not need to exist — the FK will fail
      // gracefully and the tool returns isError with a structured message,
      // which is what Layer 1 protocol compliance is checking for. Avoids
      // creating an eval orphan row that needs cleanup.
      return {
        reviewer_id: '11111111-1111-4111-8111-111111111111',
        filter_domains: [],
        filter_content_types: [],
        filter_freshness: [],
      };

    // S180 P1-35 change-report read tool
    case 'get_change_report':
      return { period_days: 7 };

    // S186 WP-B.4 supersession write tool. Both IDs point at the eval
    // item so the tool's SAME_ID guard fires — the test exercises the
    // validation path without mutating production data. Layer 1 checks
    // that the tool returns a valid structured response; isError=true is
    // the intended outcome here.
    case 'supersede_content_item':
      return { old_id: evalItemId, new_id: evalItemId };

    default:
      return {};
  }
}
