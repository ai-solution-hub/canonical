/**
 * MCP Evaluation Fixtures — constants, auth, and test data helpers.
 *
 * Provides:
 *   - Canonical lists of tool names, resource URIs, and prompt names
 *   - Env loading and Supabase auth helpers
 *   - Eval content item lifecycle (create at suite start, delete at end)
 *   - Known UUID lookup from the live database
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Env loading (reuses project pattern)
// ---------------------------------------------------------------------------

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — that's fine
  }
}

function findProjectRoot(): string {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const candidates = new Set<string>();
  let dir = resolve(scriptDir, '..');
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const root of candidates) {
    if (
      existsSync(resolve(root, '.env')) ||
      existsSync(resolve(root, '.env.local'))
    ) {
      return root;
    }
  }
  return resolve(scriptDir, '../..');
}

export function loadEnv(): void {
  const root = findProjectRoot();
  loadEnvFile(resolve(root, '.env.local'));
  loadEnvFile(resolve(root, '.env'));
}

// ---------------------------------------------------------------------------
// Canonical lists — updated to 58 tools (S217 W1B adds find_duplicate_candidates)
// ---------------------------------------------------------------------------

/** Canonical set of all 58 MCP tool names. Compared as a set (not an ordered list) by `mcp-fixture-sync.test.ts`. */
export const CANONICAL_TOOL_NAMES = [
  'search_knowledge_base', // 1
  'search_qa_library', // 2
  'find_similar_items', // 3
  'get_dashboard_summary', // 4
  'get_reorientation', // 5
  'get_freshness_report', // 6
  'get_expiring_content', // 7
  'list_active_bids', // 8
  'get_bid_detail', // 9
  'get_bid_question', // 10
  'cite_content', // 11
  'get_content_effectiveness', // 12
  'get_content_item', // 13
  'create_content_item', // 14
  'update_content_item', // 15
  'get_content_items', // 16
  'get_workspace_items', // 17
  'assign_content_owner', // 18
  'bulk_assign_owner', // 19
  'get_document_versions', // 20
  'get_document_diff', // 21
  'get_quality_summary', // 22
  'get_coverage_gaps', // 23
  'audit_content', // 24
  'find_all_duplicates', // 25
  'suggest_content_creation', // 26
  'get_quality_briefing', // 27
  'get_quality_actions', // 28
  'classify_content', // 29
  'generate_summary', // 30
  'get_entity_relationships', // 31
  'get_certification_status', // 32
  'list_templates', // 33
  'get_template_coverage', // 34
  'get_template_gaps', // 35
  'show_coverage_matrix', // 36
  'show_bid_dashboard', // 37
  'show_reorient_me', // 38
  'show_intelligence_feed', // 39
  'delete_content_item', // 40
  'update_governance_status', // 41
  'get_intelligence_summary', // 42
  'search_content_chunks', // 43
  'list_guides', // 44
  'get_guide', // 45
  'create_guide', // 46
  'update_guide', // 47
  'trigger_intelligence_poll', // 48
  // S180 P0-23 — review + governance additions (5 new tools, 47 → 52).
  'get_governance_queue', // 49
  'review_governance_item', // 50
  'get_review_queue', // 51
  'get_assignments_for_user', // 52
  'create_review_assignment', // 53
  // S180 P1-35 — change-report tool (WP6, 52 → 53).
  'get_change_report', // 54
  // S186 WP-B.4 — supersession model (53 → 54).
  'supersede_content_item', // 55
  // S194 UI-simp WP4.2 — P1-34 workspace resolution helper (55 → 56).
  'list_user_workspaces', // 56
  // S202 §5.2 Phase 2 / T7 — publication-lifecycle MCP surface (56 → 57).
  'update_publication_status', // 57
  // S217 W1B — split LLM-discovery surface from admin dedup surface (57 → 58).
  // Authority: archived `.specs/publication-lifecycle-state-machine-spec.md` §5.3.2.
  'find_duplicate_candidates', // 58
] as const;

export const TOOL_COUNT = CANONICAL_TOOL_NAMES.length; // 58

/** Read-only tools (no side effects). */
export const READ_ONLY_TOOLS = new Set([
  'search_knowledge_base',
  'search_qa_library',
  'find_similar_items',
  'find_duplicate_candidates',
  'search_content_chunks',
  'get_dashboard_summary',
  'get_reorientation',
  'get_freshness_report',
  'get_expiring_content',
  'list_active_bids',
  'get_bid_detail',
  'get_bid_question',
  'get_content_effectiveness',
  'get_content_item',
  'get_content_items',
  'get_workspace_items',
  'get_quality_summary',
  'get_coverage_gaps',
  'audit_content',
  'find_all_duplicates',
  'suggest_content_creation',
  'get_quality_briefing',
  'get_quality_actions',
  'get_entity_relationships',
  'get_certification_status',
  'list_templates',
  'get_template_coverage',
  'get_template_gaps',
  'show_coverage_matrix',
  'show_bid_dashboard',
  'show_reorient_me',
  'show_intelligence_feed',
  'get_document_versions',
  'get_document_diff',
  'get_intelligence_summary',
  'get_guide',
  'list_guides',
  // S180 P0-23
  'get_governance_queue',
  'get_review_queue',
  'get_assignments_for_user',
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
  'assign_content_owner', // 31
  'bulk_assign_owner', // 32
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
  'bid_briefing',
  'coverage_analysis',
  'draft_response',
  'review_item',
  'sector_briefing',
  'bid_pipeline_review',
] as const;

export const PROMPT_COUNT = CANONICAL_PROMPT_NAMES.length; // 7

/** Resource template URIs (3 templates). */
export const RESOURCE_TEMPLATE_URIS = [
  'kb://items/{id}',
  'kb://bids/{id}',
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
  'ui://bid-dashboard/app.html',
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

  const supabase = createClient(url, anonKey);
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
  bidId: string | null;
  questionId: string | null;
  bidResponseId: string | null;
}

export async function getKnownUUIDs(
  supabase: SupabaseClient,
): Promise<KnownUUIDs> {
  // Get a known content item (preferably a Q&A pair with embedding)
  const { data: contentItem } = await supabase
    .from('content_items')
    .select('id')
    .eq('content_type', 'q_a_pair')
    .not('embedding', 'is', null)
    .is('archived_at', null)
    .limit(1)
    .single();

  if (!contentItem) {
    // Graceful exit-0 on data-empty Supabase branches (e.g. fresh staging
    // persistent branch before fixture seeding). CI surfaces the skip in
    // logs without failing the workflow. Roadmap §9.16.9 tracks fixture
    // seeding so MCP eval can run end-to-end on staging.
    console.warn(
      '\n[MCP eval skipped] no Q&A content_items with embeddings in database.\n' +
        '  Cause: data-empty Supabase branch (typical for fresh staging branches).\n' +
        '  Action: seed minimum eval fixtures (roadmap §9.16.10 — staging eval seed).\n',
    );
    process.exit(0);
  }

  // Get a known bid workspace
  const { data: bid } = await supabase
    .from('workspaces')
    .select('id')
    .eq('type', 'bid')
    .eq('is_archived', false)
    .limit(1)
    .single();

  // Get a known bid question (if bid exists)
  let questionId: string | null = null;
  if (bid) {
    const { data: question } = await supabase
      .from('bid_questions')
      .select('id')
      .eq('project_id', bid.id)
      .limit(1)
      .single();
    questionId = question?.id ?? null;
  }

  let bidResponseId: string | null = null;
  if (questionId) {
    const { data: response } = await supabase
      .from('bid_responses')
      .select('id')
      .eq('question_id', questionId)
      .limit(1)
      .single();
    bidResponseId = response?.id ?? null;
  }

  return {
    contentItemId: contentItem.id,
    bidId: bid?.id ?? null,
    questionId,
    bidResponseId,
  };
}

// ---------------------------------------------------------------------------
// Eval content item lifecycle
// ---------------------------------------------------------------------------

const EVAL_TITLE = '[MCP-EVAL] Protocol compliance test item';
const EVAL_CONTENT =
  'This is a temporary item created by the MCP evaluation harness. It tests write tool functionality and will be deleted at the end of the test run.';

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
  await supabase.from('content_citations').delete().eq('content_item_id', id);
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
  const { data } = await supabase
    .from('content_items')
    .select('id')
    .like('title', '[MCP-EVAL]%');

  if (!data || data.length === 0) return 0;

  for (const item of data) {
    await deleteEvalItem(supabase, item.id);
  }

  return data.length;
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
    case 'search_knowledge_base':
      return { query: 'test' };
    case 'get_dashboard_summary':
      return {};
    case 'list_active_bids':
      return {};
    case 'get_content_item':
      return { id: knownUUIDs.contentItemId };
    case 'get_reorientation':
      return {};
    case 'get_bid_detail':
      return { id: knownUUIDs.bidId ?? '00000000-0000-0000-0000-000000000000' };
    case 'get_bid_question':
      return {
        question_id:
          knownUUIDs.questionId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'get_quality_summary':
      return {};
    case 'get_freshness_report':
      return {};
    case 'search_qa_library':
      return { query: 'test' };
    case 'search_content_chunks':
      return { query: 'test' };
    case 'get_entity_relationships':
      return { entity_type: 'certification' };
    case 'get_content_effectiveness':
      return { content_item_id: knownUUIDs.contentItemId };
    case 'get_coverage_gaps':
      return {};
    case 'audit_content':
      return {};
    case 'find_similar_items':
      return { id: knownUUIDs.contentItemId };
    case 'find_duplicate_candidates':
      return { id: knownUUIDs.contentItemId };
    case 'get_content_items':
      return { ids: [knownUUIDs.contentItemId] };
    case 'get_workspace_items':
      return {
        workspace_id:
          knownUUIDs.bidId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'show_coverage_matrix':
      return {};
    case 'show_bid_dashboard':
      return {};
    case 'show_reorient_me':
      return {};
    case 'show_intelligence_feed':
      return {
        workspace_id:
          knownUUIDs.bidId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'get_intelligence_summary':
      return {
        workspace_id:
          knownUUIDs.bidId ?? '00000000-0000-0000-0000-000000000000',
      };
    case 'find_all_duplicates':
      return {};
    case 'list_templates':
      return {};
    case 'get_template_coverage':
      return { template_name: 'Standard Selection Questionnaire' };
    case 'get_template_gaps':
      return { template_name: 'Standard Selection Questionnaire' };
    case 'get_expiring_content':
      return {};
    case 'get_quality_briefing':
      return {};
    case 'get_quality_actions':
      return {};
    case 'get_document_versions':
      return {};
    case 'get_document_diff':
      return {};
    case 'get_certification_status':
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
      // Use eval item + a fake bid response UUID — will return a structured error
      return {
        content_item_id: evalItemId,
        bid_response_id: '00000000-0000-0000-0000-000000000000',
      };
    case 'update_content_item':
      return {
        id: evalItemId,
        fields: { notes: '[MCP-EVAL] Protocol compliance test' },
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
    case 'assign_content_owner':
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

    // S180 P0-23 review + governance read tools
    case 'get_governance_queue':
      return { limit: 20, offset: 0 };
    case 'get_review_queue':
      return { status: 'unverified', limit: 20, offset: 0 };
    case 'get_assignments_for_user':
      return { status: 'active' };

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
