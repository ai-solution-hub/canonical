/**
 * Integration test — PRODUCT Inv-1 (staged file → exactly one
 * content_items row).
 *
 * Subtask ID-49.6 (S273 — reactive write path coverage).
 *
 * Inv-1 statement (paraphrased from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "A single file staged into the watched corpus (COCOINDEX_SOURCE_PATH)
 * > produces EXACTLY ONE content_items row keyed by the file's
 * > source-path identifier. The pipeline does not produce zero rows
 * > (silent drop) and does not produce duplicate rows (idempotency
 * > break)."
 *
 * Test strategy:
 *   1. Drop a single fixture into the staged corpus path with a
 *      unique TEST_PREFIX title.
 *   2. Wait for the cocoindex fs-watch loop to observe + ingest.
 *   3. Query content_items WHERE title ILIKE `${TEST_PREFIX}%`.
 *   4. Assert exactly one row exists.
 *   5. Assert the row has a stamped op_id (Inv-11 cross-check).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean locally pending
 * staging-infrastructure unblock (S273 OQ — fixture-staging service
 * not yet running).
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-1.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-1.
 *   - docs/reference/test-philosophy.md (behaviour-not-implementation).
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

const TEST_PREFIX = `[49.6-INV01-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  if (!ENABLED) return;
  // FUTURE (when fixture-staging service ships): drop a single fixture
  // into the watched corpus root with a TEST_PREFIX-tagged title. The
  // cocoindex fs-watch loop observes the new file and triggers the
  // canonical six-stage pipeline; on completion the content_items row
  // is observable via the Supabase service-role client.
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  await client
    .from('q_a_extractions')
    .delete()
    .in('content_item_id', seededContentIds);
  // entity_mentions cleanup intentionally omitted — ID-49.5 deferred
  // per S273 OQ-1 ratification (no entity-resolution work in 49.6).
  await client.from('content_items').delete().in('id', seededContentIds);
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-1 — staged file produces exactly one content_items row',
  () => {
    it(
      'a single staged fixture lands as exactly one content_items row with a stamped op_id',
      async () => {
        const client = await createLiveServiceClient();

        // Poll until the staged fixture's content_items row lands.
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let landedRows: Array<{ id: string; op_id: string | null }> = [];

        while (Date.now() < deadline) {
          const { data } = await client
            .from('content_items')
            .select('id, op_id')
            .ilike('title', `${TEST_PREFIX}%`);

          if (data && data.length > 0) {
            landedRows = data.map((r) => ({
              id: r.id as string,
              op_id: (r.op_id as string | null) ?? null,
            }));
            for (const row of landedRows) {
              seededContentIds.push(row.id);
            }
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }

        // Inv-1 verifiability part 1: AT LEAST one row landed (no
        // silent drop). A length of 0 means the pipeline observed
        // the file but didn't produce a content_items row — Inv-1
        // breach (silent drop).
        expect(landedRows.length).toBeGreaterThan(0);

        // Inv-1 verifiability part 2: EXACTLY one row landed (no
        // duplicates). A length > 1 means the pipeline produced
        // duplicate content_items rows for the same source — Inv-1
        // breach (idempotency break at the row level).
        expect(landedRows.length).toBe(1);

        // Inv-1 cross-check with Inv-11: the row's op_id is stamped
        // (not null) and is a valid UUID v4. A null op_id means the
        // pipeline produced a row but didn't stamp it — Inv-11 break.
        const row = landedRows[0]!;
        expect(row.op_id).not.toBeNull();
        expect(row.op_id!).toMatch(UUID_V4_REGEX);
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
