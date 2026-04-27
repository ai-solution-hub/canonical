#!/usr/bin/env bun
/**
 * Backfill content_chunks for existing content items.
 *
 * Queries content_items where `content` is non-empty and the item has zero
 * rows in content_chunks, then calls regenerateChunks() for each. Per-item
 * progress is logged and a final tally printed.
 *
 * Safety: uses the service-role key and writes only to content_chunks. The
 * content_items table is read-only here.
 *
 * Usage:
 *   bun run scripts/backfill-chunks.ts                    # process all eligible
 *   bun run scripts/backfill-chunks.ts --limit 50         # process max 50
 *   bun run scripts/backfill-chunks.ts --dry-run          # preview without writing
 *   bun run scripts/backfill-chunks.ts --item-id <uuid>   # backfill a single item
 *
 * IMPORTANT: this script mutates the database via supabase-js which returns
 * HTTP 204 on insert/update/delete without .select(). Bun in the sandbox
 * hangs on 204, so run with `dangerouslyDisableSandbox: true` (the Bash tool
 * flag) or outside a sandboxed shell. Production usage is unaffected.
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { regenerateChunks } from '../lib/content/chunk-store';

// ── Env loading (handles worktrees) ─────────────────────────────────────────

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

loadEnv();

// ── Args ───────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    limit: { type: 'string', default: '0' },
    'dry-run': { type: 'boolean', default: false },
    'item-id': { type: 'string', default: '' },
    'batch-size': { type: 'string', default: '100' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-chunks.ts [options]

Options:
  --limit N         Max items to process (0 = all eligible)
  --dry-run         Preview without writing to database
  --item-id UUID    Backfill a single specific item (useful for testing)
  --batch-size N    Page size when scanning content_items (default: 100)
  --help            Show this help
`);
  process.exit(0);
}

const LIMIT = parseInt(args.limit!, 10) || 0;
const DRY_RUN = args['dry-run']!;
const ITEM_ID = args['item-id']!.trim();
const BATCH_SIZE = parseInt(args['batch-size']!, 10) || 100;

// ── Supabase client (service role) ─────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Helpers ────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content: string;
}

function displayTitle(item: Candidate): string {
  const t = (item.suggested_title ?? item.title ?? '').trim();
  return t.length > 0 ? t : '(untitled)';
}

/**
 * Collect candidate items: non-empty content AND no existing chunks.
 *
 * We fetch items in pages of BATCH_SIZE, then filter out any that already
 * have rows in content_chunks. Supabase doesn't expose a clean "anti-join"
 * via the JS builder, so we page through and test each batch.
 */
async function collectCandidates(maxItems: number): Promise<Candidate[]> {
  // Single-item path
  if (ITEM_ID) {
    const { data, error } = await supabase
      .from('content_items')
      .select('id, title, suggested_title, content')
      .eq('id', ITEM_ID)
      .maybeSingle();

    if (error) {
      console.error(`Query error: ${error.message}`);
      process.exit(1);
    }
    if (!data) {
      console.log(`No item found with id=${ITEM_ID}`);
      return [];
    }
    if (!data.content || data.content.trim().length === 0) {
      console.log(`Item ${ITEM_ID} has no content; nothing to do.`);
      return [];
    }
    return [data as Candidate];
  }

  const result: Candidate[] = [];
  let page = 0;

  while (true) {
    const from = page * BATCH_SIZE;
    const to = from + BATCH_SIZE - 1;

    const { data, error } = await supabase
      .from('content_items')
      .select('id, title, suggested_title, content')
      .not('content', 'is', null)
      .neq('content', '')
      .order('captured_date', { ascending: false })
      .range(from, to);

    if (error) {
      console.error(`Query error on page ${page}: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    // Anti-join in code: pull existing chunk content_item_ids for this page
    // and skip items that already have any.
    const ids = data.map((d) => d.id);
    const { data: existingChunks, error: chunkError } = await supabase
      .from('content_chunks')
      .select('content_item_id')
      .in('content_item_id', ids);

    if (chunkError) {
      console.error(`Chunk lookup error: ${chunkError.message}`);
      process.exit(1);
    }

    const alreadyChunked = new Set(
      (existingChunks ?? []).map((c) => c.content_item_id),
    );

    for (const item of data) {
      if (alreadyChunked.has(item.id)) continue;
      if (!item.content || item.content.trim().length === 0) continue;
      result.push(item as Candidate);
      if (maxItems > 0 && result.length >= maxItems) return result;
    }

    if (data.length < BATCH_SIZE) break; // last page
    page++;
  }

  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Content Chunks Backfill');
  console.log('='.repeat(60));
  console.log(`  Limit:      ${LIMIT || 'all'}`);
  console.log(`  Dry run:    ${DRY_RUN}`);
  console.log(`  Item ID:    ${ITEM_ID || '(all eligible)'}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log();

  const candidates = await collectCandidates(LIMIT);
  if (candidates.length === 0) {
    console.log('No eligible items found.');
    return;
  }

  console.log(`Found ${candidates.length} eligible items.\n`);

  let itemsProcessed = 0;
  let chunksCreated = 0;
  let errors = 0;
  const errorSummary: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const progress = `[${i + 1}/${candidates.length}]`;
    const title = displayTitle(item);

    if (DRY_RUN) {
      // Run chunking locally (no DB writes) so we can report the projected
      // chunk count. Pull the chunker lazily to avoid coupling main()'s
      // imports.
      const { chunkByHeadings } = await import('../lib/content/chunking');
      const projected = chunkByHeadings(item.content);
      console.log(
        `${progress} ${title.slice(0, 60)} (${item.id}) -> ${projected.length} chunks (dry)`,
      );
      itemsProcessed++;
      chunksCreated += projected.length;
      continue;
    }

    const result = await regenerateChunks(supabase, item.id, item.content);
    itemsProcessed++;
    chunksCreated += result.stored;

    if (result.errors.length > 0) {
      errors++;
      const msg = `${progress} ${title.slice(0, 60)} (${item.id}) -> ERRORS: ${result.errors.join('; ')}`;
      console.log(msg);
      errorSummary.push(msg);
    } else {
      console.log(
        `${progress} ${title.slice(0, 60)} (${item.id}) -> ${result.stored} chunks`,
      );
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(
    `  Items processed: ${itemsProcessed}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Chunks created:  ${chunksCreated}`);
  console.log(`  Errors:          ${errors}`);

  if (errorSummary.length > 0) {
    console.log();
    console.log('Error detail:');
    for (const line of errorSummary) console.log('  ' + line);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
