/**
 * Batch Re-classify Keywords
 *
 * Finds content items with malformed ai_keywords (strings > 40 chars or null)
 * and re-classifies them using the AI classifier to generate proper keywords.
 *
 * Usage:
 *   bun run scripts/batch_reclassify_keywords.ts
 *   bun run scripts/batch_reclassify_keywords.ts --dry-run
 *   bun run scripts/batch_reclassify_keywords.ts --batch-size 3
 */

import { createClient } from '@supabase/supabase-js';
import { classifyContent } from '@/lib/ai/classify';
import type { Database } from '@/supabase/types/database.types';

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
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — that's fine
  }
}

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ── CLI args ──

function parseArgs(): { dryRun: boolean; batchSize: number } {
  const args = process.argv.slice(2);
  let dryRun = false;
  let batchSize = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (isNaN(batchSize) || batchSize < 1) batchSize = 3;
  if (batchSize > 5) batchSize = 5;

  return { dryRun, batchSize };
}

// ── Helpers ──

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──

async function main(): Promise<void> {
  const { dryRun, batchSize } = parseArgs();

  // Validate env
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in environment');
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error('Missing ANTHROPIC_API_KEY in environment');
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
    db: { schema: 'public' },
    global: {
      fetch: (url: string | URL | Request, init?: RequestInit) => {
        return fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
      },
    },
  });

  // ── Find affected items ──

  console.log('\nFinding items with malformed ai_keywords...\n');

  // Query all active items and filter in-app for malformed keywords
  const { data: allItems, error: fetchError } = await supabase
    .from('content_items')
    .select('id, title, ai_keywords, content_type')
    .is('archived_at', null)
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Failed to fetch items:', fetchError.message);
    process.exit(1);
  }

  if (!allItems || allItems.length === 0) {
    console.log('No active items found.');
    return;
  }

  // Filter for affected items:
  // 1. Items with any keyword longer than 40 chars (malformed section name slugs)
  // 2. Items with null/empty ai_keywords
  const affected = allItems.filter((item) => {
    const keywords = item.ai_keywords as string[] | null;
    if (!keywords || keywords.length === 0) return true;
    return keywords.some((kw) => kw.length > 40);
  });

  console.log(`  Total active items:    ${allItems.length}`);
  console.log(`  Affected items:        ${affected.length}`);
  console.log(`  Batch size:            ${batchSize} concurrent`);
  console.log(`  Dry run:               ${dryRun}`);
  console.log('');

  if (affected.length === 0) {
    console.log('No items need re-classification. All keywords are clean.');
    return;
  }

  // Show breakdown
  const nullKeywords = affected.filter(
    (item) => !item.ai_keywords || (item.ai_keywords as string[]).length === 0,
  );
  const longKeywords = affected.filter((item) => {
    const kw = item.ai_keywords as string[] | null;
    return kw && kw.length > 0 && kw.some((k) => k.length > 40);
  });

  console.log(`  Null/empty keywords:   ${nullKeywords.length}`);
  console.log(`  Long keywords (>40):   ${longKeywords.length}`);
  console.log('');

  if (dryRun) {
    console.log('-- DRY RUN -- Items that would be re-classified:\n');
    for (let i = 0; i < affected.length; i++) {
      const item = affected[i];
      const keywords = (item.ai_keywords as string[] | null) ?? [];
      const keywordPreview =
        keywords.length > 0
          ? keywords.map((k) => truncate(k, 30)).join(', ')
          : '(none)';
      console.log(
        `  ${String(i + 1).padStart(3)}. [${(item.content_type || 'unknown').padEnd(12)}] ${truncate(item.title || 'Untitled', 50)} | kw: ${keywordPreview}`,
      );
    }
    console.log('\nRun without --dry-run to process.');
    return;
  }

  // ── Process in batches ──

  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  // Use admin user ID for the updated_by field
  const systemUserId = '40ea6224-9ca4-4a3c-a013-3f60ec5bd4aa';

  for (let batchStart = 0; batchStart < affected.length; batchStart += batchSize) {
    const batch = affected.slice(batchStart, batchStart + batchSize);

    if (batchStart > 0) {
      // 2-second delay between batches to avoid rate limits
      await sleep(2000);
    }

    const results = await Promise.allSettled(
      batch.map(async (item, batchIndex) => {
        const index = batchStart + batchIndex + 1;
        const displayTitle = item.title || 'Untitled';

        try {
          const result = await classifyContent({
            supabase,
            itemId: item.id,
            force: true,
            userId: systemUserId,
          });

          successCount++;
          console.log(
            `  [${String(index).padStart(3)}/${affected.length}] Re-classified "${truncate(displayTitle, 50)}" => [${result.ai_keywords.join(', ')}]`,
          );
        } catch (err) {
          errorCount++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `  [${String(index).padStart(3)}/${affected.length}] ERROR for "${truncate(displayTitle, 50)}": ${message}`,
          );
        }
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('  Unexpected batch rejection:', result.reason);
      }
    }
  }

  // ── Summary ──

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('='.repeat(60));
  console.log('  RE-CLASSIFICATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Succeeded:          ${successCount}`);
  console.log(`  Failed:             ${errorCount}`);
  console.log(`  Time:               ${elapsed}s`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
