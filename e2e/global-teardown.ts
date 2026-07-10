import { createServiceClient } from './fixtures/supabase';
const E2E_CONTENT_PREFIXES = ['[E2E-', '[E2E Test]'] as const;

/**
 * `source_documents` rows that are provisioned ONCE (by `bun run
 * seed:e2e-users` -> `seedPublicationReviewFixture`) and declared
 * NEVER-deleted there — NOT per-worker/per-run fixtures this safety sweep
 * should ever touch. Duplicated literal (scripts/seed-e2e-users.ts's
 * `PUBLICATION_REVIEW_FIXTURE_TITLE` const is not exported — MUST stay in
 * lock-step with that script, matching the existing lock-step convention
 * used for the taxonomy/governance fixture literals in
 * e2e/tests/settings-mutations.spec.ts).
 *
 * S457 finding (ID-128.16 #1): this fixture's filename carries the same
 * '[E2E-' prefix this sweep matches on, so every Playwright invocation was
 * deleting it (confirmed empirically). e2e/tests/review-publication-tab.
 * spec.ts does NOT seed it inline — it is "provisioned ONCE PER CI E2E job
 * by `bun run seed:e2e-users`" and the test FAILS honestly if the row is
 * missing (its own header comment, spec §10.1) — so this teardown's
 * deletion is only "benign" in the sense that the NEXT invocation's
 * seed:e2e-users step re-creates it before that run's tests execute
 * (idempotent create-if-missing); it is a genuine unconditional deletion of
 * a row declared NEVER-deleted, and a real cross-shard race in the sharded
 * nightly (multiple shards share one seed pass, so shard A's teardown can
 * delete the row while shard B's review-publication-tab spec is still
 * reading it).
 */
const PERSISTENT_FIXTURE_FILENAMES: readonly string[] = [
  '[E2E-PUB-REVIEW-FIXTURE] Awaiting publication test row',
];

/**
 * ID-131.19 M6 retirement note (S450 GO tail): `content_items` (+
 * `content_history`) was DROPPED at M6. There is no single surviving
 * table shaped like the old god-table — the per-worker fixture
 * (test-data-fixture.ts) now splits seeded rows across `q_a_pairs`
 * (question_text-prefixed) and `source_documents` (filename-prefixed), so
 * this safety sweep now targets both.
 */
async function cleanupContentItemsByTitlePrefix(
  supabase: ReturnType<typeof createServiceClient>,
  prefix: string,
): Promise<void> {
  const { data: qaRows, error: qaError } = await supabase
    .from('q_a_pairs')
    .select('id')
    .like('question_text', `${prefix}%`);

  if (qaError) {
    throw new Error(
      `Failed to query E2E q_a_pairs for prefix ${prefix}: ${qaError.message}`,
    );
  }

  const qaIds = (qaRows ?? []).map((row) => row.id);
  if (qaIds.length > 0) {
    await supabase
      .from('record_embeddings')
      .delete()
      .eq('owner_kind', 'q_a_pair')
      .in('owner_id', qaIds);
    await supabase.from('q_a_pairs').delete().in('id', qaIds);
  }

  const { data: sdRows, error: sdError } = await supabase
    .from('source_documents')
    .select('id, filename')
    .like('filename', `${prefix}%`);

  if (sdError) {
    throw new Error(
      `Failed to query E2E source_documents for prefix ${prefix}: ${sdError.message}`,
    );
  }

  const sdIds = (sdRows ?? [])
    .filter((row) => !PERSISTENT_FIXTURE_FILENAMES.includes(row.filename))
    .map((row) => row.id);
  if (sdIds.length === 0) return;

  await supabase
    .from('entity_mentions')
    .delete()
    .in('source_document_id', sdIds);
  await supabase
    .from('entity_relationships')
    .delete()
    .in('source_document_id', sdIds);
  await supabase
    .from('record_embeddings')
    .delete()
    .eq('owner_kind', 'source_document')
    .in('owner_id', sdIds);
  await supabase.from('source_documents').delete().in('id', sdIds);
}

/**
 * Global teardown runs once after all test files have completed.
 *
 * This is a safety sweep only — per-worker cleanup is handled by the
 * workerData fixture teardown. This catches any orphaned data from
 * crashed workers.
 */
async function globalTeardown(): Promise<void> {
  console.log('E2E teardown: running safety cleanup...');
  try {
    const supabase = createServiceClient();

    // Clean up any orphaned E2E data (from crashed workers)
    for (const prefix of E2E_CONTENT_PREFIXES) {
      await cleanupContentItemsByTitlePrefix(supabase, prefix);
    }
    await supabase.from('workspaces').delete().like('name', '[E2E-%');

    // Clean orphaned notifications with E2E prefix
    await supabase.from('notifications').delete().like('title', '[E2E-%');

    // Also clean legacy [E2E Test] prefix data
    await supabase.from('workspaces').delete().like('name', '[E2E Test]%');

    // ID-131.19: the admin-dedup fixture tag-based fallback sweep that used
    // to run here was retired at ID-131.15 (G-DEDUP) alongside the
    // admin-dedup E2E fixture family itself and the content_items rows it
    // tagged — see e2e/global-setup.ts's ID-131.15 note (the symmetric
    // Step-0 removal on the setup side). Nothing left to sweep.

    console.log('E2E teardown: safety cleanup complete.');
  } catch (error) {
    console.error('E2E teardown: safety cleanup failed:', error);
    // Don't throw — teardown failures should not mask test results
  }
}

export default globalTeardown;
