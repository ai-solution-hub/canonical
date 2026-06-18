/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Standalone Bun script, not part of Next.js build
/**
 * Backfill: Classify content_items in a given workspace
 *
 * Targeted backfill for `content_items` rows that were promoted from
 * `feed_articles` but never passed through `classifyContent` /
 * `extractEntities` / embedding. Finds candidates by joining through
 * `feed_articles.workspace_id` (content_items has no workspace_id column —
 * workspace is imputed from the originating feed article).
 *
 * Candidates are items that match AT LEAST ONE of:
 *   - classified_at IS NULL
 *   - no rows in entity_mentions for that item
 *
 * For each candidate, calls `classifyContent({ force: true, validate: true,
 * userId: PIPELINE_SERVICE_ACCOUNT_USER_ID })` which (per S157 WP2) runs
 * delete-before-insert on entity_mentions — so re-runs produce a clean
 * post-fix snapshot, not a stale merge.
 *
 * Usage:
 *   bun run scripts/backfill-classify-content-items.ts --workspace-id <UUID>
 *   bun run scripts/backfill-classify-content-items.ts --workspace-id <UUID> --dry-run
 *   bun run scripts/backfill-classify-content-items.ts --workspace-id <UUID> --limit 50
 *   bun run scripts/backfill-classify-content-items.ts --workspace-id <UUID> --content-type article
 *
 * IMPORTANT: `--workspace-id` is REQUIRED. There is no default — the script
 * refuses to run without it to prevent accidental full-DB reclassification.
 *
 * Sandbox note: this script writes to Supabase (classifyContent updates
 * content_items and inserts entity_mentions). Per the Bun fetch 204 gotcha
 * in CLAUDE.md, run with `dangerouslyDisableSandbox: true` when invoked
 * from the Claude Code sandbox environment. Production (Vercel) is fine.
 *
 * Exit codes:
 *   0 — Ran to completion (classified, failed, or dry-run summary printed)
 *   1 — Fatal error (missing --workspace-id, env, DB unreachable, etc.)
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Pipeline service account UUID for classifyContent calls.
 * content_items.updated_by is a uuid column — a string like 'esm-backfill'
 * would fail with `invalid input syntax for type uuid`. See CLAUDE.md
 * gotchas and scripts/eval-entity-classification.ts.
 */
export const PIPELINE_SERVICE_ACCOUNT_USER_ID =
  'a0000000-0000-4000-8000-000000000001';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

/** Delay between classification calls, in milliseconds (rate limiting). */
export const RATE_LIMIT_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export interface CliArgs {
  workspaceId: string | null;
  dryRun: boolean;
  limit: number;
  contentType: string | null;
  env: string;
  /** If set, parseArgs collected an error message instead of valid args. */
  error: string | null;
}

export function parseArgs(argv: string[]): CliArgs {
  let workspaceId: string | null = null;
  let dryRun = false;
  let limit = DEFAULT_LIMIT;
  let contentType: string | null = null;
  let env = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace-id' && argv[i + 1]) {
      workspaceId = argv[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--limit' && argv[i + 1]) {
      const parsed = parseInt(argv[i + 1], 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return {
          workspaceId,
          dryRun,
          limit,
          contentType,
          env,
          error: `--limit must be a positive integer, got "${argv[i + 1]}"`,
        };
      }
      limit = parsed;
      i++;
    } else if (arg === '--content-type' && argv[i + 1]) {
      contentType = argv[i + 1];
      i++;
    } else if (arg === '--env' && argv[i + 1]) {
      env = argv[i + 1];
      i++;
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length);
    }
  }

  if (!workspaceId) {
    return {
      workspaceId,
      dryRun,
      limit,
      contentType,
      env,
      error:
        '--workspace-id <uuid> is REQUIRED. The script refuses to run ' +
        'without it to prevent accidental full-DB reclassification.',
    };
  }

  if (limit > MAX_LIMIT) {
    return {
      workspaceId,
      dryRun,
      limit,
      contentType,
      env,
      error: `--limit ${limit} exceeds hard cap of ${MAX_LIMIT} (anti-runaway).`,
    };
  }

  return { workspaceId, dryRun, limit, contentType, env, error: null };
}

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/backfill-classify-content-items.ts --env=prod`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Candidate selection (exported for testing)
// ---------------------------------------------------------------------------

export interface CandidateItem {
  id: string;
  title: string;
  content_type: string;
  classified_at: string | null;
}

/**
 * Finds content_items belonging (via feed_articles) to the given workspace
 * that are missing classification or have no entity mentions. Pure data
 * access — exported so tests can mock the supabase client.
 */
export async function findCandidates(
  supabase: SupabaseClient,
  workspaceId: string,
  limit: number,
  contentType: string | null,
): Promise<CandidateItem[]> {
  // 1. Get content_item_ids for this workspace via feed_articles.
  const { data: feedArticles, error: feedErr } = await supabase
    .from('feed_articles')
    .select('content_item_id')
    .eq('workspace_id', workspaceId)
    .not('content_item_id', 'is', null);

  if (feedErr) {
    throw new Error(`Failed to query feed_articles: ${feedErr.message}`);
  }

  const contentItemIds = [
    ...new Set(
      (feedArticles ?? [])
        .map((a: { content_item_id: string | null }) => a.content_item_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (contentItemIds.length === 0) {
    return [];
  }

  // 2. Fetch content_items with classification status.
  let itemsQuery = supabase
    .from('content_items')
    .select('id, title, content_type, classified_at')
    .in('id', contentItemIds);

  if (contentType) {
    itemsQuery = itemsQuery.eq('content_type', contentType);
  }

  const { data: items, error: itemsErr } = await itemsQuery;
  if (itemsErr) {
    throw new Error(`Failed to query content_items: ${itemsErr.message}`);
  }

  const allItems = (items ?? []) as CandidateItem[];
  if (allItems.length === 0) return [];

  // 3. Find which of those have entity_mentions already.
  const allIds = allItems.map((i) => i.id);
  const { data: mentions, error: mentionsErr } = await supabase
    .from('entity_mentions')
    .select('content_item_id')
    .in('content_item_id', allIds);

  if (mentionsErr) {
    throw new Error(`Failed to query entity_mentions: ${mentionsErr.message}`);
  }

  const idsWithMentions = new Set(
    ((mentions ?? []) as Array<{ content_item_id: string }>).map(
      (m) => m.content_item_id,
    ),
  );

  // 4. Keep items where classified_at IS NULL OR no entity_mentions exist.
  const candidates = allItems.filter(
    (item) => item.classified_at === null || !idsWithMentions.has(item.id),
  );

  return candidates.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Summary type
// ---------------------------------------------------------------------------

export interface BackfillSummary {
  total_candidates: number;
  classified: number;
  failed: number;
  failures: Array<{ id: string; title: string; error: string }>;
  /** Rough cost estimate in USD, based on classifyContent telemetry. */
  cost_estimate_usd: number;
}

export function formatSummary(
  summary: BackfillSummary,
  dryRun: boolean,
): string {
  const lines = [
    '',
    `--- Backfill ${dryRun ? '(DRY RUN) ' : ''}Summary ---`,
    `Total candidates: ${summary.total_candidates}`,
    `Classified:       ${summary.classified}`,
    `Failed:           ${summary.failed}`,
    `Cost estimate:    $${summary.cost_estimate_usd.toFixed(4)}`,
  ];
  if (summary.failures.length > 0) {
    lines.push('', 'Failures:');
    for (const f of summary.failures) {
      lines.push(`  - ${f.id}: ${f.title} — ${f.error}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Env loader (same pattern as other scripts)
// ---------------------------------------------------------------------------

function loadEnvFile(path: string): void {
  try {
    // @ts-expect-error Bun-only API
    const content = Bun.file(path).textSync();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — fine.
  }
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`Error: ${args.error}`);
    process.exit(1);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
    process.exit(1);
  }

  assertEnvFlag(args.env, supabaseUrl);

  if (!process.env.ANTHROPIC_API_KEY && !args.dryRun) {
    console.error(
      'Error: ANTHROPIC_API_KEY must be set (required by classifyContent).',
    );
    process.exit(1);
  }

  const supabase = createScriptClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(
    `Scanning workspace ${args.workspaceId} for unclassified content_items...`,
  );
  if (args.contentType) {
    console.log(`  content_type filter: ${args.contentType}`);
  }
  console.log(`  limit: ${args.limit}`);
  console.log(`  dry-run: ${args.dryRun}`);

  const candidates = await findCandidates(
    supabase,
    args.workspaceId!,
    args.limit,
    args.contentType,
  );

  const summary: BackfillSummary = {
    total_candidates: candidates.length,
    classified: 0,
    failed: 0,
    failures: [],
    cost_estimate_usd: 0,
  };

  if (candidates.length === 0) {
    console.log('No candidates found — nothing to classify.');
    console.log(formatSummary(summary, args.dryRun));
    return;
  }

  console.log(`Found ${candidates.length} candidate item(s).`);

  if (args.dryRun) {
    console.log('\nDRY RUN — no classification calls will be made:');
    for (const item of candidates) {
      const status =
        item.classified_at === null ? 'unclassified' : 'no-entities';
      console.log(`  - [${status}] ${item.id} — ${item.title}`);
    }
    console.log(formatSummary(summary, true));
    return;
  }

  // Dynamic import to match eval-entity-classification.ts pattern.
  const { classifyContent } = await import('../lib/ai/classify');

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const progress = `[${i + 1}/${candidates.length}]`;
    try {
      const result = await classifyContent({
        supabase,
        itemId: item.id,
        force: true,
        userId: PIPELINE_SERVICE_ACCOUNT_USER_ID,
        validate: true,
      });

      summary.classified++;
      const entityCount = (result.entities ?? []).length;
      // classifyContent doesn't return telemetry cost; log a placeholder so
      // operators can estimate from the per-item count + pricing elsewhere.
      console.log(
        `  ${progress} OK ${item.id} — ${entityCount} entities — ${item.title}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failed++;
      summary.failures.push({ id: item.id, title: item.title, error: msg });
      console.log(`  ${progress} FAIL ${item.id} — ${item.title} — ${msg}`);
    }

    // Rate limiting: 1 req/sec between classifications.
    if (i < candidates.length - 1) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }

  console.log(formatSummary(summary, false));
}

// Only run main when invoked directly (not when imported by tests).
// @ts-expect-error import.meta.main is a Bun extension
if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
