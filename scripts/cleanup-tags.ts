#!/usr/bin/env bun
/**
 * Tag vocabulary cleanup script.
 *
 * Identifies and removes problematic AI keywords:
 *   (a) 3+ word singleton tags used only on q_a_pair items
 *   (b) Synonym clusters that should be merged to a canonical form
 *
 * Usage:
 *   bun run scripts/cleanup-tags.ts              # dry run (default)
 *   bun run scripts/cleanup-tags.ts --apply       # write changes to database
 *   bun run scripts/cleanup-tags.ts --help        # show usage
 */

import { normaliseTag } from '../lib/validation/schemas';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';

// ── Synonym merge mappings ───────────────────────────────────────────────────

/**
 * Map of source tag -> canonical tag. Each source tag will be replaced
 * with its canonical form when found in ai_keywords arrays.
 */
export const SYNONYM_MERGES: Record<string, string> = {
  'UK GDPR': 'GDPR',
  'GDPR compliance': 'GDPR',
  'GDPR training': 'GDPR',
  'regulatory compliance': 'compliance',
  'policy compliance': 'compliance',
  'data protection officer': 'data protection',
  'data protection impact assessment': 'data protection',
  'information security policy': 'information security',
  'ISO 27001:2022': 'ISO 27001',
  'Cyber Essentials': 'Cyber Essentials Plus',
};

// ── Core logic (exported for testing) ────────────────────────────────────────

/**
 * Apply synonym merges to an array of keywords.
 * Returns a deduplicated array with merged tags.
 */
export function applySynonymMerges(
  keywords: string[],
  merges: Record<string, string>,
): string[] {
  const merged = keywords.map((kw) => {
    // Check case-insensitive match against merge keys
    const matchKey = Object.keys(merges).find(
      (key) => key.toLowerCase() === kw.toLowerCase(),
    );
    return matchKey ? merges[matchKey] : kw;
  });
  // Deduplicate — a merge might create duplicates
  return [...new Set(merged)];
}

/**
 * Identify 3+ word singleton tags that only appear on q_a_pair items.
 * Returns the set of tags to remove.
 */
export function identifySingletonQATags(
  items: Array<{
    id: string;
    ai_keywords: string[];
    content_type: string | null;
  }>,
): Set<string> {
  // Count tag usage and track which content types use each tag
  const tagCounts = new Map<string, number>();
  const tagContentTypes = new Map<string, Set<string>>();

  for (const item of items) {
    for (const kw of item.ai_keywords) {
      tagCounts.set(kw, (tagCounts.get(kw) || 0) + 1);
      if (!tagContentTypes.has(kw)) {
        tagContentTypes.set(kw, new Set());
      }
      tagContentTypes.get(kw)!.add(item.content_type || 'unknown');
    }
  }

  const toRemove = new Set<string>();

  for (const [tag, count] of tagCounts) {
    // Only singletons (used exactly once)
    if (count !== 1) continue;
    // Only 3+ word tags
    const wordCount = tag.trim().split(/\s+/).length;
    if (wordCount < 3) continue;
    // Only tags used exclusively on q_a_pair items
    const types = tagContentTypes.get(tag)!;
    if (types.size === 1 && types.has('q_a_pair')) {
      toRemove.add(tag);
    }
  }

  return toRemove;
}

/**
 * Process a single item's keywords: remove singletons and apply merges.
 * Returns null if no changes, or the new keywords array if changed.
 */
export function processItemKeywords(
  keywords: string[],
  singletonTags: Set<string>,
  merges: Record<string, string>,
): string[] | null {
  // Step 1: Remove singleton tags
  const afterRemoval = keywords.filter((kw) => !singletonTags.has(kw));

  // Step 2: Apply synonym merges
  const afterMerge = applySynonymMerges(afterRemoval, merges);

  // Step 3: Canonicalise via normaliseTag (spec ss6.6 EP10).
  // Ensures merge outputs (e.g. synonym canonical forms) are in normalised form.
  const afterNormalise = [
    ...new Set(afterMerge.map(normaliseTag).filter((kw) => kw.length > 0)),
  ];

  // Check if anything changed
  if (
    afterNormalise.length === keywords.length &&
    afterNormalise.every((kw, i) => kw === keywords[i])
  ) {
    return null;
  }

  return afterNormalise;
}

// ── Script entry point (only runs when executed directly) ────────────────────

if (process.argv[1]?.endsWith('cleanup-tags.ts')) {
  runCli();
}

async function runCli() {
  const { parseArgs } = await import('util');
  const path = await import('path');
  const fs = await import('fs');

  // ── Env loading (handles worktrees) ────────────────────────────────────

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

  // ── --env=prod opt-in (WP-S5.3 D-21 F-1) ───────────────────────────────

  function assertEnvFlag(env: string, url: string | undefined): void {
    if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
      console.error(
        `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
          `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/cleanup-tags.ts --env=prod`,
      );
      process.exit(1);
    }
  }

  // ── Args ───────────────────────────────────────────────────────────────

  const { values: args } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      env: { type: 'string', default: '' },
    },
    strict: true,
  });

  if (args.help) {
    console.log(`
Usage: bun run scripts/cleanup-tags.ts [options]

Options:
  --apply       Write changes to the database (default is dry run)
  --env=prod    Asserts SUPABASE_URL points at current prod
                (the client production project; ref from PROD_PROJECT_REF). Override invocation:
                SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key>
                bun run scripts/cleanup-tags.ts --env=prod
  --help        Show this help
`);
    process.exit(0);
  }

  const DRY_RUN = !args.apply;

  // ── Supabase client ────────────────────────────────────────────────────

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

  const supabase = createScriptClient(supabaseUrl, supabaseKey);

  // ── Main logic ─────────────────────────────────────────────────────────

  console.log('='.repeat(60));
  console.log('Tag Vocabulary Cleanup');
  console.log('='.repeat(60));
  console.log(
    `  Mode: ${DRY_RUN ? 'DRY RUN (use --apply to write)' : 'APPLY'}`,
  );
  console.log();

  // Fetch all content items with ai_keywords
  const { data: items, error } = await supabase
    .from('content_items')
    .select('id, ai_keywords, content_type')
    .not('ai_keywords', 'is', null)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log('No content items with ai_keywords found.');
    return;
  }

  // Filter to items that actually have keywords
  const eligible = items.filter(
    (item: { ai_keywords: unknown }) =>
      Array.isArray(item.ai_keywords) && item.ai_keywords.length > 0,
  );

  // Compute before-state stats
  const allTagsBefore = new Set<string>();
  for (const item of eligible) {
    for (const kw of (item as { ai_keywords: string[] }).ai_keywords) {
      allTagsBefore.add(kw);
    }
  }

  console.log(`Content items with keywords: ${eligible.length}`);
  console.log(`Unique tags before cleanup:  ${allTagsBefore.size}`);
  console.log();

  // Identify singleton Q&A tags
  const singletonTags = identifySingletonQATags(
    eligible as Array<{
      id: string;
      ai_keywords: string[];
      content_type: string | null;
    }>,
  );
  console.log(
    `3+ word Q&A-only singleton tags to remove: ${singletonTags.size}`,
  );
  if (singletonTags.size > 0) {
    const sorted = [...singletonTags].sort();
    for (const tag of sorted.slice(0, 20)) {
      console.log(`  - "${tag}"`);
    }
    if (sorted.length > 20) {
      console.log(`  ... and ${sorted.length - 20} more`);
    }
  }
  console.log();

  // Show synonym merges
  const mergeEntries = Object.entries(SYNONYM_MERGES);
  console.log(`Synonym merge rules: ${mergeEntries.length}`);
  for (const [from, to] of mergeEntries) {
    console.log(`  "${from}" \u2192 "${to}"`);
  }
  console.log();

  // Process each item
  let updatedCount = 0;
  let errorCount = 0;
  const allTagsAfter = new Set<string>();

  for (const rawItem of eligible) {
    const item = rawItem as {
      id: string;
      ai_keywords: string[];
      content_type: string | null;
    };
    const newKeywords = processItemKeywords(
      item.ai_keywords,
      singletonTags,
      SYNONYM_MERGES,
    );

    if (newKeywords) {
      updatedCount++;

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('content_items')
          .update({ ai_keywords: newKeywords })
          .eq('id', item.id);

        if (updateError) {
          console.error(`  ERROR updating ${item.id}: ${updateError.message}`);
          errorCount++;
        }
      }

      // Track after-state
      for (const kw of newKeywords) {
        allTagsAfter.add(kw);
      }
    } else {
      // Unchanged — add existing keywords to after-state
      for (const kw of item.ai_keywords) {
        allTagsAfter.add(kw);
      }
    }
  }

  // Summary
  console.log('='.repeat(60));
  console.log('CLEANUP COMPLETE');
  console.log('='.repeat(60));
  console.log(
    `  Items updated:           ${updatedCount}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Errors:                  ${errorCount}`);
  console.log(`  Unique tags before:      ${allTagsBefore.size}`);
  console.log(`  Unique tags after:       ${allTagsAfter.size}`);
  console.log(
    `  Tags removed/merged:     ${allTagsBefore.size - allTagsAfter.size}`,
  );
  if (DRY_RUN) {
    console.log();
    console.log('  This was a dry run. Use --apply to write changes.');
  }
}
