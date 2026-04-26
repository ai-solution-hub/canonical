/**
 * Batch AI Summary Generation
 *
 * Generates multi-level summaries (executive, detailed, takeaways) for content
 * items that don't have them yet. Uses the shared callSummaryAI() function from
 * the AI service layer.
 *
 * Usage:
 *   bun run scripts/batch_generate_summaries.ts --limit 20
 *   bun run scripts/batch_generate_summaries.ts --limit 50 --batch-size 3
 *   bun run scripts/batch_generate_summaries.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { callSummaryAI } from '@/lib/ai/summarise';
import type { SummaryData } from '@/types/content';

// ── Env loading ──

function loadEnvFile(path: string): void {
  try {
    const content = Bun.file(path).textSync();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // Don't override existing env vars (so .env.local takes priority if loaded second)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist -- that's fine
  }
}

// Load .env.local first (higher priority), then .env
const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ── CLI args ──

function parseArgs(): { limit: number; dryRun: boolean; batchSize: number } {
  const args = process.argv.slice(2);
  let limit = 20;
  let dryRun = false;
  let batchSize = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (isNaN(limit) || limit < 1) limit = 20;
  if (isNaN(batchSize) || batchSize < 1) batchSize = 5;
  // Cap concurrent requests at 5
  if (batchSize > 5) batchSize = 5;

  return { limit, dryRun, batchSize };
}

// ── Constants ──

// Content type priority ordering (lower index = higher priority)
const CONTENT_TYPE_PRIORITY = [
  'article',
  'newsletter',
  'blog',
  'transcript',
  'podcast',
  'video',
  'post',
  'comment',
  'pdf',
  'research',
  'course',
  'product-page',
  'bookmark',
  'note',
  'other',
];

// Sonnet pricing (per token)
const SONNET_INPUT_PRICE = 3.0 / 1_000_000;
const SONNET_OUTPUT_PRICE = 15.0 / 1_000_000;

// ── Types ──

interface ContentRow {
  id: string;
  content: string | null;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
}

// ── Helpers ──

function contentTypeSortKey(contentType: string | null): number {
  const idx = CONTENT_TYPE_PRIORITY.indexOf(contentType ?? 'other');
  return idx === -1 ? CONTENT_TYPE_PRIORITY.length : idx;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──

async function main(): Promise<void> {
  const { limit, dryRun, batchSize } = parseArgs();

  // Validate env
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in environment');
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error('Missing ANTHROPIC_API_KEY in environment');
    process.exit(1);
  }

  const model = process.env.AI_SUMMARY_MODEL || 'claude-sonnet-4-6';
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Fetch items needing summaries ──

  console.log(
    `\nFetching content items without summaries (limit ${limit})...\n`,
  );

  const { data: items, error: fetchError } = await supabase
    .from('content_items')
    .select('id, content, title, suggested_title, content_type, primary_domain')
    .is('summary_data', null)
    .not('content', 'is', null)
    .order('captured_date', { ascending: false })
    .limit(500); // Fetch more than needed so we can sort by content type priority

  if (fetchError) {
    console.error('Failed to fetch items:', fetchError.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log('No items found without summaries. Nothing to do.');
    return;
  }

  // Filter out items with empty content, sort by content type priority, then take limit
  const candidates = (items as ContentRow[])
    .filter((item) => item.content && item.content.trim().length > 0)
    .sort(
      (a, b) =>
        contentTypeSortKey(a.content_type) - contentTypeSortKey(b.content_type),
    )
    .slice(0, limit);

  if (candidates.length === 0) {
    console.log('No items with content found. Nothing to do.');
    return;
  }

  // ── Cost estimate ──

  const totalChars = candidates.reduce((sum, item) => {
    const len = Math.min(item.content?.length ?? 0, 100_000);
    return sum + len;
  }, 0);
  // Rough token estimate: ~4 chars per token for English text
  const estimatedInputTokens = Math.ceil(totalChars / 4);
  // Assume ~500 output tokens per summary (tool use response)
  const estimatedOutputTokens = candidates.length * 500;
  const estimatedCost =
    estimatedInputTokens * SONNET_INPUT_PRICE +
    estimatedOutputTokens * SONNET_OUTPUT_PRICE;

  // ── Content type breakdown ──

  const typeCounts: Record<string, number> = {};
  for (const item of candidates) {
    const t = item.content_type || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  console.log('='.repeat(60));
  console.log(`  Items to process:     ${candidates.length}`);
  console.log(`  Model:                ${model}`);
  console.log(`  Batch size:           ${batchSize} concurrent`);
  console.log(
    `  Est. input tokens:    ${estimatedInputTokens.toLocaleString()}`,
  );
  console.log(
    `  Est. output tokens:   ${estimatedOutputTokens.toLocaleString()}`,
  );
  console.log(`  Est. cost:            ${formatCost(estimatedCost)}`);
  console.log('');
  console.log('  Content type breakdown:');
  for (const [type, count] of Object.entries(typeCounts).sort(
    (a, b) => contentTypeSortKey(a[0]) - contentTypeSortKey(b[0]),
  )) {
    console.log(`    ${type.padEnd(20)} ${count}`);
  }
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n-- DRY RUN -- Items that would be processed:\n');
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const displayTitle = item.suggested_title || item.title || 'Untitled';
      const contentLen = item.content?.length ?? 0;
      console.log(
        `  ${String(i + 1).padStart(3)}. [${(item.content_type || 'other').padEnd(12)}] ${truncate(displayTitle, 60)} (${contentLen.toLocaleString()} chars)`,
      );
    }
    console.log('\nRun without --dry-run to process.');
    return;
  }

  // ── Process in batches ──

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  for (
    let batchStart = 0;
    batchStart < candidates.length;
    batchStart += batchSize
  ) {
    const batch = candidates.slice(batchStart, batchStart + batchSize);

    if (batchStart > 0) {
      // 2-second delay between batches
      await sleep(2000);
    }

    const results = await Promise.allSettled(
      batch.map(async (item, batchIndex) => {
        const index = batchStart + batchIndex + 1;
        const displayTitle = item.suggested_title || item.title || 'Untitled';

        try {
          const { summaryData, inputTokens, outputTokens } =
            await callSummaryAI({
              content: item.content!,
              title: displayTitle,
              contentType: item.content_type || 'article',
              domain: item.primary_domain || 'unknown',
            });

          // Store in Supabase (cast to bypass JSONB typing)
          // Also sync summary with the higher-quality executive summary
          const { error: updateError } = await supabase
            .from('content_items')
            .update({
              summary_data: summaryData as unknown as Record<string, unknown>,
              summary: summaryData.executive,
            })
            .eq('id', item.id);

          if (updateError) {
            throw new Error(`Supabase update failed: ${updateError.message}`);
          }

          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;
          successCount++;

          const tokensUsed = inputTokens + outputTokens;
          console.log(
            `  [${String(index).padStart(String(candidates.length).length)}/${candidates.length}] Generated summary for "${truncate(displayTitle, 50)}" (${tokensUsed.toLocaleString()} tokens)`,
          );
        } catch (err) {
          errorCount++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `  [${String(index).padStart(String(candidates.length).length)}/${candidates.length}] ERROR for "${truncate(displayTitle, 50)}": ${message}`,
          );
        }
      }),
    );

    // Check for unexpected rejections (shouldn't happen since we catch inside, but just in case)
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('  Unexpected batch rejection:', result.reason);
      }
    }
  }

  // ── Final summary ──

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const actualCost =
    totalInputTokens * SONNET_INPUT_PRICE +
    totalOutputTokens * SONNET_OUTPUT_PRICE;

  console.log('');
  console.log('='.repeat(60));
  console.log('  COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Succeeded:          ${successCount}`);
  console.log(`  Failed:             ${errorCount}`);
  console.log(`  Time:               ${elapsed}s`);
  console.log(`  Input tokens:       ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens:      ${totalOutputTokens.toLocaleString()}`);
  console.log(
    `  Total tokens:       ${(totalInputTokens + totalOutputTokens).toLocaleString()}`,
  );
  console.log(`  Total cost:         ${formatCost(actualCost)}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
