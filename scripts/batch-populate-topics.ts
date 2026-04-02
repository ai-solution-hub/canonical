/**
 * Batch Topic Population
 *
 * Populates topic_id for content items that are missing it. Uses a two-pass
 * strategy per item:
 *   Pass 1: Find existing topic groups with matching domain/subtopic
 *   Pass 2: Check for other items in the same domain/subtopic to form new groups
 *
 * Topic IDs follow convention: {domain}-{subtopic} (lowercase, hyphen-separated)
 *
 * Usage:
 *   bun run scripts/batch_populate_topics.ts --dry-run
 *   bun run scripts/batch_populate_topics.ts --limit 50
 *   bun run scripts/batch_populate_topics.ts
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types/database.types';

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

function parseArgs(): { limit: number; dryRun: boolean; batchSize: number } {
  const args = process.argv.slice(2);
  let limit = 500;
  let dryRun = false;
  let batchSize = 1;

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

  if (isNaN(limit) || limit < 1) limit = 500;
  if (isNaN(batchSize) || batchSize < 1) batchSize = 20;
  if (batchSize > 50) batchSize = 50;

  return { limit, dryRun, batchSize };
}

// ── Topic ID generation ──

function generateTopicId(domain: string, subtopic: string): string {
  return `${domain}-${subtopic}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ── Types ──

interface ContentItem {
  id: string;
  title: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  metadata: Record<string, unknown> | null;
}

interface TopicAssignment {
  itemId: string;
  title: string;
  domain: string;
  subtopic: string;
  topicId: string;
  reason: string;
}

// ── Main ──

async function main(): Promise<void> {
  const { limit, dryRun, batchSize } = parseArgs();

  // Validate env
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(300_000) }),
    },
  });

  // ── Step 1: Fetch all active items ──

  console.log('\nFetching all active content items...\n');

  const { data: allItems, error: fetchAllError } = await supabase
    .from('content_items')
    .select('id, title, primary_domain, primary_subtopic, metadata')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (fetchAllError) {
    console.error('Failed to fetch items:', fetchAllError.message);
    process.exit(1);
  }

  if (!allItems || allItems.length === 0) {
    console.log('No active items found.');
    return;
  }

  // Separate items with and without topic_id
  const itemsWithTopic: ContentItem[] = [];
  const itemsWithoutTopic: ContentItem[] = [];

  for (const item of allItems as ContentItem[]) {
    const meta = item.metadata as Record<string, unknown> | null;
    if (meta?.topic_id) {
      itemsWithTopic.push(item);
    } else {
      itemsWithoutTopic.push(item);
    }
  }

  console.log(`  Total active items:        ${allItems.length}`);
  console.log(`  Already have topic_id:     ${itemsWithTopic.length}`);
  console.log(`  Missing topic_id:          ${itemsWithoutTopic.length}`);

  // Filter to items that have both domain and subtopic (required for topic grouping)
  const candidates = itemsWithoutTopic
    .filter((item) => item.primary_domain && item.primary_subtopic)
    .slice(0, limit);

  const skipped = itemsWithoutTopic.filter(
    (item) => !item.primary_domain || !item.primary_subtopic,
  );
  if (skipped.length > 0) {
    console.log(`  Skipped (no domain/subtopic): ${skipped.length}`);
  }
  console.log(`  Candidates to process:     ${candidates.length}`);

  if (candidates.length === 0) {
    console.log('\nNo candidates to process.');
    return;
  }

  // ── Step 2: Build topic group index from existing items ──

  // Map: domain+subtopic -> topic_id (from items that already have topic_id)
  const existingTopicIndex = new Map<string, string>();
  for (const item of itemsWithTopic) {
    if (!item.primary_domain || !item.primary_subtopic) continue;
    const meta = item.metadata as Record<string, unknown>;
    const topicId = meta.topic_id as string;
    const key = `${item.primary_domain}::${item.primary_subtopic}`;
    if (!existingTopicIndex.has(key)) {
      existingTopicIndex.set(key, topicId);
    }
  }

  console.log(`  Existing topic groups:     ${existingTopicIndex.size}`);

  // ── Step 3: Group candidates by domain+subtopic ──

  const candidateGroups = new Map<string, ContentItem[]>();
  for (const item of candidates) {
    const key = `${item.primary_domain}::${item.primary_subtopic}`;
    if (!candidateGroups.has(key)) {
      candidateGroups.set(key, []);
    }
    candidateGroups.get(key)!.push(item);
  }

  // ── Step 4: Assign topic_ids ──

  const assignments: TopicAssignment[] = [];
  const newTopicGroups: string[] = [];

  for (const [groupKey, items] of candidateGroups) {
    const [domain, subtopic] = groupKey.split('::');

    // Pass 1: Check if an existing topic group matches this domain+subtopic
    const existingTopicId = existingTopicIndex.get(groupKey);

    if (existingTopicId) {
      // Assign existing topic_id to all candidates in this group
      for (const item of items) {
        assignments.push({
          itemId: item.id,
          title: item.title || 'Untitled',
          domain,
          subtopic,
          topicId: existingTopicId,
          reason: `Matched existing topic group "${existingTopicId}"`,
        });
      }
      continue;
    }

    // Pass 2: No existing topic group — check if we should create one
    // We need at least 2 items (candidates + existing ungrouped) to form a group,
    // OR items at different layers
    // Also check if there are existing items (already-fetched) in this domain+subtopic
    // that don't have a topic_id
    const existingUngrouped = itemsWithoutTopic.filter(
      (i) =>
        i.primary_domain === domain &&
        i.primary_subtopic === subtopic &&
        !items.some((c) => c.id === i.id), // exclude current candidates already in items
    );

    const allInGroup = [...items, ...existingUngrouped];

    // Check for layer diversity or sufficient count
    const layers = new Set<string>();
    for (const item of allInGroup) {
      const meta = item.metadata as Record<string, unknown> | null;
      const layer = meta?.layer as string;
      if (layer) layers.add(layer);
    }

    const hasLayerDiversity = layers.size >= 2;
    const hasSufficientCount = allInGroup.length >= 2;

    if (hasLayerDiversity || hasSufficientCount) {
      const topicId = generateTopicId(domain, subtopic);
      newTopicGroups.push(topicId);

      for (const item of items) {
        assignments.push({
          itemId: item.id,
          title: item.title || 'Untitled',
          domain,
          subtopic,
          topicId,
          reason: hasLayerDiversity
            ? `New topic group — ${layers.size} different layers found`
            : `New topic group — ${allInGroup.length} items in same domain/subtopic`,
        });
      }

      // Also assign the existing ungrouped items
      for (const item of existingUngrouped) {
        assignments.push({
          itemId: item.id,
          title: item.title || 'Untitled',
          domain,
          subtopic,
          topicId,
          reason: hasLayerDiversity
            ? `New topic group — ${layers.size} different layers found`
            : `New topic group — ${allInGroup.length} items in same domain/subtopic`,
        });
      }
    }
    // else: single item with no match — skip, no topic group created
  }

  // ── Step 5: Report ──

  // Group assignments by topic_id for summary
  const topicSummary = new Map<string, number>();
  for (const a of assignments) {
    topicSummary.set(a.topicId, (topicSummary.get(a.topicId) || 0) + 1);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`  Assignments:             ${assignments.length}`);
  console.log(`  New topic groups:        ${newTopicGroups.length}`);
  console.log(
    `  Existing groups matched: ${topicSummary.size - newTopicGroups.length}`,
  );
  console.log('='.repeat(70));

  if (assignments.length === 0) {
    console.log(
      '\nNo assignments to make. All items either lack domain/subtopic or are singletons.',
    );
    return;
  }

  // Print breakdown by topic group
  console.log('\nTopic group breakdown:');
  const sortedTopics = [...topicSummary.entries()].sort((a, b) => b[1] - a[1]);
  for (const [topicId, count] of sortedTopics) {
    const isNew = newTopicGroups.includes(topicId) ? ' (NEW)' : '';
    console.log(
      `  ${topicId.padEnd(45)} ${String(count).padStart(3)} items${isNew}`,
    );
  }

  if (dryRun) {
    console.log('\n-- DRY RUN -- Assignments that would be made:\n');
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      console.log(
        `  ${String(i + 1).padStart(4)}. [${a.topicId}] "${truncate(a.title, 50)}" — ${a.reason}`,
      );
    }
    console.log('\nRun without --dry-run to apply.');
    return;
  }

  // ── Step 6: Apply assignments in batches ──

  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < assignments.length; i += batchSize) {
    const batch = assignments.slice(i, i + batchSize);

    // Small delay between batches to avoid connection pool exhaustion
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const results = await Promise.allSettled(
      batch.map(async (assignment) => {
        // Use merge_item_metadata RPC — single call, handles JSONB merge server-side
        const { error: rpcErr } = await supabase.rpc('merge_item_metadata', {
          p_item_id: assignment.itemId,
          p_new_data: { topic_id: assignment.topicId },
        });

        if (rpcErr) {
          throw new Error(
            `RPC failed for ${assignment.itemId}: ${rpcErr.message}`,
          );
        }
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const assignment = batch[j];
      const index = i + j + 1;

      if (result.status === 'fulfilled') {
        successCount++;
        console.log(
          `  [${String(index).padStart(String(assignments.length).length)}/${assignments.length}] Set topic_id="${assignment.topicId}" on "${truncate(assignment.title, 45)}"`,
        );
      } else {
        errorCount++;
        console.error(
          `  [${String(index).padStart(String(assignments.length).length)}/${assignments.length}] ERROR: ${result.reason}`,
        );
      }
    }
  }

  // ── Step 7: Final summary ──

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Re-count items with topic_id
  const { count: finalCount } = await supabase
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .not('metadata->topic_id', 'is', null)
    .is('archived_at', null);

  console.log('\n' + '='.repeat(70));
  console.log('  COMPLETE');
  console.log('='.repeat(70));
  console.log(`  Assignments applied:     ${successCount}`);
  console.log(`  Errors:                  ${errorCount}`);
  console.log(`  Time:                    ${elapsed}s`);
  console.log(`  Total items with topic:  ${finalCount ?? 'unknown'}`);
  console.log('='.repeat(70));
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
