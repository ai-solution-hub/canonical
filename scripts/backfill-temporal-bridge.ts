#!/usr/bin/env bun
/**
 * Backfill temporal-to-entity bridge for Python-ingested content.
 *
 * The Python pipeline stores temporal references in
 * content_items.metadata.ai_temporal_references but never bridges them
 * to entity mentions. The TypeScript bridge
 * (lib/entities/entity-metadata-bridge.ts) matches temporal references
 * to certification/framework/regulation entity mentions and writes
 * expiry/effective dates into entity_mentions.metadata.
 *
 * This script runs that bridge retroactively on all Python-ingested
 * content that has temporal references but whose entity mentions lack
 * expiry_date metadata.
 *
 * Usage:
 *   bun run scripts/backfill-temporal-bridge.ts                # process all eligible
 *   bun run scripts/backfill-temporal-bridge.ts --limit 10     # process max 10
 *   bun run scripts/backfill-temporal-bridge.ts --dry-run      # preview without writing
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { reconcileTemporalReferences } from '../lib/entities/temporal-reconciliation';
import {
  tokenMatch,
  isDuration,
  addDurationToDate,
} from '../lib/entities/token-match';
import type { ClassificationTemporalReference } from '../lib/ai/classify';
import type { TemporalReference } from '../lib/date-extraction';

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
    limit: { type: 'string', default: '0' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-temporal-bridge.ts [options]

Options:
  --limit N    Max items to process (0 = all eligible)
  --dry-run    Preview without writing to database
  --help       Show this help
`);
  process.exit(0);
}

const LIMIT = parseInt(args.limit!, 10) || 0;
const DRY_RUN = args['dry-run']!;

// ── Entity types that receive temporal metadata ───────────────────────────

const TEMPORAL_ENTITY_TYPES = ['certification', 'framework', 'regulation'];

// ── Supabase client ──────────────────────────────────────────────────────

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

// ── Sort refs so effective dates come before expiry ─────────────────────

function sortRefsEffectiveFirst<T extends { context_type: string }>(
  refs: T[],
): T[] {
  return [...refs].sort((a, b) => {
    if (a.context_type === 'effective' && b.context_type !== 'effective')
      return -1;
    if (a.context_type !== 'effective' && b.context_type === 'effective')
      return 1;
    return 0;
  });
}

// ── Bridge logic (inlined from entity-metadata-bridge.ts to avoid ──────
//    Next.js server imports, but using the same token-match + reconciliation)

interface EntityMention {
  id: string;
  canonical_name: string;
  entity_type: string;
  metadata: Record<string, unknown> | null;
}

async function bridgeForItem(
  contentItemId: string,
  aiRefs: ClassificationTemporalReference[],
  mentions: EntityMention[],
  dryRun: boolean,
): Promise<{ updated: number; details: string[] }> {
  const details: string[] = [];
  let updated = 0;

  // Reconcile — Python items only have AI refs (no regex refs)
  const mergedRefs = reconcileTemporalReferences(aiRefs, undefined);
  if (!mergedRefs.length) return { updated, details };

  const sortedRefs = sortRefsEffectiveFirst(mergedRefs);

  for (const mention of mentions) {
    const existingMetadata =
      (mention.metadata as Record<string, unknown>) ?? {};

    // Skip if already has expiry_date or date_obtained
    if (existingMetadata.expiry_date || existingMetadata.date_obtained) {
      details.push(
        `  SKIP: ${mention.canonical_name} — already has temporal metadata`,
      );
      continue;
    }

    let mentionUpdated = false;
    const newMetadata = { ...existingMetadata };

    for (const ref of sortedRefs) {
      const result = tokenMatch(ref.context, mention.canonical_name);
      if (!result.match) continue;

      if (ref.context_type === 'expiry') {
        if (isDuration(ref.date)) {
          const startDate = (newMetadata.date_obtained as string) ?? null;
          if (startDate) {
            const computedDate = addDurationToDate(startDate, ref.date);
            if (computedDate) {
              newMetadata.expiry_date = computedDate;
              mentionUpdated = true;
            }
          }
        } else {
          newMetadata.expiry_date = ref.date;
          mentionUpdated = true;
        }
      } else if (ref.context_type === 'effective') {
        newMetadata.date_obtained = ref.date;
        mentionUpdated = true;
      }
    }

    if (mentionUpdated) {
      const dateInfo = [
        newMetadata.expiry_date ? `expiry=${newMetadata.expiry_date}` : null,
        newMetadata.date_obtained
          ? `obtained=${newMetadata.date_obtained}`
          : null,
      ]
        .filter(Boolean)
        .join(', ');

      details.push(
        `  UPDATE: ${mention.canonical_name} (${mention.entity_type}) — ${dateInfo}`,
      );

      if (!dryRun) {
        const { error } = await supabase
          .from('entity_mentions')
          .update({ metadata: newMetadata as Record<string, string> })
          .eq('id', mention.id);

        if (error) {
          details.push(`  ERROR updating ${mention.id}: ${error.message}`);
          continue;
        }
      }

      updated++;
    }
  }

  return { updated, details };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Temporal Bridge Backfill');
  console.log('='.repeat(60));
  console.log(`  Limit:    ${LIMIT || 'all'}`);
  console.log(`  Dry run:  ${DRY_RUN}`);
  console.log();

  // 1. Find content items with ai_temporal_references
  //    We fetch all items that have temporal refs, then check their
  //    entity mentions in-loop for missing bridged data.
  let query = supabase
    .from('content_items')
    .select('id, suggested_title, metadata')
    .not('metadata->ai_temporal_references', 'is', null)
    .order('captured_date', { ascending: false });

  if (LIMIT > 0) {
    query = query.limit(LIMIT);
  } else {
    query = query.limit(500);
  }

  const { data: items, error } = await query;

  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log('No content items with ai_temporal_references found.');
    return;
  }

  console.log(`Found ${items.length} content items with temporal references`);
  console.log();

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const metadata = item.metadata as Record<string, unknown>;
    const aiRefs = metadata?.ai_temporal_references as
      | ClassificationTemporalReference[]
      | undefined;

    if (!aiRefs?.length) {
      continue;
    }

    const progress = `[${i + 1}/${items.length}]`;
    const title = (item.suggested_title || '(untitled)').slice(0, 60);
    console.log(`${progress} ${title}`);
    console.log(`         ${aiRefs.length} temporal ref(s)`);

    // 2. Fetch entity mentions for this item
    const { data: mentions, error: mentionError } = await supabase
      .from('entity_mentions')
      .select('id, canonical_name, entity_type, metadata')
      .eq('content_item_id', item.id)
      .in('entity_type', TEMPORAL_ENTITY_TYPES);

    if (mentionError) {
      console.log(`         ERROR fetching mentions: ${mentionError.message}`);
      totalErrors++;
      continue;
    }

    if (!mentions?.length) {
      console.log(
        '         SKIP: no certification/framework/regulation mentions',
      );
      totalSkipped++;
      continue;
    }

    console.log(`         ${mentions.length} eligible mention(s)`);

    // 3. Run the bridge
    const { updated, details } = await bridgeForItem(
      item.id,
      aiRefs,
      mentions,
      DRY_RUN,
    );

    for (const detail of details) {
      console.log(detail);
    }

    if (updated === 0) {
      console.log('         No matches found');
      totalSkipped++;
    } else {
      totalUpdated += updated;
    }

    totalProcessed++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Items processed:    ${totalProcessed}`);
  console.log(
    `  Mentions updated:   ${totalUpdated}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Items skipped:      ${totalSkipped}`);
  console.log(`  Errors:             ${totalErrors}`);
  console.log(`  Time:               ${elapsed}s`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
