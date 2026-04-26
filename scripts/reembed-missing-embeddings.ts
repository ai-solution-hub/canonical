/**
 * Re-embed content_items with `embedding IS NULL`.
 *
 * Two modes:
 *   - default: classified orphans only (`classification_confidence IS NOT NULL`)
 *     — the S158/S159 silent-failure profile this script was first written for.
 *   - `--include-unclassified`: every row with `embedding IS NULL`, regardless
 *     of classification state. Added for the S182 cutover backfill where the
 *     34 missing-embedding rows (articles + policy + capability + ...) all came
 *     from the MCP `create_content_item` path, which does not auto-classify and
 *     does not auto-embed. See `docs/operations/cutover-report-s182.md` §8.1.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
 *     bun run scripts/reembed-missing-embeddings.ts [--include-unclassified]
 *
 * Runs with `dangerouslyDisableSandbox: true` per the Bun fetch 204
 * sandbox gotcha in CLAUDE.md (supabase.from().update() without .select()
 * returns 204 which Bun cannot read through the sandbox proxy).
 *
 * References:
 *   docs/specs/esm-embedding-silent-failure-spec.md
 *   docs/audits/si-classification-verification-s156.md § Run 2
 *   docs/operations/cutover-report-s182.md § 8.1
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
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY must be set.');
    process.exit(1);
  }

  const includeUnclassified = process.argv.includes('--include-unclassified');

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(
    includeUnclassified
      ? 'Scanning for content_items without embeddings (including unclassified)...'
      : 'Scanning for classified content_items without embeddings...',
  );
  let query = supabase
    .from('content_items')
    .select('id, title, suggested_title, content')
    .is('embedding', null);
  if (!includeUnclassified) {
    query = query.not('classification_confidence', 'is', null);
  }
  const { data: orphans, error: queryError } = await query;

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
