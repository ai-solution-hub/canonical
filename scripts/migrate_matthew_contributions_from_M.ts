#!/usr/bin/env bun
/**
 * Migrate Matthew Allen's contributions from Supabase project 'M'
 * (mgrmucazfiibsomdmndh, retiring) to project 'r' (rovrymhhffssilaftdwd,
 * production).
 *
 * Matthew is the only active user. His work on 'M' between Vercel-flip
 * and env-flip = all real user data that needs migrating.
 *
 * DEFAULT MODE IS DRY-RUN. Pass --live-apply to actually write to 'r'.
 *
 * Expected volumes on 'M':
 *   - 7 creates: content_items where created_by = Matthew (q_a_pair,
 *     created 09:48-09:50 BST 22/04).
 *   - 12 updates: content_items where updated_by = Matthew AND
 *     created_by != Matthew (edits to pre-existing items).
 *   - 14 history rows: content_history entries by Matthew.
 *
 * Env vars required:
 *   - SUPABASE_M_URL + SUPABASE_M_SECRET_KEY: credentials for project 'M'
 *     (read-only access). These must be set manually as separate env vars.
 *   - NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY: credentials for
 *     project 'r' (production, write access).
 *
 * Sandbox note: this script writes to Supabase. Per the Bun fetch 204
 * gotcha (CLAUDE.md §Supabase), invoke with `dangerouslyDisableSandbox:
 * true` from the Claude Code sandbox.
 *
 * Usage:
 *   bun run scripts/migrate_matthew_contributions_from_M.ts            # dry-run
 *   bun run scripts/migrate_matthew_contributions_from_M.ts --dry-run  # explicit
 *   bun run scripts/migrate_matthew_contributions_from_M.ts --live-apply
 *   bun run scripts/migrate_matthew_contributions_from_M.ts --help
 *
 * @vitest-environment node
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// ── Constants (exported for tests) ──────────────────────────────────────

/** Matthew Allen's user UUID — same on both 'M' and 'r' */
export const MATTHEW_USER_ID = 'd2c4e9a7-0a1c-4bfd-8c1a-11c18f8f222e';

/** Production project ID — the only project this script writes to */
export const PRODUCTION_PROJECT_ID = 'rovrymhhffssilaftdwd';

/** Retiring project ID — read-only source */
export const RETIRING_PROJECT_ID = 'mgrmucazfiibsomdmndh';

/**
 * Columns selected from content_items on 'M' for creates.
 * Covers all user-visible and classification fields that need migrating.
 */
export const CONTENT_ITEM_SELECT_COLUMNS = [
  'id',
  'title',
  'content',
  'content_type',
  'source_url',
  'source_domain',
  'platform',
  'author_name',
  'primary_domain',
  'primary_subtopic',
  'secondary_domain',
  'secondary_subtopic',
  'classification_confidence',
  'classification_reasoning',
  'classified_at',
  'classification_model',
  'ai_keywords',
  'summary',
  'summary_data',
  'user_tags',
  'priority',
  'brief',
  'detail',
  'reference',
  'answer_standard',
  'answer_advanced',
  'source_document',
  'source_document_id',
  'source_file',
  'layer',
  'content_text_hash',
  'freshness',
  'lifecycle_type',
  'metadata',
  'notes',
  'embedding',
  'embedding_model',
  'embedding_tokens',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'superseded_by',
  'dedup_status',
] as const;

/**
 * Columns selected from content_items on 'M' for update candidates.
 * Same as creates but includes content_text_hash for matching against 'r'.
 */
export const UPDATE_CANDIDATE_SELECT = CONTENT_ITEM_SELECT_COLUMNS;

/**
 * Columns selected from content_history on 'M'.
 */
export const HISTORY_SELECT_COLUMNS = [
  'id',
  'content_item_id',
  'version',
  'title',
  'content',
  'brief',
  'detail',
  'reference',
  'change_type',
  'change_summary',
  'change_reason',
  'metadata',
  'created_by',
  'created_at',
] as const;

// ── Types (exported for tests) ──────────────────────────────────────────

/** A content_items row from 'M' (for creates) */
export interface MContentItem {
  id: string;
  title: string;
  content: string;
  content_type: string;
  source_url: string | null;
  source_domain: string | null;
  platform: string | null;
  author_name: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  classification_confidence: number | null;
  classification_reasoning: string | null;
  classified_at: string | null;
  classification_model: string | null;
  ai_keywords: string[] | null;
  summary: string | null;
  summary_data: Record<string, unknown> | null;
  user_tags: string[] | null;
  priority: string | null;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  answer_standard: string | null;
  answer_advanced: string | null;
  source_document: string | null;
  source_document_id: string | null;
  source_file: string | null;
  layer: string | null;
  content_text_hash: string | null;
  freshness: string | null;
  lifecycle_type: string | null;
  metadata: Record<string, unknown> | null;
  notes: string | null;
  embedding: string | null;
  embedding_model: string | null;
  embedding_tokens: number | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  superseded_by: string | null;
  dedup_status: string;
}

/** A content_history row from 'M' */
export interface MHistoryRow {
  id: string;
  content_item_id: string | null;
  version: number;
  title: string;
  content: string;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  change_type: string;
  change_summary: string | null;
  change_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

/** A workspace association row */
export interface WorkspaceAssociation {
  content_item_id: string;
  workspace_id: string;
}

/** Summary output for dry-run */
export interface MigrationReport {
  creates: { count: number; items: Array<{ id: string; title: string; created_at: string }> };
  updates: { count: number; items: Array<{ id: string; title: string; matchStatus: string }> };
  history: { count: number; items: Array<{ id: string; content_item_id: string | null; change_type: string }> };
  workspaceAssociations: { count: number; items: Array<{ content_item_id: string; workspace_id: string }> };
}

/** Result from findMatchOnR when multiple matches exist */
export interface FindMatchResult {
  status: 'none' | 'unique' | 'ambiguous';
  match?: { id: string; content_text_hash: string | null };
  candidates?: Array<{ id: string; content_text_hash: string | null }>;
}

// ── Env loading (handles worktrees) ─────────────────────────────────────

function loadEnv() {
  let dir = process.cwd();
  while (dir !== '/') {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) break;
    dir = path.dirname(dir);
  }
}

// ── Args (exported for tests) ───────────────────────────────────────────

export interface CliArgs {
  dryRun: boolean;
  liveApply: boolean;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      'live-apply': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const dryRun = values['dry-run']!;
  const liveApply = values['live-apply']!;

  if (dryRun && liveApply) {
    throw new Error('Cannot specify both --dry-run and --live-apply');
  }

  // Default is dry-run when neither flag is given
  return {
    dryRun: !liveApply,
    liveApply,
    help: values.help!,
  };
}

// ── Validation (exported for tests) ─────────────────────────────────────

export function validateEnvM(url: string | undefined, key: string | undefined): void {
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_M_URL or SUPABASE_M_SECRET_KEY. ' +
      'These must be set to access the retiring project (M = mgrmucazfiibsomdmndh).',
    );
  }
  if (!url.includes(RETIRING_PROJECT_ID)) {
    throw new Error(
      `SUPABASE_M_URL does not contain retiring project ID ${RETIRING_PROJECT_ID}. ` +
      'Verify the URL points to the correct retiring project.',
    );
  }
}

export function validateEnvR(url: string | undefined, key: string | undefined): void {
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY. ' +
      'These must be set to access the production project (r = rovrymhhffssilaftdwd).',
    );
  }
  if (!url.includes(PRODUCTION_PROJECT_ID)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL does not contain production project ID ${PRODUCTION_PROJECT_ID}. ` +
      'Verify the URL points to the correct production project.',
    );
  }
}

// ── Query helpers (exported for tests) ──────────────────────────────────

/**
 * Query 'M' for Matthew's created content items (created_by = Matthew).
 */
export async function queryCreates(clientM: SupabaseClient): Promise<MContentItem[]> {
  const { data, error } = await clientM
    .from('content_items')
    .select(CONTENT_ITEM_SELECT_COLUMNS.join(', '))
    .eq('created_by', MATTHEW_USER_ID)
    .is('archived_at', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Query creates on M failed: ${error.message}`);
  return (data ?? []) as unknown as MContentItem[];
}

/**
 * Query 'M' for content items updated by Matthew (but not created by him).
 */
export async function queryUpdates(clientM: SupabaseClient): Promise<MContentItem[]> {
  const { data, error } = await clientM
    .from('content_items')
    .select(UPDATE_CANDIDATE_SELECT.join(', '))
    .eq('updated_by', MATTHEW_USER_ID)
    .neq('created_by', MATTHEW_USER_ID)
    .is('archived_at', null)
    .order('updated_at', { ascending: true });

  if (error) throw new Error(`Query updates on M failed: ${error.message}`);
  return (data ?? []) as unknown as MContentItem[];
}

/**
 * Query 'M' for Matthew's content_history rows.
 */
export async function queryHistory(clientM: SupabaseClient): Promise<MHistoryRow[]> {
  const { data, error } = await clientM
    .from('content_history')
    .select(HISTORY_SELECT_COLUMNS.join(', '))
    .eq('created_by', MATTHEW_USER_ID)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Query history on M failed: ${error.message}`);
  return (data ?? []) as unknown as MHistoryRow[];
}

/**
 * Query 'M' for workspace associations of given content item IDs.
 */
export async function queryWorkspaceAssociations(
  clientM: SupabaseClient,
  contentItemIds: string[],
): Promise<Array<{ content_item_id: string; workspace_id: string }>> {
  if (contentItemIds.length === 0) return [];
  const { data, error } = await clientM
    .from('content_item_workspaces')
    .select('content_item_id, workspace_id')
    .in('content_item_id', contentItemIds);

  if (error) throw new Error(`Query workspace associations on M failed: ${error.message}`);
  return (data ?? []) as unknown as Array<{ content_item_id: string; workspace_id: string }>;
}

/**
 * Check if a content item already exists on 'r' with the same title +
 * content_text_hash + created_by. Used for idempotency on creates.
 *
 * When contentTextHash is null, matches on title+created_by only and
 * emits a warning (M-2: weaker idempotency signal).
 */
export async function checkExistsOnR(
  clientR: SupabaseClient,
  title: string,
  contentTextHash: string | null,
  createdBy: string,
  /** Original M item ID, used for warning context */
  mItemId?: string,
): Promise<boolean> {
  let query = clientR
    .from('content_items')
    .select('id')
    .eq('title', title)
    .eq('created_by', createdBy);

  if (contentTextHash) {
    query = query.eq('content_text_hash', contentTextHash);
  }

  const { data, error } = await query.limit(1);
  if (error) throw new Error(`Idempotency check on R failed: ${error.message}`);

  const exists = (data?.length ?? 0) > 0;

  if (exists && !contentTextHash) {
    console.warn(
      `WARN: skipping create for M:${mItemId ?? 'unknown'} based on title+created_by only ` +
      `(null content_text_hash); verify manually before live-apply if concerned`,
    );
  }

  return exists;
}

/**
 * Find a matching content item on 'r' for an update candidate from 'M'.
 * Matches by title (content_text_hash may differ if Matthew changed content).
 *
 * Returns a discriminated result:
 *   - 'none': no match found
 *   - 'unique': exactly one match (safe to update)
 *   - 'ambiguous': 2+ matches with same title (skip, require manual resolution)
 */
export async function findMatchOnR(
  clientR: SupabaseClient,
  title: string,
): Promise<FindMatchResult> {
  const { data, error } = await clientR
    .from('content_items')
    .select('id, content_text_hash')
    .eq('title', title)
    .is('archived_at', null);

  if (error) throw new Error(`Match lookup on R failed: ${error.message}`);
  if (!data || data.length === 0) return { status: 'none' };
  if (data.length === 1) {
    return {
      status: 'unique',
      match: data[0] as { id: string; content_text_hash: string | null },
    };
  }
  // 2+ matches — ambiguous, do not pick arbitrarily
  return {
    status: 'ambiguous',
    candidates: data as Array<{ id: string; content_text_hash: string | null }>,
  };
}

/**
 * Check if a content_history row already exists on 'r' matching the
 * given content_item_id + version + created_by. For idempotency.
 */
export async function checkHistoryExistsOnR(
  clientR: SupabaseClient,
  contentItemId: string,
  version: number,
  createdBy: string,
): Promise<boolean> {
  const { data, error } = await clientR
    .from('content_history')
    .select('id')
    .eq('content_item_id', contentItemId)
    .eq('version', version)
    .eq('created_by', createdBy)
    .limit(1);

  if (error) throw new Error(`History idempotency check on R failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Check if a workspace exists on 'r' by UUID.
 */
export async function checkWorkspaceExistsOnR(
  clientR: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await clientR
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .limit(1);

  if (error) throw new Error(`Workspace existence check on R failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Check if a workspace association already exists on 'r'.
 * Used for idempotency on workspace association inserts.
 */
export async function checkWorkspaceAssocExistsOnR(
  clientR: SupabaseClient,
  contentItemId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await clientR
    .from('content_item_workspaces')
    .select('content_item_id')
    .eq('content_item_id', contentItemId)
    .eq('workspace_id', workspaceId)
    .limit(1);

  if (error) throw new Error(`Workspace association check on R failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Build the INSERT payload for a content_items create.
 * Preserves all fields from 'M' including created_by and created_at.
 */
export function buildCreatePayload(item: MContentItem): Record<string, unknown> {
  return {
    title: item.title,
    content: item.content,
    content_type: item.content_type,
    source_url: item.source_url,
    source_domain: item.source_domain,
    platform: item.platform,
    author_name: item.author_name,
    primary_domain: item.primary_domain,
    primary_subtopic: item.primary_subtopic,
    secondary_domain: item.secondary_domain,
    secondary_subtopic: item.secondary_subtopic,
    classification_confidence: item.classification_confidence,
    classification_reasoning: item.classification_reasoning,
    classified_at: item.classified_at,
    classification_model: item.classification_model,
    ai_keywords: item.ai_keywords,
    summary: item.summary,
    summary_data: item.summary_data,
    user_tags: item.user_tags,
    priority: item.priority,
    brief: item.brief,
    detail: item.detail,
    reference: item.reference,
    answer_standard: item.answer_standard,
    answer_advanced: item.answer_advanced,
    source_document: item.source_document,
    source_document_id: item.source_document_id,
    source_file: item.source_file,
    layer: item.layer,
    freshness: item.freshness,
    lifecycle_type: item.lifecycle_type,
    metadata: item.metadata,
    notes: item.notes,
    embedding: item.embedding,
    embedding_model: item.embedding_model,
    embedding_tokens: item.embedding_tokens,
    created_at: item.created_at,
    created_by: item.created_by,
    updated_at: item.updated_at,
    updated_by: item.updated_by,
    superseded_by: item.superseded_by,
    dedup_status: item.dedup_status || 'clean',
  };
}

/**
 * Build the UPDATE payload for an update candidate.
 * Only includes fields that Matthew could have changed via the UI.
 */
export function buildUpdatePayload(item: MContentItem): Record<string, unknown> {
  return {
    title: item.title,
    content: item.content,
    primary_domain: item.primary_domain,
    primary_subtopic: item.primary_subtopic,
    secondary_domain: item.secondary_domain,
    secondary_subtopic: item.secondary_subtopic,
    classification_confidence: item.classification_confidence,
    classification_reasoning: item.classification_reasoning,
    classified_at: item.classified_at,
    ai_keywords: item.ai_keywords,
    summary: item.summary,
    user_tags: item.user_tags,
    priority: item.priority,
    brief: item.brief,
    detail: item.detail,
    reference: item.reference,
    answer_standard: item.answer_standard,
    answer_advanced: item.answer_advanced,
    notes: item.notes,
    updated_at: item.updated_at,
    updated_by: MATTHEW_USER_ID,
  };
}

/**
 * Build the INSERT payload for a content_history row.
 */
export function buildHistoryPayload(row: MHistoryRow): Record<string, unknown> {
  return {
    content_item_id: row.content_item_id,
    version: row.version,
    title: row.title,
    content: row.content,
    brief: row.brief,
    detail: row.detail,
    reference: row.reference,
    change_type: row.change_type,
    change_summary: row.change_summary,
    change_reason: row.change_reason,
    metadata: row.metadata,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

const HELP_TEXT = `
Usage: bun run scripts/migrate_matthew_contributions_from_M.ts [options]

Migrates Matthew Allen's contributions from Supabase project 'M'
(mgrmucazfiibsomdmndh, retiring) to project 'r' (rovrymhhffssilaftdwd,
production).

Options:
  --dry-run      Preview what would be migrated (DEFAULT)
  --live-apply   Actually write changes to 'r'
  --help         Show this help

Env vars required:
  SUPABASE_M_URL           URL of project 'M' (retiring)
  SUPABASE_M_SECRET_KEY    Service key for project 'M'
  NEXT_PUBLIC_SUPABASE_URL URL of project 'r' (production)
  SUPABASE_SECRET_KEY      Service key for project 'r'

Expected volumes: 7 creates + 12 updates + 14 history rows + N workspace assocs.
Idempotent: safe to re-run (skips already-migrated rows).
`;

async function main() {
  loadEnv();

  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // ── Validate env ────────────────────────────────────────────────────

  const mUrl = process.env.SUPABASE_M_URL;
  const mKey = process.env.SUPABASE_M_SECRET_KEY;
  const rUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rKey = process.env.SUPABASE_SECRET_KEY;

  validateEnvM(mUrl, mKey);
  validateEnvR(rUrl, rKey);

  // ── Create clients ──────────────────────────────────────────────────

  const clientM = createClient(mUrl!, mKey!);
  const clientR = createClient(rUrl!, rKey!);

  // ── Print header ────────────────────────────────────────────────────

  console.log('='.repeat(60));
  console.log('Matthew Contributions Migration: M → R');
  console.log('='.repeat(60));
  console.log(`  Mode:       ${args.liveApply ? 'LIVE-APPLY (will write to R)' : 'DRY-RUN (preview only)'}`);
  console.log(`  Source (M): ${RETIRING_PROJECT_ID}`);
  console.log(`  Target (R): ${PRODUCTION_PROJECT_ID}`);
  console.log(`  Matthew ID: ${MATTHEW_USER_ID}`);
  console.log();

  // ── Phase 1: Query 'M' ─────────────────────────────────────────────

  console.log('Phase 1: Querying project M...');
  console.log();

  const creates = await queryCreates(clientM);
  const updates = await queryUpdates(clientM);
  const history = await queryHistory(clientM);

  console.log(`  Creates (created_by = Matthew): ${creates.length}`);
  for (const item of creates) {
    console.log(`    - [${item.created_at}] ${item.title.slice(0, 70)}`);
  }
  console.log();

  console.log(`  Updates (updated_by = Matthew, created_by != Matthew): ${updates.length}`);
  for (const item of updates) {
    console.log(`    - [${item.updated_at}] ${item.title.slice(0, 70)}`);
  }
  console.log();

  console.log(`  History rows (created_by = Matthew): ${history.length}`);
  for (const row of history) {
    console.log(`    - [${row.created_at}] ${row.change_type} on ${row.content_item_id}`);
  }
  console.log();

  // ── UUID mapping: M item IDs → R item IDs (C-1 fix) ────────────────

  /** Maps M content_item UUIDs to R content_item UUIDs.
   *  Populated during creates (new UUID from DB) and updates (matched UUID). */
  const mIdToRId = new Map<string, string>();

  // ── Phase 2: Creates ────────────────────────────────────────────────

  console.log('Phase 2: Creates...');
  let createInserted = 0;
  let createSkipped = 0;
  let createFailed = 0;

  for (const item of creates) {
    const label = `[CREATE] ${item.title.slice(0, 60)}`;

    // Idempotency check (M-2: passes mItemId for null-hash warning)
    const exists = await checkExistsOnR(
      clientR,
      item.title,
      item.content_text_hash,
      MATTHEW_USER_ID,
      item.id,
    );

    if (exists) {
      console.log(`  SKIP (already exists on R): ${label}`);
      createSkipped++;
      continue;
    }

    if (args.liveApply) {
      try {
        const payload = buildCreatePayload(item);
        const { data: inserted, error: insertError } = await clientR
          .from('content_items')
          .insert(payload)
          .select('id');

        if (insertError) {
          console.log(`  FAIL: ${label} — ${insertError.message}`);
          createFailed++;
          continue;
        }

        if (!inserted || inserted.length !== 1) {
          console.log(`  FAIL: ${label} — insert returned ${inserted?.length ?? 0} rows`);
          createFailed++;
          continue;
        }

        // C-1: Record M→R UUID mapping for history phase
        mIdToRId.set(item.id, inserted[0].id);
        console.log(`  PASS: ${label} → ${inserted[0].id}`);
        createInserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  FAIL: ${label} — ${msg}`);
        createFailed++;
      }
    } else {
      // In dry-run, create a synthetic mapping for reporting
      mIdToRId.set(item.id, `dry-run-r-id-for-${item.id}`);
      console.log(`  WOULD INSERT (dry-run): ${label}`);
      createInserted++;
    }
  }

  console.log();

  // ── Phase 3: Updates ────────────────────────────────────────────────

  console.log('Phase 3: Updates...');
  let updateApplied = 0;
  let updateSkipped = 0;
  let updateNoMatch = 0;
  let updateAmbiguous = 0;
  let updateFailed = 0;

  for (const item of updates) {
    const label = `[UPDATE] ${item.title.slice(0, 60)}`;

    // Find matching item on 'r' by title (M-1: handles 0/1/2+ matches)
    const matchResult = await findMatchOnR(clientR, item.title);

    if (matchResult.status === 'none') {
      console.log(`  SKIP (no match on R): ${label}`);
      updateNoMatch++;
      continue;
    }

    if (matchResult.status === 'ambiguous') {
      const candidateIds = matchResult.candidates!.map((c) => c.id).join(', ');
      console.log(
        `  SKIP (ambiguous: ${matchResult.candidates!.length} matches on R, ` +
        `title="${item.title}"): ${label}. Candidate IDs: ${candidateIds}. ` +
        `Resolve manually before re-running.`,
      );
      updateAmbiguous++;
      continue;
    }

    const match = matchResult.match!;

    // C-1: Record M→R UUID mapping for history phase
    mIdToRId.set(item.id, match.id);

    // If content_text_hash already matches Matthew's version, skip
    if (match.content_text_hash && match.content_text_hash === item.content_text_hash) {
      console.log(`  SKIP (already up to date on R): ${label}`);
      updateSkipped++;
      continue;
    }

    if (args.liveApply) {
      try {
        const payload = buildUpdatePayload(item);
        const { data: updated, error: updateError } = await clientR
          .from('content_items')
          .update(payload)
          .eq('id', match.id)
          .select('id');

        if (updateError) {
          console.log(`  FAIL: ${label} — ${updateError.message}`);
          updateFailed++;
          continue;
        }

        if (!updated || updated.length !== 1) {
          console.log(`  FAIL: ${label} — update matched ${updated?.length ?? 0} rows`);
          updateFailed++;
          continue;
        }

        console.log(`  PASS: ${label} → ${match.id}`);
        updateApplied++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  FAIL: ${label} — ${msg}`);
        updateFailed++;
      }
    } else {
      console.log(`  WOULD UPDATE (dry-run): ${label} → ${match.id}`);
      updateApplied++;
    }
  }

  console.log();

  // ── Phase 4: History rows (C-1: translate content_item_id via mIdToRId) ──

  console.log('Phase 4: History rows...');
  let historyInserted = 0;
  let historySkipped = 0;
  let historyOrphaned = 0;
  let historyFailed = 0;

  for (const row of history) {
    const label = `[HISTORY] ${row.change_type} v${row.version} on ${row.content_item_id}`;

    if (!row.content_item_id) {
      console.log(`  SKIP (null content_item_id): ${label}`);
      historySkipped++;
      continue;
    }

    // C-1: Translate M UUID → R UUID
    const rContentItemId = mIdToRId.get(row.content_item_id);
    if (!rContentItemId) {
      console.log(
        `  SKIP (orphan: no M→R mapping for ${row.content_item_id}): ${label}. ` +
        `Item was neither created nor matched on R.`,
      );
      historyOrphaned++;
      continue;
    }

    if (!args.liveApply) {
      // Dry-run: skip idempotency check (synthetic R UUID fails PG UUID validation)
      console.log(`  WOULD INSERT (dry-run): ${label} → R content_item_id ${rContentItemId}`);
      historyInserted++;
      continue;
    }

    // Idempotency check (use translated R UUID)
    const exists = await checkHistoryExistsOnR(
      clientR,
      rContentItemId,
      row.version,
      MATTHEW_USER_ID,
    );

    if (exists) {
      console.log(`  SKIP (already exists on R): ${label}`);
      historySkipped++;
      continue;
    }

    if (args.liveApply) {
      try {
        const payload = buildHistoryPayload(row);
        // C-1: Override content_item_id with translated R UUID
        payload.content_item_id = rContentItemId;
        const { data: inserted, error: insertError } = await clientR
          .from('content_history')
          .insert(payload)
          .select('id');

        if (insertError) {
          console.log(`  FAIL: ${label} — ${insertError.message}`);
          historyFailed++;
          continue;
        }

        if (!inserted || inserted.length !== 1) {
          console.log(`  FAIL: ${label} — insert returned ${inserted?.length ?? 0} rows`);
          historyFailed++;
          continue;
        }

        console.log(`  PASS: ${label} → ${inserted[0].id} (content_item_id: ${rContentItemId})`);
        historyInserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  FAIL: ${label} — ${msg}`);
        historyFailed++;
      }
    } else {
      console.log(`  WOULD INSERT (dry-run): ${label} (content_item_id on R: ${rContentItemId})`);
      historyInserted++;
    }
  }

  console.log();

  // ── Phase 5: Workspace associations (H-1) ─────────────────────────

  console.log('Phase 5: Workspace associations...');
  let wsInserted = 0;
  let wsSkipped = 0;
  let wsOrphaned = 0;
  let wsMissingWorkspace = 0;
  let wsFailed = 0;

  // Only query workspace associations for created items (updates already exist on R)
  const createMItemIds = creates.map((c) => c.id);
  const mWorkspaceAssocs = await queryWorkspaceAssociations(clientM, createMItemIds);

  console.log(`  Workspace associations found on M: ${mWorkspaceAssocs.length}`);

  for (const assoc of mWorkspaceAssocs) {
    const rItemId = mIdToRId.get(assoc.content_item_id);
    const label = `[WS-ASSOC] M:${assoc.content_item_id} → ws:${assoc.workspace_id}`;

    if (!rItemId) {
      console.log(`  SKIP (orphan: no M→R mapping for ${assoc.content_item_id}): ${label}`);
      wsOrphaned++;
      continue;
    }

    if (args.liveApply) {
      try {
        // Check workspace exists on R
        const wsExists = await checkWorkspaceExistsOnR(clientR, assoc.workspace_id);
        if (!wsExists) {
          console.log(`  SKIP (workspace ${assoc.workspace_id} not found on R): ${label}`);
          wsMissingWorkspace++;
          continue;
        }

        // Idempotency check
        const assocExists = await checkWorkspaceAssocExistsOnR(clientR, rItemId, assoc.workspace_id);
        if (assocExists) {
          console.log(`  SKIP (already exists on R): ${label}`);
          wsSkipped++;
          continue;
        }

        const { data: inserted, error: insertError } = await clientR
          .from('content_item_workspaces')
          .insert({ content_item_id: rItemId, workspace_id: assoc.workspace_id })
          .select('content_item_id');

        if (insertError) {
          console.log(`  FAIL: ${label} — ${insertError.message}`);
          wsFailed++;
          continue;
        }

        if (!inserted || inserted.length !== 1) {
          console.log(`  FAIL: ${label} — insert returned ${inserted?.length ?? 0} rows`);
          wsFailed++;
          continue;
        }

        console.log(`  PASS: ${label} → R:${rItemId}`);
        wsInserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  FAIL: ${label} — ${msg}`);
        wsFailed++;
      }
    } else {
      console.log(`  WOULD INSERT (dry-run): ${label} → R:${rItemId}`);
      wsInserted++;
    }
  }

  console.log();

  // ── Summary ─────────────────────────────────────────────────────────

  console.log('='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Mode: ${args.liveApply ? 'LIVE-APPLY' : 'DRY-RUN'}`);
  console.log();
  console.log('  Creates:');
  console.log(`    Inserted:  ${createInserted}${args.liveApply ? '' : ' (would insert)'}`);
  console.log(`    Skipped:   ${createSkipped}`);
  console.log(`    Failed:    ${createFailed}`);
  console.log();
  console.log('  Updates:');
  console.log(`    Applied:   ${updateApplied}${args.liveApply ? '' : ' (would update)'}`);
  console.log(`    Skipped:   ${updateSkipped} (already up to date)`);
  console.log(`    No match:  ${updateNoMatch} (not found on R)`);
  console.log(`    Ambiguous: ${updateAmbiguous} (multiple matches, manual resolution needed)`);
  console.log(`    Failed:    ${updateFailed}`);
  console.log();
  console.log('  History:');
  console.log(`    Inserted:  ${historyInserted}${args.liveApply ? '' : ' (would insert)'}`);
  console.log(`    Skipped:   ${historySkipped}`);
  console.log(`    Orphaned:  ${historyOrphaned} (no M→R mapping)`);
  console.log(`    Failed:    ${historyFailed}`);
  console.log();
  console.log('  Workspace Associations:');
  console.log(`    Inserted:    ${wsInserted}${args.liveApply ? '' : ' (would insert)'}`);
  console.log(`    Skipped:     ${wsSkipped} (already exists)`);
  console.log(`    Orphaned:    ${wsOrphaned} (no M→R mapping)`);
  console.log(`    No workspace:${wsMissingWorkspace} (workspace not on R)`);
  console.log(`    Failed:      ${wsFailed}`);
  console.log();
  console.log(`  M→R UUID mappings: ${mIdToRId.size}`);
  console.log();

  if (!args.liveApply) {
    console.log(
      'To apply these changes, re-run with --live-apply:',
    );
    console.log(
      '  bun run scripts/migrate_matthew_contributions_from_M.ts --live-apply',
    );
  }

  // Exit non-zero if any failures
  if (createFailed + updateFailed + historyFailed + wsFailed > 0) {
    process.exit(1);
  }
}

// Only run main when executed directly (not when imported for tests)
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('migrate_matthew_contributions_from_M.ts');

if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
