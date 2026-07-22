/**
 * Integration test — PRODUCT Inv-8 (Stage-5 ↔ classifyContent coexistence).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-8 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-8 + TECH §P-11):
 *
 * > "The classifyContent delete-before-insert path
 * > (lib/ai/classify.ts:1543/1751) INSERTs entity_mentions rows with NULL
 * > op_id (no pipeline run in flight). Stage-5 NEVER UPDATEs NULL-op_id rows
 * > (Inv-5). While a pipeline run is in flight, a classifyContent invocation
 * > on a DIFFERENT content_item completes successfully and its INSERTs are not
 * > overwritten by Stage-5."
 *
 * Test strategy (the op_id-scoping consequence, verified at the data layer):
 *   1. Seed a content_item + an entity_mentions row with NULL op_id
 *      (representing a classifyContent INSERT on a content_item that is NOT
 *      part of any pipeline run) carrying a distinctive canonical_name.
 *   2. Stage a pipeline fixture (a DIFFERENT corpus) and let its Stage-5 pass
 *      run to completion.
 *   3. Re-read the seeded NULL-op_id row; assert its canonical_name is
 *      UNCHANGED and its op_id is STILL NULL — Stage-5's op_id-scoped UPDATE
 *      never touched it.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-8.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-11, §3.
 *   - lib/ai/classify.ts:1543-1546 (DELETE), :1751 (INSERT — NULL op_id).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import { testUUID } from '../helpers/test-data-factory';
import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import { pollEntityMentionsFor } from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[53.14-INV08-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const NULL_OP_CANONICAL = `${TEST_PREFIX}-classifyContent-canonical`;
const seededContentIds: string[] = [];
let nullOpContentItemId: string | null = null;
let nullOpMentionId: string | null = null;

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();

  // 1. Seed a source_documents row + a NULL-op_id entity_mentions row
  //    simulating the classifyContent INSERT path (lib/ai/classify.ts:1751
  //    — no op_id field). (ID-131.19 M6 retirement: content_items DROPPED
  //    at M6; entity_mentions.source_document_id is a direct FK to
  //    source_documents, so the seeded row must live there now.)
  const contentItemId = testUUID();
  nullOpContentItemId = contentItemId;
  // Populate all required (NOT NULL) source_documents schema fields
  // (content_hash, file_size, filename, mime_type, storage_path) directly
  // — a raw minimal insert hard-fails on those columns when run live.
  // op_id is left unset → defaults to NULL (this source document is NOT
  // part of a pipeline run, mirroring the classifyContent INSERT path).
  const { error: ciErr } = await client.from('source_documents').insert({
    id: contentItemId,
    filename: `${TEST_PREFIX}-classifyContent-item.txt`,
    mime_type: 'text/plain',
    file_size: 1,
    content_hash: `${TEST_PREFIX}-classifyContent-item`,
    storage_path: `test-fixtures/${TEST_PREFIX}/classifyContent-item.txt`,
    status: 'processed',
  });
  // If the seed insert is still rejected, fall back to NOT seeding — the test
  // will skip its assertion body gracefully via the null guard. We surface the
  // error for diagnosis.
  if (ciErr) {
    console.warn(
      `Inv-8 seed: source_documents insert warning — ${ciErr.message}`,
    );
    nullOpContentItemId = null;
    return;
  }

  const mentionId = testUUID();
  nullOpMentionId = mentionId;
  const { error: emErr } = await client.from('entity_mentions').insert({
    id: mentionId,
    source_document_id: contentItemId,
    entity_name: 'ISO 27001',
    entity_type: 'certification',
    canonical_name: NULL_OP_CANONICAL,
    op_id: null, // ← the load-bearing field: classifyContent INSERTs are NULL.
  });
  if (emErr) {
    console.warn(
      `Inv-8 seed: entity_mentions insert warning — ${emErr.message}`,
    );
    nullOpMentionId = null;
  }

  // 2. Stage a DIFFERENT pipeline corpus whose Stage-5 pass runs concurrently.
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-8/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  if (nullOpMentionId) {
    await client.from('entity_mentions').delete().eq('id', nullOpMentionId);
  }
  if (nullOpContentItemId) {
    // ID-131.19 M6 retirement: content_items DROPPED at M6;
    // source_documents replaces it as the seeded-row cleanup target.
    await client
      .from('source_documents')
      .delete()
      .eq('id', nullOpContentItemId);
  }
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-8 — Stage-5 never overwrites a NULL-op_id classifyContent row',
  () => {
    it(
      'the seeded NULL-op_id entity_mentions row is untouched after a concurrent pipeline run',
      async () => {
        // Guard: the seed must have landed for the assertion to be meaningful.
        expect(
          nullOpMentionId,
          'NULL-op_id mention seed must exist',
        ).not.toBeNull();

        // Wait for the pipeline corpus to complete (its rows landed → its
        // Stage-5 pass had a chance to run).
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of items) seededContentIds.push(r.id);
        const opId = items.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opId).not.toBeNull();
        // The pipeline produced its own entity_mentions (Stage-5 ran).
        await pollEntityMentionsFor({
          opId: opId!,
          timeoutMs: POLL_TIMEOUT_MS,
        });

        // Inv-8 verifiability: re-read the seeded NULL-op_id row. Its
        // canonical_name is unchanged and its op_id is STILL NULL — Stage-5's
        // op_id-scoped UPDATE never touched it.
        const client = await createLiveServiceClient();
        const { data: row, error } = await client
          .from('entity_mentions')
          .select('id, canonical_name, op_id')
          .eq('id', nullOpMentionId!)
          .single();
        expect(error).toBeNull();
        expect(row!.op_id).toBeNull();
        expect(row!.canonical_name).toBe(NULL_OP_CANONICAL);
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
