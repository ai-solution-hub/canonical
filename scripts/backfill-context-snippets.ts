#!/usr/bin/env bun
/**
 * Backfill context_snippet for entity mentions.
 *
 * All 289 entity mentions currently have NULL context_snippet values.
 * This script populates them using a two-pass approach:
 *
 *   Pass 1: Exact match — search for canonical_name (case-insensitive) in
 *           the source content text. Also tries entity_name if different.
 *           Expected coverage: ~67%.
 *
 *   Pass 2: Alias match — look up aliases from entity_aliases table and
 *           search for each alias in the content text.
 *           Expected additional coverage: ~13-18%.
 *
 * Context snippets are extracted as ~80 chars of surrounding context
 * (40 chars before + match + 40 chars after), per the entity audit
 * recommendation (docs/reference/entity-audit-s126.md §5).
 *
 * Usage:
 *   bun run scripts/backfill-context-snippets.ts                # process all
 *   bun run scripts/backfill-context-snippets.ts --limit 50     # process first 50
 *   bun run scripts/backfill-context-snippets.ts --dry-run      # preview without writing
 *   bun run scripts/backfill-context-snippets.ts --help         # show help
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
    limit: { type: 'string', default: '0' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/backfill-context-snippets.ts [options]

Options:
  --limit N    Max entity mentions to process (0 = all with NULL context_snippet)
  --dry-run    Preview what would be updated without writing to database
  --help       Show this help
`);
  process.exit(0);
}

const LIMIT = parseInt(args.limit!, 10) || 0;
const DRY_RUN = args['dry-run']!;

// ── Supabase client ────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in environment',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Types ──────────────────────────────────────────────────────────────────

interface EntityMention {
  id: string;
  content_item_id: string;
  entity_type: string;
  entity_name: string;
  canonical_name: string;
  context_snippet: string | null;
}

interface ContentItem {
  id: string;
  content: string;
  title: string;
}

interface EntityAlias {
  alias: string;
  canonical: string;
}

// ── Context snippet extraction ─────────────────────────────────────────────

/**
 * Extract a context snippet from text around a match position.
 * Returns ~80 chars of surrounding context (40 before + match + 40 after).
 * Follows the pattern from lib/date-extraction.ts extractContextSnippet().
 */
function extractContextSnippet(
  text: string,
  position: number,
  matchLength: number,
): string {
  const snippetPadding = 40;
  const start = Math.max(0, position - snippetPadding);
  const end = Math.min(text.length, position + matchLength + snippetPadding);

  let snippet = text.slice(start, end).trim();
  // Replace newlines and multiple spaces with a single space
  snippet = snippet.replace(/\s+/g, ' ');
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Search for a term (case-insensitive) in the text and return the context
 * snippet if found. Returns null if not found.
 */
function findAndExtract(text: string, searchTerm: string): string | null {
  const lowerText = text.toLowerCase();
  const lowerTerm = searchTerm.toLowerCase();
  const pos = lowerText.indexOf(lowerTerm);

  if (pos < 0) return null;

  return extractContextSnippet(text, pos, searchTerm.length);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Entity Context Snippet Backfill');
  console.log('='.repeat(60));
  console.log(`  Limit:    ${LIMIT || 'all'}`);
  console.log(`  Dry run:  ${DRY_RUN}`);
  console.log();

  // ── Step 1: Fetch entity mentions with NULL context_snippet ──

  console.log('Fetching entity mentions with NULL context_snippet...');

  let mentionQuery = supabase
    .from('entity_mentions')
    .select(
      'id, content_item_id, entity_type, entity_name, canonical_name, context_snippet',
    )
    .is('context_snippet', null)
    .order('created_at', { ascending: true });

  if (LIMIT > 0) {
    mentionQuery = mentionQuery.limit(LIMIT);
  } else {
    mentionQuery = mentionQuery.limit(1000); // Well above the 289 total
  }

  const { data: mentions, error: mentionError } = await mentionQuery;

  if (mentionError) {
    console.error('Failed to fetch entity mentions:', mentionError.message);
    process.exit(1);
  }

  if (!mentions || mentions.length === 0) {
    console.log(
      'No entity mentions with NULL context_snippet found. Nothing to do.',
    );
    return;
  }

  console.log(`  Found ${mentions.length} entity mentions to process`);
  console.log();

  // ── Step 2: Fetch all content items referenced by the mentions ──

  const contentItemIds = [
    ...new Set((mentions as EntityMention[]).map((m) => m.content_item_id)),
  ];
  console.log(
    `Fetching content for ${contentItemIds.length} unique content items...`,
  );

  // Fetch in batches of 100 to avoid query size limits
  const contentMap = new Map<string, ContentItem>();
  for (let i = 0; i < contentItemIds.length; i += 100) {
    const batch = contentItemIds.slice(i, i + 100);
    const { data: contentItems, error: contentError } = await supabase
      .from('content_items')
      .select('id, content, title')
      .in('id', batch);

    if (contentError) {
      console.error('Failed to fetch content items:', contentError.message);
      process.exit(1);
    }

    if (contentItems) {
      for (const item of contentItems as ContentItem[]) {
        contentMap.set(item.id, item);
      }
    }
  }

  console.log(`  Loaded ${contentMap.size} content items`);
  console.log();

  // ── Step 3: Fetch all entity aliases ──

  console.log('Fetching entity aliases...');

  const { data: aliases, error: aliasError } = await supabase
    .from('entity_aliases')
    .select('alias, canonical')
    .eq('is_active', true)
    .limit(1000);

  if (aliasError) {
    console.error('Failed to fetch entity aliases:', aliasError.message);
    process.exit(1);
  }

  // Build a map: canonical name -> list of aliases
  const aliasMap = new Map<string, string[]>();
  if (aliases) {
    for (const a of aliases as EntityAlias[]) {
      const key = a.canonical.toLowerCase();
      if (!aliasMap.has(key)) {
        aliasMap.set(key, []);
      }
      aliasMap.get(key)!.push(a.alias);
    }
  }

  console.log(
    `  Loaded ${aliases?.length ?? 0} aliases for ${aliasMap.size} canonical names`,
  );
  console.log();

  // ── Step 4: Process each entity mention ──

  console.log('Processing entity mentions...');
  console.log();

  let pass1Matches = 0;
  let pass2Matches = 0;
  let noContent = 0;
  let unmatched = 0;
  let updateErrors = 0;
  const startTime = Date.now();

  const typedMentions = mentions as EntityMention[];

  for (let i = 0; i < typedMentions.length; i++) {
    const mention = typedMentions[i];
    const progress = `[${String(i + 1).padStart(String(typedMentions.length).length)}/${typedMentions.length}]`;

    const contentItem = contentMap.get(mention.content_item_id);

    if (!contentItem || (!contentItem.content && !contentItem.title)) {
      console.log(
        `${progress} SKIP (no content) | ${mention.entity_type}: ${mention.canonical_name}`,
      );
      noContent++;
      continue;
    }

    // Use content field, falling back to title
    const searchText = contentItem.content || contentItem.title;

    let snippet: string | null = null;
    let matchPass = 0;

    // ── Pass 1: Exact match on canonical_name ──
    snippet = findAndExtract(searchText, mention.canonical_name);
    if (snippet) {
      matchPass = 1;
    }

    // ── Pass 1b: Try entity_name if different from canonical_name ──
    if (
      !snippet &&
      mention.entity_name.toLowerCase() !== mention.canonical_name.toLowerCase()
    ) {
      snippet = findAndExtract(searchText, mention.entity_name);
      if (snippet) {
        matchPass = 1;
      }
    }

    // ── Pass 2: Alias match ──
    if (!snippet) {
      const entityAliases = aliasMap.get(mention.canonical_name.toLowerCase());
      if (entityAliases) {
        for (const alias of entityAliases) {
          snippet = findAndExtract(searchText, alias);
          if (snippet) {
            matchPass = 2;
            break;
          }
        }
      }
    }

    // ── Log result ──
    if (snippet) {
      const passLabel = matchPass === 1 ? 'Pass 1' : 'Pass 2 (alias)';
      const truncatedSnippet =
        snippet.length > 80 ? snippet.slice(0, 77) + '...' : snippet;
      console.log(
        `${progress} ${passLabel} | ${mention.entity_type}: ${mention.canonical_name}`,
      );
      console.log(`         "${truncatedSnippet}"`);

      if (matchPass === 1) pass1Matches++;
      else pass2Matches++;

      // ── Update the entity mention ──
      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('entity_mentions')
          .update({ context_snippet: snippet })
          .eq('id', mention.id);

        if (updateError) {
          console.log(`         ERROR: ${updateError.message}`);
          updateErrors++;
        }
      }
    } else {
      console.log(
        `${progress} NO MATCH | ${mention.entity_type}: ${mention.canonical_name}`,
      );
      unmatched++;
    }
  }

  // ── Step 5: Report results ──

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalMatched = pass1Matches + pass2Matches;
  const totalProcessed = typedMentions.length;
  const coveragePercent =
    totalProcessed > 0
      ? ((totalMatched / totalProcessed) * 100).toFixed(1)
      : '0';

  console.log();
  console.log('='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(
    `  Total processed:    ${totalProcessed}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Pass 1 matches:     ${pass1Matches} (exact name match)`);
  console.log(`  Pass 2 matches:     ${pass2Matches} (alias match)`);
  console.log(`  Total matched:      ${totalMatched} (${coveragePercent}%)`);
  console.log(`  No content:         ${noContent}`);
  console.log(`  Unmatched:          ${unmatched}`);
  if (!DRY_RUN) {
    console.log(`  Update errors:      ${updateErrors}`);
  }
  console.log(`  Time:               ${elapsed}s`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
