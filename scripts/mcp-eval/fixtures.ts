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
    if (existsSync(resolve(root, '.env')) || existsSync(resolve(root, '.env.local'))) {
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
// Canonical lists — updated to 35 tools (current as of S104)
// ---------------------------------------------------------------------------

/** All 35 MCP tool names in registration order. */
export const CANONICAL_TOOL_NAMES = [
  'search_knowledge_base',        // 1
  'get_dashboard_summary',        // 2
  'list_active_bids',             // 3
  'get_content_item',             // 4
  'get_reorientation',            // 5
  'get_bid_detail',               // 6
  'get_bid_question',             // 7
  'get_quality_summary',          // 8
  'get_freshness_report',         // 9
  'classify_content',             // 10
  'generate_summary',             // 11
  'create_content_item',          // 12
  'search_qa_library',            // 13
  'get_entity_relationships',     // 14
  'cite_content',                 // 15
  'get_content_effectiveness',    // 16
  'get_coverage_gaps',            // 17
  'audit_content',                // 18
  'update_content_item',          // 19
  'find_similar_items',           // 20
  'get_content_items',            // 21
  'show_coverage_matrix',         // 22
  'show_bid_dashboard',           // 23
  'show_reorient_me',             // 24
  'delete_content_item',          // 25
  'find_all_duplicates',          // 26
  'list_templates',               // 27
  'get_template_coverage',        // 28
  'get_template_gaps',            // 29
  'update_governance_status',     // 30
  'assign_content_owner',         // 31
  'get_document_versions',        // 32
  'suggest_content_creation',     // 33
  'get_certification_status',     // 34
  'get_document_diff',            // 35
] as const;

export const TOOL_COUNT = CANONICAL_TOOL_NAMES.length; // 35

/** Read-only tools (no side effects). */
export const READ_ONLY_TOOLS = new Set([
  'search_knowledge_base',
  'get_dashboard_summary',
  'list_active_bids',
  'get_content_item',
  'get_reorientation',
  'get_bid_detail',
  'get_bid_question',
  'get_quality_summary',
  'get_freshness_report',
  'search_qa_library',
  'get_entity_relationships',
  'get_content_effectiveness',
  'get_coverage_gaps',
  'audit_content',
  'find_similar_items',
  'get_content_items',
  'show_coverage_matrix',
  'show_bid_dashboard',
  'show_reorient_me',
  'find_all_duplicates',
  'list_templates',
  'get_template_coverage',
  'get_template_gaps',
  'get_document_versions',
  'suggest_content_creation',
  'get_certification_status',
  'get_document_diff',
]);

/** Write tools that modify data. */
export const WRITE_TOOLS = new Set([
  'classify_content',        // 10
  'generate_summary',        // 11
  'create_content_item',     // 12
  'cite_content',            // 15
  'update_content_item',     // 19
  'delete_content_item',     // 25
  'update_governance_status', // 30
  'assign_content_owner',    // 31
]);

/**
 * Tools that call the Claude API (classification/summarisation) — skip with --skip-ai.
 * Embedding-only tools (search, create draft) are NOT skipped: they use OpenAI
 * embeddings which are fast and cheap (<$0.001 per call).
 */
export const AI_TOOLS = new Set([
  'classify_content',        // calls Claude API
  'generate_summary',        // calls Claude API
]);

/** All 5 prompt names. */
export const CANONICAL_PROMPT_NAMES = [
  'reorient',
  'bid_briefing',
  'coverage_analysis',
  'draft_response',
  'review_item',
] as const;

export const PROMPT_COUNT = CANONICAL_PROMPT_NAMES.length; // 5

/** Resource template URIs (3 templates). */
export const RESOURCE_TEMPLATE_URIS = [
  'kb://items/{id}',
  'kb://bids/{id}',
  'kb://qa/{id}',
] as const;

/** Static resource URIs (7 static + 3 app). */
export const STATIC_RESOURCE_URIS = [
  'kb://coverage',
  'kb://dashboard',
  'kb://taxonomy',
  'kb://entities',
  'ui://coverage-matrix/app.html',
  'ui://bid-dashboard/app.html',
  'ui://reorient-me/app.html',
] as const;

// ---------------------------------------------------------------------------
// Auth helper — sign in as test user, return access token
// ---------------------------------------------------------------------------

export async function getAuthToken(): Promise<{
  accessToken: string;
  supabase: SupabaseClient;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.TEST_USER_1_EMAIL;
  const password = process.env.TEST_USER_1_PASSWORD;

  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  if (!email || !password) {
    throw new Error(
      'Missing TEST_USER_1_EMAIL or TEST_USER_1_PASSWORD. ' +
      'Set these in .env to an admin test user.',
    );
  }

  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

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

export async function getKnownUUIDs(supabase: SupabaseClient): Promise<KnownUUIDs> {
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
    throw new Error('No content items found in database for eval fixtures');
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
const EVAL_CONTENT = 'This is a temporary item created by the MCP evaluation harness. It tests write tool functionality and will be deleted at the end of the test run.';

export interface EvalItem {
  id: string;
  title: string;
}

/**
 * Creates a dedicated eval content item via the Supabase client (not MCP).
 * This ensures the item exists before testing MCP write tools against it.
 */
export async function createEvalItem(supabase: SupabaseClient): Promise<EvalItem> {
  // Clean up any leftover eval items from previous runs
  await supabase
    .from('content_items')
    .delete()
    .like('title', '[MCP-EVAL]%');

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
    throw new Error(`Failed to create eval item: ${error?.message ?? 'Unknown error'}`);
  }

  return { id: data.id, title: data.title ?? EVAL_TITLE };
}

/**
 * Deletes the eval content item and any related data.
 */
export async function deleteEvalItem(supabase: SupabaseClient, id: string): Promise<void> {
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
export async function cleanupStaleEvalItems(supabase: SupabaseClient): Promise<number> {
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
      return { question_id: knownUUIDs.questionId ?? '00000000-0000-0000-0000-000000000000' };
    case 'get_quality_summary':
      return {};
    case 'get_freshness_report':
      return {};
    case 'search_qa_library':
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
    case 'get_content_items':
      return { ids: [knownUUIDs.contentItemId] };
    case 'show_coverage_matrix':
      return {};
    case 'show_bid_dashboard':
      return {};
    case 'show_reorient_me':
      return {};
    case 'find_all_duplicates':
      return {};
    case 'list_templates':
      return {};
    case 'get_template_coverage':
      return { template_name: 'Standard Selection Questionnaire' };
    case 'get_template_gaps':
      return { template_name: 'Standard Selection Questionnaire' };

    // Write tools — use eval item
    case 'classify_content':
      return { item_id: evalItemId, force: true };
    case 'generate_summary':
      return { item_id: evalItemId, force: true };
    case 'create_content_item':
      return { title: '[MCP-EVAL] Created by protocol test', content: 'Protocol compliance test content', content_type: 'note', governance_review_status: 'draft' };
    case 'cite_content':
      // Use eval item + a fake bid response UUID — will return a structured error
      return { content_item_id: evalItemId, bid_response_id: '00000000-0000-0000-0000-000000000000' };
    case 'update_content_item':
      return { id: evalItemId, fields: { notes: '[MCP-EVAL] Protocol compliance test' } };
    case 'delete_content_item':
      // Will be tested separately with a dedicated item
      return { id: evalItemId, mode: 'archive', reason: '[MCP-EVAL] Protocol compliance test' };
    case 'update_governance_status':
      return { item_ids: [evalItemId], status: 'draft' };

    default:
      return {};
  }
}
