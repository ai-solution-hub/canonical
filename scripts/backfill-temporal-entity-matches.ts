#!/usr/bin/env bun
/**
 * Backfill temporal-entity matches using AI.
 *
 * For content items that have both temporal references and cert/framework/regulation
 * entity mentions but no bridged dates, this script sends each to Claude to explicitly
 * match temporal references to entities. Much cheaper than re-running full classification.
 *
 * Usage:
 *   bun run scripts/backfill-temporal-entity-matches.ts                   # process all eligible
 *   bun run scripts/backfill-temporal-entity-matches.ts --limit 10        # process max 10
 *   bun run scripts/backfill-temporal-entity-matches.ts --dry-run         # preview without writing
 *   bun run scripts/backfill-temporal-entity-matches.ts --item-id UUID    # process single item
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
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
    limit: { type: 'string', default: '0' },
    'dry-run': { type: 'boolean', default: false },
    'item-id': { type: 'string', default: '' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-temporal-entity-matches.ts [options]

Options:
  --limit N      Max items to process (0 = all eligible)
  --dry-run      Preview matches without writing to database
  --item-id UUID Process a single item by ID
  --help         Show this help
`);
  process.exit(0);
}

const LIMIT = parseInt(args.limit!, 10) || 0;
const DRY_RUN = args['dry-run']!;
const ITEM_ID = args['item-id'] || '';
const CONFIDENCE_THRESHOLD = 0.7;
const DELAY_MS = 500;

// ── Supabase client ──────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in environment',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Anthropic client ─────────────────────────────────────────────────────

const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) {
  console.error('Missing ANTHROPIC_API_KEY in environment');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: anthropicKey });
const AI_MODEL = process.env.AI_SUMMARY_MODEL || 'claude-sonnet-4-6';

// ── Types ────────────────────────────────────────────────────────────────

interface TemporalRef {
  date: string;
  context: string;
  context_type: string;
  related_entity?: string;
}

interface EntityMention {
  id: string;
  canonical_name: string;
  entity_type: string;
  metadata: Record<string, unknown> | null;
}

interface ClaudeMatch {
  temporal_ref_index: number;
  entity_canonical_name: string;
  context_type: string;
  confidence: number;
}

// ── Duration handling ────────────────────────────────────────────────────

function isDuration(date: string): boolean {
  return /^P\d/.test(date);
}

function addDurationToDate(startDate: string, duration: string): string | null {
  const match = duration.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/);
  if (!match) return null;

  const years = match[1] ? parseInt(match[1], 10) : 0;
  const months = match[2] ? parseInt(match[2], 10) : 0;
  const days = match[3] ? parseInt(match[3], 10) : 0;
  if (years === 0 && months === 0 && days === 0) return null;

  const date = new Date(startDate + 'T00:00:00Z');
  if (isNaN(date.getTime())) return null;

  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() + days);

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── Claude matching ──────────────────────────────────────────────────────

async function matchTemporalRefsToEntities(
  temporalRefs: TemporalRef[],
  entities: { canonical_name: string; entity_type: string }[],
): Promise<ClaudeMatch[]> {
  const prompt = `You are matching temporal references (dates) to entities for a UK SMB knowledge base.

Given the following temporal references extracted from a content item:
${JSON.stringify(temporalRefs, null, 2)}

And the following entities extracted from the same content item:
${JSON.stringify(
  entities.map((e) => ({
    canonical_name: e.canonical_name,
    entity_type: e.entity_type,
  })),
  null,
  2,
)}

For each temporal reference, determine which entity (if any) it relates to.
Return a JSON array of matches. Only include matches where you are confident
the temporal reference directly relates to the entity (e.g. an expiry date
for a specific certification, an effective date for a specific regulation).
Do not guess — omit uncertain matches.

Each match should have:
- temporal_ref_index: the 0-based index into the temporal references array
- entity_canonical_name: the canonical_name of the matched entity
- context_type: the temporal reference's context_type (expiry, effective, historical, unknown)
- confidence: your confidence in this match (0.0-1.0)

Return ONLY a JSON array, no other text.`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';
  return parseClaudeResponse(text);
}

/** Parse Claude's JSON array response, handling code blocks and edge cases. */
function parseClaudeResponse(text: string): ClaudeMatch[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        'temporal_ref_index' in m &&
        'entity_canonical_name' in m &&
        'confidence' in m,
    ) as ClaudeMatch[];
  } catch {
    console.error('Failed to parse Claude response:', cleaned.slice(0, 200));
    return [];
  }
}

// ── Sleep utility ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Temporal-Entity AI Matching Backfill');
  console.log('='.repeat(60));
  console.log(`  Model:    ${AI_MODEL}`);
  console.log(`  Limit:    ${LIMIT || 'all'}`);
  console.log(`  Dry run:  ${DRY_RUN}`);
  if (ITEM_ID) console.log(`  Item ID:  ${ITEM_ID}`);
  console.log();

  // 1. Fetch candidate items
  const TEMPORAL_ENTITY_TYPES = ['certification', 'framework', 'regulation'];

  let query = supabase
    .from('content_items')
    .select('id, suggested_title, metadata')
    .not('metadata->ai_temporal_references', 'is', null)
    .order('captured_date', { ascending: false });

  if (ITEM_ID) {
    query = query.eq('id', ITEM_ID);
  } else if (LIMIT > 0) {
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
  let totalMatches = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const metadata = item.metadata as Record<string, unknown>;
    const temporalRefs = metadata?.ai_temporal_references as
      | TemporalRef[]
      | undefined;

    if (!temporalRefs?.length) continue;

    // 2. Fetch entity mentions for this item
    const { data: mentions, error: mentionError } = await supabase
      .from('entity_mentions')
      .select('id, canonical_name, entity_type, metadata')
      .eq('content_item_id', item.id)
      .in('entity_type', TEMPORAL_ENTITY_TYPES);

    if (mentionError) {
      console.error(
        `  ERROR fetching mentions for ${item.id}: ${mentionError.message}`,
      );
      totalErrors++;
      continue;
    }

    if (!mentions?.length) continue;

    // Filter to entities without bridged dates (idempotency)
    const unbridgedMentions = mentions.filter((m) => {
      const meta = (m.metadata as Record<string, unknown>) ?? {};
      return !meta.expiry_date && !meta.date_obtained;
    });

    if (!unbridgedMentions.length) continue;

    const title = (item.suggested_title || '(untitled)').slice(0, 70);
    const progress = `[${i + 1}/${items.length}]`;
    console.log(`${progress} ${title}`);

    // 3. Send to Claude for matching
    try {
      const matches = await matchTemporalRefsToEntities(
        temporalRefs,
        unbridgedMentions.map((m) => ({
          canonical_name: m.canonical_name,
          entity_type: m.entity_type,
        })),
      );

      totalMatches += matches.length;

      for (const match of matches) {
        if (match.confidence < CONFIDENCE_THRESHOLD) {
          console.log(
            `    SKIP (low confidence ${match.confidence.toFixed(2)}): ${match.entity_canonical_name}`,
          );
          continue;
        }

        const ref = temporalRefs[match.temporal_ref_index];
        if (!ref) {
          console.log(
            `    SKIP: invalid temporal_ref_index ${match.temporal_ref_index}`,
          );
          continue;
        }

        // Find the matching entity mention
        const mention = unbridgedMentions.find(
          (m) =>
            m.canonical_name.toLowerCase() ===
            match.entity_canonical_name.toLowerCase(),
        );
        if (!mention) {
          console.log(
            `    SKIP: no entity mention found for "${match.entity_canonical_name}"`,
          );
          continue;
        }

        const existingMetadata =
          (mention.metadata as Record<string, unknown>) ?? {};
        const newMetadata = { ...existingMetadata };

        const contextType = match.context_type || ref.context_type;

        if (contextType === 'expiry') {
          if (isDuration(ref.date)) {
            const startDate = (newMetadata.date_obtained as string) ?? null;
            if (startDate) {
              const computedDate = addDurationToDate(startDate, ref.date);
              if (computedDate) {
                newMetadata.expiry_date = computedDate;
              } else {
                console.log(
                  `    SKIP: could not compute date from duration ${ref.date}`,
                );
                continue;
              }
            } else {
              console.log(
                `    SKIP: duration ${ref.date} but no date_obtained for ${mention.canonical_name}`,
              );
              continue;
            }
          } else {
            newMetadata.expiry_date = ref.date;
          }
        } else if (contextType === 'effective') {
          newMetadata.date_obtained = ref.date;
        } else {
          // historical/unknown — not useful for entity metadata
          continue;
        }

        console.log(
          `    Match: ${mention.canonical_name} (${mention.entity_type}) <- "${ref.context}" (${contextType}, ${ref.date}, confidence: ${match.confidence.toFixed(2)})`,
        );

        if (DRY_RUN) {
          const dateField =
            contextType === 'expiry' ? 'expiry_date' : 'date_obtained';
          const dateValue =
            contextType === 'expiry'
              ? newMetadata.expiry_date
              : newMetadata.date_obtained;
          console.log(
            `    [DRY RUN] Would write ${dateField}=${dateValue} for ${mention.canonical_name}`,
          );
        } else {
          const { error: updateError } = await supabase
            .from('entity_mentions')
            .update({ metadata: newMetadata as Record<string, string> })
            .eq('id', mention.id);

          if (updateError) {
            console.log(
              `    ERROR updating ${mention.id}: ${updateError.message}`,
            );
            totalErrors++;
            continue;
          }
        }

        totalUpdated++;
      }

      totalProcessed++;
    } catch (err) {
      console.error(`    ERROR processing item: ${err}`);
      totalErrors++;
    }

    // Rate limiting
    if (i < items.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Items processed:    ${totalProcessed}`);
  console.log(`  Matches found:      ${totalMatches}`);
  console.log(
    `  Entities updated:   ${totalUpdated}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Errors:             ${totalErrors}`);
  console.log(`  Time:               ${elapsed}s`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
