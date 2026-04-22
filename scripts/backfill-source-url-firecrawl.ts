#!/usr/bin/env bun
/**
 * Backfill content_items.source_url for Google News redirect URLs.
 *
 * Finds content_items whose source_url is an opaque Google News redirect
 * (https://news.google.com/rss/articles/...) and resolves each to the real
 * publisher URL using Firecrawl's metadata.sourceURL.
 *
 * DEFAULT MODE IS DRY-RUN. Pass --apply to actually write to the database.
 *
 * Safety guards:
 *   - Refuses to write to the retired project (mgrmucazfiibsomdmndh)
 *   - Validates SUPABASE_URL contains the production project ID
 *   - Skips rows where Firecrawl fails or returns another Google News URL
 *   - Idempotent: re-running after apply is a no-op (already-resolved URLs
 *     no longer match the LIKE filter)
 *
 * Usage:
 *   bun run scripts/backfill-source-url-firecrawl.ts            # dry-run (default)
 *   bun run scripts/backfill-source-url-firecrawl.ts --apply    # live write
 *   bun run scripts/backfill-source-url-firecrawl.ts --help     # show help
 *
 * Expected: 8 rows on production 'r' (rovrymhhffssilaftdwd).
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// ── Constants ─────────────────────────────────────────────────────────────

/** Production project ID — the only project this script is allowed to write to */
const PRODUCTION_PROJECT_ID = 'rovrymhhffssilaftdwd';

/** Retired project ID — refuse to touch this */
const RETIRED_PROJECT_ID = 'mgrmucazfiibsomdmndh';

/** Google News URL prefix for the LIKE query */
const GOOGLE_NEWS_PREFIX = 'https://news.google.com/rss/articles/%';

// ── Env loading (handles worktrees) ───────────────────────────────────────

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

// ── Args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-source-url-firecrawl.ts [options]

Resolves Google News redirect URLs in content_items.source_url to real
publisher URLs using Firecrawl metadata.sourceURL.

Options:
  --apply    Actually write changes (default is dry-run)
  --help     Show this help

Safety:
  - Default mode is DRY-RUN (prints what would change, no writes)
  - Refuses to run against the retired project (${RETIRED_PROJECT_ID})
  - Validates SUPABASE_URL contains ${PRODUCTION_PROJECT_ID}
  - Idempotent: re-running after apply is a no-op
`);
  process.exit(0);
}

const APPLY = args.apply!;

// ── Safety: project ID validation ─────────────────────────────────────────

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'ERROR: Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment',
  );
  process.exit(1);
}

if (supabaseUrl.includes(RETIRED_PROJECT_ID)) {
  console.error(
    `ERROR: Refusing to run against retired project ${RETIRED_PROJECT_ID}`,
  );
  process.exit(1);
}

if (!supabaseUrl.includes(PRODUCTION_PROJECT_ID)) {
  console.error(
    `ERROR: SUPABASE_URL does not contain production project ID ${PRODUCTION_PROJECT_ID}. ` +
      `This script should only run against the production project.`,
  );
  process.exit(1);
}

// ── Firecrawl check ───────────────────────────────────────────────────────

if (!process.env.FIRECRAWL_API_KEY) {
  console.error(
    'ERROR: FIRECRAWL_API_KEY is not set. Cannot resolve URLs without Firecrawl.',
  );
  process.exit(1);
}

// ── Supabase client ───────────────────────────────────────────────────────

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Helpers ───────────────────────────────────────────────────────────────

function isGoogleNewsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'news.google.com';
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Source URL Firecrawl Backfill');
  console.log('='.repeat(60));
  console.log(`  Mode:     ${APPLY ? 'LIVE (will write)' : 'DRY-RUN (preview only)'}`);
  console.log(`  Project:  ${PRODUCTION_PROJECT_ID}`);
  console.log();

  // Query content_items with Google News redirect URLs
  const { data: items, error } = await supabase
    .from('content_items')
    .select('id, title, source_url')
    .like('source_url', GOOGLE_NEWS_PREFIX)
    .is('archived_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log(
      'No content_items with Google News redirect URLs found. Nothing to do.',
    );
    return;
  }

  console.log(`Found ${items.length} content_items with Google News redirect URLs:`);
  console.log();

  // Dynamically import Firecrawl
  const { default: Firecrawl } = await import('@mendable/firecrawl-js');
  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

  let resolved = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const progress = `[${i + 1}/${items.length}]`;
    console.log(`${progress} ${(item.title || '').slice(0, 70)}`);
    console.log(`         Current: ${item.source_url}`);

    try {
      const doc = await firecrawl.scrape(item.source_url, {
        formats: ['html'] as const,
      });

      const metadata = doc.metadata as Record<string, string> | undefined;
      const publisherUrl = metadata?.sourceURL;

      if (!publisherUrl) {
        console.log('         SKIP: Firecrawl did not return metadata.sourceURL');
        skipped++;
        continue;
      }

      if (publisherUrl === item.source_url) {
        console.log('         SKIP: resolved URL is same as current');
        skipped++;
        continue;
      }

      if (isGoogleNewsUrl(publisherUrl)) {
        console.log(
          `         SKIP: resolved URL is still a Google News URL: ${publisherUrl}`,
        );
        skipped++;
        continue;
      }

      console.log(`         Resolved: ${publisherUrl}`);

      if (APPLY) {
        // CLAUDE.md Gotcha: REST PATCH returns 200 OK with 0 rows on UUID
        // mismatch. Include .select() to verify exactly one row was
        // written — silent 0-row writes would leave Google News URLs in
        // place and mask the backfill.
        const { data: updated, error: updateError } = await supabase
          .from('content_items')
          .update({ source_url: publisherUrl })
          .eq('id', item.id)
          .select('id');

        if (updateError) {
          console.log(`         ERROR: update failed — ${updateError.message}`);
          failed++;
          continue;
        }
        if (!updated || updated.length !== 1) {
          console.log(
            `         ERROR: update matched ${updated?.length ?? 0} rows (expected 1) — row may have been deleted or UUID mismatch`,
          );
          failed++;
          continue;
        }
        console.log('         UPDATED');
      } else {
        console.log('         WOULD UPDATE (dry-run)');
      }

      resolved++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`         FAILED: Firecrawl scrape error — ${msg}`);
      failed++;
    }

    // Brief pause between Firecrawl calls to be polite
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Mode:     ${APPLY ? 'LIVE' : 'DRY-RUN'}`);
  console.log(`  Total:    ${items.length}`);
  console.log(`  Resolved: ${resolved}${APPLY ? '' : ' (would update)'}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);

  if (!APPLY && resolved > 0) {
    console.log();
    console.log(
      'To apply these changes, re-run with --apply:',
    );
    console.log(
      '  bun run scripts/backfill-source-url-firecrawl.ts --apply',
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
