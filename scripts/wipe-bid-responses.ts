#!/usr/bin/env bun
/**
 * Wipe bid responses — migration helper for P0-BM Phase 2.
 *
 * Deletes all rows from `bid_response_history` and `bid_responses` in FK order.
 * Used during the wipe-and-regenerate migration (no production bid data exists).
 *
 * Optional `--convert` flag: instead of deleting, converts existing HTML
 * `response_text` values to markdown in-place using the project's configured
 * Turndown service. Useful if preserving responses during the HTML → markdown
 * format migration.
 *
 * NOTE: When running against the dev DB via Claude Code, invoke with
 * `dangerouslyDisableSandbox: true` to avoid the Bun+sandbox HTTP 204 hang
 * (see CLAUDE.md Gotchas § Supabase).
 *
 * Usage:
 *   bun run scripts/wipe-bid-responses.ts                # wipe all (with 5s safety delay)
 *   bun run scripts/wipe-bid-responses.ts --dry-run      # preview counts without changes
 *   bun run scripts/wipe-bid-responses.ts --convert      # HTML → markdown in-place (no delete)
 *   bun run scripts/wipe-bid-responses.ts --convert --dry-run  # preview conversion
 *   bun run scripts/wipe-bid-responses.ts --yes          # skip 5s safety delay
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// ── Env loading (handles worktrees) ────────────────────────────────────────

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
    'dry-run': { type: 'boolean', default: false },
    convert: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/wipe-bid-responses.ts [options]

Options:
  --dry-run    Preview row counts without making changes
  --convert    Convert HTML response_text to markdown in-place (no delete)
  --yes        Skip the 5-second safety delay before destructive operations
  --help       Show this help
`);
  process.exit(0);
}

const DRY_RUN = args['dry-run']!;
const CONVERT = args.convert!;
const SKIP_DELAY = args.yes!;

// ── Supabase client ────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  console.error(
    'ERROR: Missing NEXT_PUBLIC_SUPABASE_URL in environment. Check .env or .env.local.',
  );
  process.exit(1);
}

if (!supabaseKey) {
  console.error(
    'ERROR: Missing SUPABASE_SECRET_KEY in environment. This script requires the service-role key, not the anon key.',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Count helper ───────────────────────────────────────────────────────────

async function countRows(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`ERROR counting ${table}: ${error.message}`);
    process.exit(1);
  }

  return count ?? 0;
}

// ── Convert path ───────────────────────────────────────────────────────────

async function convertResponses(): Promise<void> {
  // Dynamic import to avoid loading Turndown when not needed
  const { turndown } = await import('../lib/extraction/turndown');

  const { data: responses, error } = await supabase
    .from('bid_responses')
    .select('id, response_text, response_text_advanced');

  if (error) {
    console.error(`ERROR fetching bid_responses: ${error.message}`);
    process.exit(1);
  }

  if (!responses || responses.length === 0) {
    console.log('No bid responses to convert.');
    return;
  }

  console.log(`Found ${responses.length} bid responses to convert.`);

  let converted = 0;
  let skipped = 0;

  for (const row of responses) {
    const updates: Record<string, string | null> = {};
    let needsUpdate = false;

    // Convert response_text if it looks like HTML
    if (row.response_text && row.response_text.includes('<')) {
      updates.response_text = turndown.turndown(row.response_text);
      needsUpdate = true;
    }

    // Convert response_text_advanced if it looks like HTML
    if (row.response_text_advanced && row.response_text_advanced.includes('<')) {
      updates.response_text_advanced = turndown.turndown(
        row.response_text_advanced,
      );
      needsUpdate = true;
    }

    if (!needsUpdate) {
      skipped++;
      console.log(`  [${converted + skipped}/${responses.length}] ${row.id} — skipped (not HTML)`);
      continue;
    }

    if (DRY_RUN) {
      converted++;
      console.log(`  [${converted + skipped}/${responses.length}] ${row.id} — would convert`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('bid_responses')
      .update(updates)
      .eq('id', row.id)
      .select();

    if (updateError) {
      console.error(`  ERROR updating ${row.id}: ${updateError.message}`);
      process.exit(1);
    }

    converted++;
    console.log(`  [${converted + skipped}/${responses.length}] ${row.id} — converted`);
  }

  const prefix = DRY_RUN ? '[DRY RUN] Would convert' : 'Converted';
  console.log(
    `\n${prefix} ${converted} responses. Skipped ${skipped} (already markdown/plain text).`,
  );
}

// ── Delete path ────────────────────────────────────────────────────────────

async function wipeResponses(): Promise<void> {
  const historyCount = await countRows('bid_response_history');
  const responseCount = await countRows('bid_responses');

  console.log(`bid_response_history: ${historyCount} rows`);
  console.log(`bid_responses: ${responseCount} rows`);

  const total = historyCount + responseCount;

  if (total === 0) {
    console.log('\nNo bid responses to wipe.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(
      `\n[DRY RUN] Would delete ${historyCount} history rows, ${responseCount} responses.`,
    );
    process.exit(0);
  }

  // Safety delay for destructive operations
  if (!SKIP_DELAY) {
    console.log(
      '\nWARNING: About to delete ALL bid responses. Press Ctrl-C to abort (5s)...',
    );
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Delete in FK order: bid_response_history first, then bid_responses.
  // Both FKs are ON DELETE CASCADE, but explicit ordering gives accurate counts
  // and is defensive against schema changes.

  // 1. Delete bid_response_history
  // supabase-js v2 requires a filter on .delete() — use a tautological filter
  const { error: histError } = await supabase
    .from('bid_response_history')
    .delete()
    .gte('created_at', '1970-01-01')
    .select();

  if (histError) {
    console.error(
      `ERROR deleting bid_response_history: ${histError.message}`,
    );
    console.error(
      'bid_responses were NOT deleted. Partial state: history deletion may have partially completed.',
    );
    process.exit(1);
  }

  // 2. Delete bid_responses (cascades content_citations via FK)
  const { error: respError } = await supabase
    .from('bid_responses')
    .delete()
    .gte('created_at', '1970-01-01')
    .select();

  if (respError) {
    console.error(`ERROR deleting bid_responses: ${respError.message}`);
    console.error(
      'bid_response_history was already deleted. Manual cleanup may be needed.',
    );
    process.exit(1);
  }

  console.log(
    `\nDeleted ${historyCount} history rows, ${responseCount} responses.`,
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Bid Response Wipe/Convert Script ===\n');

  if (CONVERT) {
    console.log(`Mode: convert (HTML → markdown)${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
    await convertResponses();
  } else {
    console.log(`Mode: wipe${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
    await wipeResponses();
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
