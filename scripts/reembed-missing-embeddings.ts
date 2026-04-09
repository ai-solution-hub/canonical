/**
 * Re-embed content_items that have classification but no embedding.
 *
 * Context: S158 WP2 ESM classification backfill surfaced two items
 * (819b285f... "State-funded school inspections..." at 138k chars and
 * c1042ca4... "Cyber security: core standard" at 55k chars) that were
 * classified with high confidence but have `embedding IS NULL`. Root
 * cause: the items exceeded OpenAI `text-embedding-3-large`'s 8,192-token
 * input cap, the SDK threw a 400 BadRequestError, and the classify.ts
 * embedding path swallowed the error via console.error without surfacing
 * it to Sentry or telemetry.
 *
 * S159 WP4b fixed the silent-failure surface by (a) adding
 * MAX_EMBEDDING_CHARS to `lib/ai/embed.ts`, (b) truncating the input
 * before calling generateEmbedding and emitting a best-effort warning
 * on truncation, and (c) replacing the console.error swallow with
 * logBestEffortWarn. This script is the one-off backfill that re-embeds
 * the rows already affected.
 *
 * The query uses `embedding IS NULL AND classification_confidence IS NOT NULL`
 * rather than hard-coded item ids so any other orphans (from future
 * transient errors) are also picked up.
 *
 * Usage:
 *   SUPABASE_SECRET_KEY=... OPENAI_API_KEY=... \
 *     bun run scripts/reembed-missing-embeddings.ts
 *
 * Runs with `dangerouslyDisableSandbox: true` per the Bun fetch 204
 * sandbox gotcha in CLAUDE.md (supabase.from().update() without .select()
 * returns 204 which Bun cannot read through the sandbox proxy).
 *
 * References:
 *   docs/specs/esm-embedding-silent-failure-spec.md
 *   docs/audits/si-classification-verification-s156.md § Run 2
 *   docs/reference/post-mvp-roadmap.md §2.1.12
 */

import { createClient } from '@supabase/supabase-js';
import { generateEmbedding, MAX_EMBEDDING_CHARS } from '../lib/ai/embed';

interface OrphanRow {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content: string;
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.',
    );
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY must be set.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('Scanning for classified content_items without embeddings...');
  const { data: orphans, error: queryError } = await supabase
    .from('content_items')
    .select('id, title, suggested_title, content')
    .is('embedding', null)
    .not('classification_confidence', 'is', null);

  if (queryError) {
    console.error('Query failed:', queryError.message);
    process.exit(1);
  }
  if (!orphans || orphans.length === 0) {
    console.log('No orphaned rows. Nothing to do.');
    return;
  }

  console.log(`Found ${orphans.length} orphan(s). Re-embedding...\n`);

  let succeeded = 0;
  let failed = 0;
  for (const row of orphans as OrphanRow[]) {
    const titleText = row.suggested_title ?? row.title ?? '';
    const rawText = `${titleText}\n\n${row.content ?? ''}`;
    const wasTruncated = rawText.length > MAX_EMBEDDING_CHARS;
    const embeddingText = wasTruncated
      ? rawText.slice(0, MAX_EMBEDDING_CHARS)
      : rawText;

    const label = `${row.id.slice(0, 8)} ${(titleText || '(no title)').slice(0, 60)}`;
    const truncNote = wasTruncated
      ? ` [truncated ${rawText.length} → ${MAX_EMBEDDING_CHARS}]`
      : '';

    try {
      const embedding = await generateEmbedding(embeddingText);
      const { error: updateError } = await supabase
        .from('content_items')
        .update({ embedding: JSON.stringify(embedding) })
        .eq('id', row.id);
      if (updateError) {
        console.error(`  ✗ ${label}${truncNote}: update failed — ${updateError.message}`);
        failed++;
        continue;
      }
      console.log(`  ✓ ${label}${truncNote}`);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${label}${truncNote}: embedding failed — ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
  if (failed > 0) {
    console.log(
      'Failed rows remain unembedded — inspect the error messages above and',
      're-run after addressing the root cause.',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
