#!/usr/bin/env bun
/**
 * Backfill v1 `content_history` rows for content items missing them.
 *
 * Spec: `docs/specs/backfill-content-history-v1-spec.md`
 * Plan: `docs/plans/backfill-content-history-v1-plan.md`
 *
 * S186 WP-A quality gate surfaced a gap: 475 of 545 real-content items on
 * production `mgrmucazfiibsomdmndh` have no version-1 `content_history` row,
 * a pre-S153 regression. Items function normally — this is a provenance /
 * audit-completeness repair, not a correctness fix.
 *
 * Usage:
 *   bun run scripts/backfill-content-history-v1.ts                  # process all
 *   bun run scripts/backfill-content-history-v1.ts --dry-run        # preview
 *   bun run scripts/backfill-content-history-v1.ts --limit 10       # cap at 10
 *   bun run scripts/backfill-content-history-v1.ts --batch-size 50  # default 50
 *   bun run scripts/backfill-content-history-v1.ts --help
 *
 * Sandbox note: this script writes to Supabase. Per the Bun fetch 204 gotcha
 * (CLAUDE.md §Supabase), invoke with `dangerouslyDisableSandbox: true` from the
 * Claude Code sandbox. Production invocation is unaffected.
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// ── Env loading (worktree-aware, matches backfill-chunks.ts) ───────────────

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

// Called from main() so unit tests can import helpers without triggering env
// IO at module-load time.

// ── Args ───────────────────────────────────────────────────────────────────

interface CliArgs {
  limit: number;
  dryRun: boolean;
  batchSize: number;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      limit: { type: 'string', default: '0' },
      'dry-run': { type: 'boolean', default: false },
      'batch-size': { type: 'string', default: '50' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const limit = parseInt(values.limit!, 10);
  const batchSize = parseInt(values['batch-size']!, 10);
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error('--limit must be a non-negative integer');
  }
  if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('--batch-size must be between 1 and 100');
  }
  return {
    limit: limit || 0,
    dryRun: values['dry-run']!,
    batchSize: batchSize || 50,
    help: values.help!,
  };
}

const HELP_TEXT = `
Usage: bun run scripts/backfill-content-history-v1.ts [options]

Inserts a version-1 content_history row for every content item that has
none. Excludes test artefacts (titles prefixed \`[E2E\` or \`[SUPERSEDE\`)
and draft items. Idempotent — re-running inserts zero rows.

Options:
  --dry-run         Preview counts + sample; write zero rows.
  --limit N         Max items to process (0 = all eligible).
  --batch-size N    Insert batch size (1-100, default 50).
  --help            Show this help.

Target DB is read from NEXT_PUBLIC_SUPABASE_URL in .env.local / .env.
Script aborts if the URL points at the retired project \`rovrymhhffssilaftdwd\`.
`;

// ── Safety + env ───────────────────────────────────────────────────────────

const RETIRED_PROJECT_REF = 'rovrymhhffssilaftdwd';

export function assertNotRetiredProject(url: string | undefined): void {
  if (!url) return; // env validation raises elsewhere
  if (url.includes(RETIRED_PROJECT_REF)) {
    console.error(
      `Refusing to run: NEXT_PUBLIC_SUPABASE_URL points at the retired project (${RETIRED_PROJECT_REF}). Update .env.local to the current production project before retrying.`,
    );
    process.exit(1);
  }
}

export function assertEnvComplete(
  url: string | undefined,
  key: string | undefined,
): void {
  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. Populate .env.local before retrying.',
    );
    process.exit(1);
  }
}

// ── Scope filter helpers (exported for tests) ──────────────────────────────

const TEST_TITLE_PREFIXES = ['[E2E', '[SUPERSEDE'] as const;

export function isTestArtefactTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return TEST_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix));
}

// ── Payload builder (exported for tests) ───────────────────────────────────

export const PIPELINE_SERVICE_ACCOUNT_USER_ID =
  'a0000000-0000-4000-8000-000000000001';

export const BACKFILL_CHANGE_REASON = 'backfill_v1_s186';

export const BACKFILL_METADATA = {
  backfill: true,
  reason: 'v1-history-missing-pre-s153',
  source_session: 'S186',
} as const;

export interface ContentItem {
  id: string;
  title: string | null;
  content: string | null;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  created_at: string;
}

export interface HistoryInsertRow {
  content_item_id: string;
  version: number;
  title: string;
  content: string;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  change_type: string;
  change_summary: string;
  change_reason: string;
  metadata: typeof BACKFILL_METADATA;
  created_by: string;
  created_at: string;
}

export function buildHistoryRow(item: ContentItem): HistoryInsertRow {
  return {
    content_item_id: item.id,
    version: 1,
    title: item.title ?? '(untitled)',
    content: item.content ?? '',
    brief: item.brief ?? null,
    detail: item.detail ?? null,
    reference: item.reference ?? null,
    change_type: 'create',
    change_summary: 'Backfill v1 history for pre-S153 items',
    change_reason: BACKFILL_CHANGE_REASON,
    metadata: BACKFILL_METADATA,
    created_by: PIPELINE_SERVICE_ACCOUNT_USER_ID,
    created_at: item.created_at,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  loadEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  assertEnvComplete(supabaseUrl, supabaseKey);
  assertNotRetiredProject(supabaseUrl);

  const supabase = createClient(supabaseUrl!, supabaseKey!);

  console.log('='.repeat(60));
  console.log('Content History v1 Backfill');
  console.log('='.repeat(60));
  console.log(`  Target DB:    ${supabaseUrl}`);
  console.log(`  Limit:        ${args.limit || 'all'}`);
  console.log(`  Dry run:      ${args.dryRun}`);
  console.log(`  Batch size:   ${args.batchSize}`);
  console.log();

  // Pull scope-filtered content_items in pages.
  console.log('Scanning content_items...');

  const pageSize = 1000;
  const items: ContentItem[] = [];
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('content_items')
      .select('id, title, content, brief, detail, reference, created_at, governance_review_status')
      .or('governance_review_status.is.null,governance_review_status.neq.draft')
      .not('title', 'like', '[E2E%')
      .not('title', 'like', '[SUPERSEDE%')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) {
      console.error(`Query error on page ${page}: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (isTestArtefactTitle(row.title)) continue;
      items.push(row as ContentItem);
    }

    if (data.length < pageSize) break;
    page++;
  }

  const totalScoped = items.length;

  // Anti-join against content_history, paginated. Candidate = item with zero
  // history rows. Paginated because `content_history` has multiple rows per
  // item (v1, v2, v3...) and the Supabase REST Max Rows (5000) can truncate
  // the single `.in()` query once edits accumulate in production.
  const withHistory = new Set<string>();
  const itemIds = items.map((i) => i.id);
  const historyPageSize = 1000;
  let historyOffset = 0;

  while (true) {
    const { data: historyPage, error: historyError } = await supabase
      .from('content_history')
      .select('content_item_id')
      .in('content_item_id', itemIds)
      .range(historyOffset, historyOffset + historyPageSize - 1);

    if (historyError) {
      console.error(`History lookup error: ${historyError.message}`);
      process.exit(1);
    }
    if (!historyPage || historyPage.length === 0) break;

    for (const row of historyPage) {
      if (row.content_item_id) withHistory.add(row.content_item_id);
    }
    if (historyPage.length < historyPageSize) break;
    historyOffset += historyPageSize;
  }

  let candidates = items.filter((i) => !withHistory.has(i.id));
  if (args.limit > 0) candidates = candidates.slice(0, args.limit);

  console.log(`  Total items (scope-filtered): ${totalScoped}`);
  console.log(`  Already have history:         ${withHistory.size}`);
  console.log(`  Candidates for backfill:      ${candidates.length}`);
  console.log();

  if (candidates.length === 0) {
    console.log('No eligible items found. Nothing to do.');
    return;
  }

  if (args.dryRun) {
    console.log('Dry run — showing first 10 sample candidates:');
    for (const c of candidates.slice(0, 10)) {
      const titlePreview = (c.title ?? '(untitled)').slice(0, 60);
      console.log(`  - ${c.id}  ${titlePreview}  ${c.created_at}`);
    }
    console.log();
    console.log('Dry run complete. No rows written.');
    return;
  }

  // Batch insert.
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const totalBatches = Math.ceil(candidates.length / args.batchSize);

  for (let b = 0; b < totalBatches; b++) {
    const batch = candidates.slice(b * args.batchSize, (b + 1) * args.batchSize);
    const rows = batch.map(buildHistoryRow);

    const { data, error } = await supabase
      .from('content_history')
      .insert(rows)
      .select('id');

    if (error) {
      // 23505 = unique violation (concurrent v1 insert between scan and write).
      if (error.code === '23505') {
        console.warn(
          `[batch ${b + 1}/${totalBatches}] Unique violation — skipping batch (${batch.length} items).`,
        );
        skipped += batch.length;
      } else {
        console.error(
          `[batch ${b + 1}/${totalBatches}] Insert error: ${error.message}`,
        );
        errors += batch.length;
      }
      continue;
    }

    const n = data?.length ?? batch.length;
    inserted += n;
    console.log(`[batch ${b + 1}/${totalBatches}] Inserted ${n} v1 history rows`);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Rows inserted: ${inserted}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log(`  Errors:        ${errors}`);

  if (errors > 0) process.exit(1);
}

// Only run main() when invoked directly (not when imported by tests).
if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
