#!/usr/bin/env bun
/**
 * Backfill: canonicalise ai_keywords on all content_items.
 *
 * Applies normaliseTag() to every keyword in every row's ai_keywords array,
 * deduplicates, and writes back only the rows that changed.
 *
 * Idempotent: a second run produces zero writes because all keywords are
 * already in canonical form.
 *
 * IMPORTANT — user_tags are NEVER touched by this script. Reads and writes
 * ai_keywords only.
 *
 * Sandbox note: this script uses supabase-js .update() which returns HTTP 204
 * on success. Per CLAUDE.md gotcha "Bun fetch hangs on HTTP 204 through sandbox
 * proxy", it MUST be invoked with dangerouslyDisableSandbox: true when run from
 * a Claude Code session. Production (Vercel) is unaffected.
 *
 * Usage:
 *   bun run scripts/backfill-canonicalise-ai-keywords.ts              # dry run (default)
 *   bun run scripts/backfill-canonicalise-ai-keywords.ts --apply      # write changes
 *   bun run scripts/backfill-canonicalise-ai-keywords.ts --limit 50   # process max 50 rows
 *
 * Spec: docs/specs/p0-tag-canonicalisation-classify-time-spec.md ss7.1.
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { normaliseTag } from '../lib/validation/schemas';
import type { Database } from '../supabase/types/database.types';

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
    dir = path.dirname(dir);
  }
}

loadEnv();

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/backfill-canonicalise-ai-keywords.ts --env=prod`,
    );
    process.exit(1);
  }
}

// ── Normalisation logic (exported for testing) ─────────────────────────────

/**
 * Canonicalise a keyword array: normalise each tag, filter empties, dedup.
 * Returns { changed: boolean, result: string[] }.
 */
export function canonicaliseKeywords(keywords: string[]): {
  changed: boolean;
  result: string[];
} {
  const normalised = keywords
    .map((kw) => normaliseTag(kw))
    .filter((kw) => kw.length > 0);
  const deduped = [...new Set(normalised)];

  // Check if anything changed — compare length + element-by-element
  const changed =
    deduped.length !== keywords.length ||
    deduped.some((kw, i) => kw !== keywords[i]);

  return { changed, result: deduped };
}

// ── CLI entry point ────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      apply: { type: 'boolean', default: false },
      limit: { type: 'string', default: '' },
      help: { type: 'boolean', default: false },
      env: { type: 'string', default: '' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Usage: bun run scripts/backfill-canonicalise-ai-keywords.ts [options]

Options:
  --apply       Write changes to the database (default: dry run)
  --limit N     Process at most N rows
  --env=prod    Asserts SUPABASE_URL points at current prod
                ('${PROD_PROJECT_REF}'). Override invocation:
                SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key>
                bun run scripts/backfill-canonicalise-ai-keywords.ts --env=prod
  --help        Show this help message

Examples:
  bun run scripts/backfill-canonicalise-ai-keywords.ts              # dry run
  bun run scripts/backfill-canonicalise-ai-keywords.ts --apply      # write changes
  bun run scripts/backfill-canonicalise-ai-keywords.ts --limit 10   # preview 10 rows
`);
    process.exit(0);
  }

  const DRY_RUN = !values.apply;
  const LIMIT = values.limit ? parseInt(values.limit, 10) : 0;

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
    );
    process.exit(1);
  }

  assertEnvFlag(values.env ?? '', supabaseUrl);

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  console.log('='.repeat(60));
  console.log('BACKFILL: Canonicalise ai_keywords');
  console.log('='.repeat(60));
  console.log(
    `  Mode:  ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing changes)'}`,
  );
  if (LIMIT > 0) console.log(`  Limit: ${LIMIT} rows`);
  console.log();

  // Fetch all rows with ai_keywords
  let query = supabase
    .from('content_items')
    .select('id, ai_keywords')
    .not('ai_keywords', 'is', null);

  if (LIMIT > 0) {
    query = query.limit(LIMIT);
  }

  const { data: rows, error: fetchError } = await query;

  if (fetchError) {
    console.error('Failed to fetch content_items:', fetchError.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No rows with ai_keywords found. Nothing to do.');
    process.exit(0);
  }

  console.log(`  Rows scanned: ${rows.length}`);
  console.log();

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const changes: Array<{
    id: string;
    before: string[];
    after: string[];
  }> = [];

  for (const row of rows) {
    const keywords = row.ai_keywords as string[];
    if (!Array.isArray(keywords) || keywords.length === 0) {
      skippedCount++;
      continue;
    }

    const { changed, result } = canonicaliseKeywords(keywords);

    if (!changed) {
      skippedCount++;
      continue;
    }

    updatedCount++;
    changes.push({
      id: row.id,
      before: keywords,
      after: result,
    });

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from('content_items')
        .update({ ai_keywords: result })
        .eq('id', row.id);

      if (updateError) {
        console.error(`  ERROR updating ${row.id}: ${updateError.message}`);
        errorCount++;
      }
    }
  }

  // Report
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Rows scanned:   ${rows.length}`);
  console.log(
    `  Rows updated:   ${updatedCount}${DRY_RUN ? ' (dry run — no writes)' : ''}`,
  );
  console.log(`  Rows skipped:   ${skippedCount}`);
  if (errorCount > 0) {
    console.log(`  Errors:         ${errorCount}`);
  }
  console.log();

  if (changes.length > 0) {
    console.log('Changes:');
    for (const c of changes) {
      console.log(`  ${c.id}:`);
      console.log(`    before: [${c.before.join(', ')}]`);
      console.log(`    after:  [${c.after.join(', ')}]`);
    }
  }

  if (DRY_RUN && updatedCount > 0) {
    console.log();
    console.log('  This was a dry run. Use --apply to write changes.');
  }
}

// Only run when executed directly (not imported for testing)
if (process.argv[1]?.endsWith('backfill-canonicalise-ai-keywords.ts')) {
  main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
}
