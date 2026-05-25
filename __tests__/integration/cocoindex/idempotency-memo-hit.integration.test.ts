/**
 * Integration test — PRODUCT Inv-4 (idempotency on content-hash match).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-4 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Re-running the pipeline over a file whose byte-contents have not
 * > changed since the last successful run does NOT produce new derivation
 * > rows (`content_items` update with no-op diff, `q_a_extractions` no
 * > duplicates, `entity_mentions` no duplicates). The pipeline short-
 * > circuits at the content-hash check via the memoisation contract.
 * > Verifiable: ingest a file twice without modification; assert
 * > `q_a_extractions` row count for that source is identical before and
 * > after the second run."
 *
 * Test strategy:
 *   1. Drop a fixture (initial ingest fires).
 *   2. Wait for ingest to settle.
 *   3. Capture `q_a_extractions` + `entity_mentions` row counts.
 *   4. Trigger a re-ingest cycle (touch the file or wait for the next
 *      poll cycle).
 *   5. Wait for the second poll to settle.
 *   6. Re-capture row counts.
 *   7. Assert counts are byte-identical (no new derivation rows produced).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase. Skip-clean locally pending env unblock.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-4.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-4.
 *   - 28.14 sibling `extract-memoisation.integration.test.ts` (Inv-21 memo
 *     determinism — sibling concern).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[28.18-INV04-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // FUTURE: drop fixture, wait for first ingest, then trigger second poll
  // by touching the file (or wait for the natural poll cycle).
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  await client
    .from('q_a_extractions')
    .delete()
    .in('content_item_id', seededContentIds);
  await client
    .from('entity_mentions')
    .delete()
    .in('content_item_id', seededContentIds);
  await client.from('content_items').delete().in('id', seededContentIds);
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-4 — idempotency on content-hash match (no new derivation rows on re-ingest)',
  () => {
    it(
      're-ingest of an unchanged file produces zero new q_a_extractions / entity_mentions rows',
      async () => {
        const client = await createLiveServiceClient();

        // Wait for first ingest to land (TEST_PREFIX title appears in content_items).
        const firstIngestDeadline = Date.now() + POLL_TIMEOUT_MS;
        let contentItemId: string | null = null;

        while (Date.now() < firstIngestDeadline) {
          const { data } = await client
            .from('content_items')
            .select('id')
            .ilike('title', `${TEST_PREFIX}%`)
            .limit(1);
          if (data && data.length > 0) {
            contentItemId = data[0]!.id as string;
            seededContentIds.push(contentItemId);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }

        expect(contentItemId).not.toBeNull();

        // Capture pre-bump derivation-row counts.
        const { count: extractionsBefore } = await client
          .from('q_a_extractions')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', contentItemId!);

        const { count: mentionsBefore } = await client
          .from('entity_mentions')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', contentItemId!);

        // Trigger a re-ingest cycle. FUTURE: touch the file via the fixture
        // staging endpoint so cocoindex observes a modification event but
        // the content_text hash remains identical (file timestamp changes;
        // body bytes do not).
        //
        // Wait the polling-cadence window so the second poll fires.
        await new Promise((resolve) => setTimeout(resolve, 10_000));

        // Re-capture post-bump counts.
        const { count: extractionsAfter } = await client
          .from('q_a_extractions')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', contentItemId!);

        const { count: mentionsAfter } = await client
          .from('entity_mentions')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', contentItemId!);

        // Inv-4 verifiability: counts MUST be byte-identical post-second-
        // ingest. Any delta proves the memoisation short-circuit didn't
        // fire — the extractor body re-ran and produced duplicate rows.
        expect(extractionsAfter).toBe(extractionsBefore);
        expect(mentionsAfter).toBe(mentionsBefore);
      },
      POLL_TIMEOUT_MS + 60_000,
    );
  },
);
