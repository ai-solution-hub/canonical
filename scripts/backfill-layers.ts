#!/usr/bin/env bun
/**
 * Backfill layer column for existing content items.
 *
 * Scans content_items where `layer IS NULL` and `archived_at IS NULL`,
 * then for each item either:
 *   A) Copies the layer from metadata->layer if set, or
 *   B) Infers the layer using lib/layer-inference.ts
 *
 * Usage:
 *   bun run scripts/backfill-layers.ts              # dry run (default)
 *   bun run scripts/backfill-layers.ts --apply       # write to database
 *   bun run scripts/backfill-layers.ts --limit 50    # process max 50 items
 *   bun run scripts/backfill-layers.ts --apply --limit 50
 */

import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { createLooseScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';
import { inferLayer } from '../lib/layer-inference';
import type { LayerInferenceInput } from '../lib/layer-inference';

// ── Env loading (handles worktrees) ──────────────────────────────────────────

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

// ── Args ─────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    limit: { type: 'string', default: '0' },
    help: { type: 'boolean', default: false },
    env: { type: 'string', default: '' },
  },
  strict: true,
});

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/backfill-layers.ts --env=prod`,
    );
    process.exit(1);
  }
}

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-layers.ts [options]

Options:
  --apply       Write changes to the database (default is dry run)
  --limit N     Max number of items to process (0 = all)
  --env=prod    Asserts SUPABASE_URL points at current prod
                (the client production project; ref from PROD_PROJECT_REF). Override invocation:
                SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key>
                bun run scripts/backfill-layers.ts --env=prod
  --help        Show this help
`);
  process.exit(0);
}

const DRY_RUN = !args.apply;
const LIMIT = parseInt(args.limit!, 10) || 0;
const BATCH_SIZE = 1000;

// ── Supabase client ──────────────────────────────────────────────────────────

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment',
  );
  process.exit(1);
}

assertEnvFlag(args.env ?? '', supabaseUrl);

// <any>: calls the dead `get_items_needing_layer` rpc (fallback path), not in
// the typed schema — intentionally loose (see supabase-script-client.ts).
const supabase = createLooseScriptClient(supabaseUrl, supabaseKey);

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentItemRow {
  id: string;
  content_type: string | null;
  metadata: Record<string, unknown> | null;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  title: string | null;
  platform: string | null;
  content_length: number;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Layer Backfill');
  console.log('='.repeat(60));
  console.log(
    `  Mode:   ${DRY_RUN ? 'DRY RUN (use --apply to write)' : 'APPLY'}`,
  );
  console.log(`  Limit:  ${LIMIT || 'all'}`);
  console.log();

  // ── Step 1: Fetch eligible content items in batches ─────────────────────

  const allItems: ContentItemRow[] = [];
  let from = 0;

  while (true) {
    const to = from + BATCH_SIZE - 1;

    // Use an RPC or raw query to get char_length instead of full content
    const { data: items, error } = await supabase
      .rpc('get_items_needing_layer', { batch_from: from, batch_to: to })
      .select('*');

    if (error) {
      // Fallback: if RPC doesn't exist, query directly
      // We fetch content_length via a separate approach
      console.log('RPC not available, falling back to direct query...');
      break;
    }

    if (!items || items.length === 0) break;
    allItems.push(...(items as ContentItemRow[]));
    if (LIMIT > 0 && allItems.length >= LIMIT) break;
    if (items.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  // Fallback: direct query if RPC not available
  if (allItems.length === 0) {
    let from = 0;
    while (true) {
      const to = from + BATCH_SIZE - 1;
      const { data: items, error } = await supabase
        .from('content_items')
        .select(
          'id, content_type, metadata, brief, detail, reference, title, platform',
        )
        .is('layer', null)
        .is('archived_at', null)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) {
        console.error('Query error:', error.message);
        process.exit(1);
      }

      if (!items || items.length === 0) break;

      // For content_length, we need to estimate from metadata or make a separate query
      for (const item of items) {
        const metadata = item.metadata as Record<string, unknown> | null;
        const contentLength =
          typeof metadata?.content_length === 'number'
            ? metadata.content_length
            : typeof metadata?.char_count === 'number'
              ? metadata.char_count
              : 0;

        allItems.push({
          ...item,
          content_length: contentLength,
        } as ContentItemRow);
      }

      if (LIMIT > 0 && allItems.length >= LIMIT) break;
      if (items.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  }

  if (LIMIT > 0 && allItems.length > LIMIT) {
    allItems.length = LIMIT;
  }

  if (allItems.length === 0) {
    console.log('No content items need layer backfill.');
    return;
  }

  console.log(`Found ${allItems.length} items needing layer assignment`);
  console.log();

  // ── Step 2: Process each item ───────────────────────────────────────────

  let copiedFromMetadata = 0;
  let inferred = 0;
  let errors = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const metadata = item.metadata as Record<string, unknown> | null;

    let layer: string;
    let source: string;

    // Path A: Copy from metadata if present
    if (metadata?.layer && typeof metadata.layer === 'string') {
      layer = metadata.layer;
      source = 'metadata';
      copiedFromMetadata++;
    } else {
      // Path B: Infer using layer-inference.ts
      const ingestionSource =
        (metadata?.ingestion_source as string) ||
        (item.platform === 'extraction' ? 'bid_library' : 'manual');

      const input: LayerInferenceInput = {
        contentType: item.content_type || '',
        contentLength: item.content_length || 0,
        ingestionSource: ingestionSource as
          | 'manual'
          | 'url_import'
          | 'upload'
          | 'bid_library',
        hasBrief: !!item.brief,
        hasDetail: !!item.detail,
        hasReference: !!item.reference,
        isBidDiscovered: false,
        title: item.title || '',
      };

      const suggestion = inferLayer(input);
      layer = suggestion.suggestedLayer;
      source = `inferred (${suggestion.confidence})`;
      inferred++;
    }

    if (DRY_RUN) {
      if (i < 10 || i % 100 === 0) {
        console.log(
          `  [${i + 1}/${allItems.length}] ${item.id.slice(0, 8)}... → ${layer} (${source})`,
        );
      }
      continue;
    }

    // Write to database
    const { error: updateError } = await supabase
      .from('content_items')
      .update({ layer })
      .eq('id', item.id);

    if (updateError) {
      console.error(`  ERROR updating ${item.id}: ${updateError.message}`);
      errors++;
    } else if (i < 10 || i % 100 === 0) {
      console.log(
        `  [${i + 1}/${allItems.length}] ${item.id.slice(0, 8)}... → ${layer} (${source})`,
      );
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(
    `  Copied from metadata: ${copiedFromMetadata}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(
    `  Inferred:             ${inferred}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Errors:               ${errors}`);
  console.log(`  Total:                ${allItems.length}`);
  if (DRY_RUN) {
    console.log();
    console.log('  This was a dry run. Use --apply to write changes.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
