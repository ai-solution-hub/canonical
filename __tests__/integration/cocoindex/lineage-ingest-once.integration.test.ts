/**
 * Integration test — NM-1: `ingest-once` lineage (id-400 mint).
 *
 * Source of obligation: id-396/TECH.md:68-72 (the R4 proof surface —
 * "today's corpus tests neither" lineage) + TRIAGE §5 NM-1: the corpus
 * declares an ingest-once lineage — walked once, derived rows asserted to
 * SURVIVE later walks + orphan cleanup.
 *
 * What this file proves TODAY:
 *   1. A fixture walked once (walk A) lands its sd row + derived rows
 *      (content_chunks — CASCADE children of the sd row).
 *   2. A LATER walk (walk B, unchanged corpus) memo-skips the item: every
 *      derived row SURVIVES, byte-identical in identity (same ids), and the
 *      lineage keeps walk A's op_id (S265, restored by the id-400 engine
 *      fix). This is the survive-later-walks half of the R4 obligation.
 *
 * DOCUMENTED GAP (owner-visible, counted separately — the §5 tier-model
 * precedent): the ORPHAN-CLEANUP half ("derived rows must outlive engine
 * orphan-cleanup", id-396/TECH.md:55-59) needs a corpus-file REMOVAL
 * primitive the harness does not have (/stage only adds; no delete route).
 * The sd row itself is raw-pool-written (S437/S438 — not engine-declared,
 * so the engine cannot orphan-clean it); the engine-declared derived rows
 * (chunks/mentions) are the exposed surface. The skipped test below names
 * the gap so the census counts it instead of silently losing it.
 *
 * References: id-396/TECH.md:54-72; TRIAGE §5 NM-1; HARNESS §2 (W2);
 * id-81's cross-run invariants (the closest cousins — consistency-checked,
 * not duplicated).
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import {
  pollContentChunksFor,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import { WALK_BUDGET_MS, runWalk } from './_helpers/walk';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[NM1-INGESTONCE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  // pipeline_runs telemetry accumulates by design (HARNESS §4). Chunk rows
  // CASCADE with the sd delete (id131_extract_reparent).
  if (seededContentIds.length > 0) {
    await client.from('source_documents').delete().in('id', seededContentIds);
  }
}, 30_000);

describe.skipIf(!ENABLED)(
  'NM-1 — ingest-once lineage: derived rows survive later walks',
  () => {
    it(
      'derived rows survive a later memo-skip walk with identity and op_id intact',
      async () => {
        const client = await createLiveServiceClient();

        // Walk A — the lineage's ONE ingest.
        const staged = await stageFixture({
          fixturePath: '__tests__/fixtures/cocoindex-chunking/long-terms.md',
          destPath: `nm1-ingest-once/${TEST_PREFIX}.md`,
          titlePrefix: TEST_PREFIX,
          walkTimeoutMs: WALK_BUDGET_MS,
        });
        expect(staged.walk).toBeDefined();
        const opA = staged.walk!.opId;

        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
          requireOpId: true,
        });
        expect(items.length).toBe(1);
        const sdId = items[0]!.id;
        seededContentIds.push(sdId);
        expect(items[0]!.op_id).toBe(opA);

        const chunksAfterA = await pollContentChunksFor(sdId, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(chunksAfterA.length).toBeGreaterThan(0);
        const chunkIdsAfterA = chunksAfterA.map((c) => c.id).sort();

        // Walk B — a LATER walk over the unchanged corpus (memo-skip).
        const walkB = await runWalk({ timeoutMs: WALK_BUDGET_MS });
        expect(walkB.opId).not.toBe(opA);

        // SURVIVAL: the sd row + every derived chunk row still exist with
        // the SAME identities, and the lineage keeps walk A's op_id (S265:
        // a no-op re-ingest does NOT re-stamp).
        const { data: sdAfterB, error: sdAfterBError } = await client
          .from('source_documents')
          .select('id, op_id')
          .eq('id', sdId)
          .maybeSingle();
        expect(sdAfterBError).toBeNull();
        expect(sdAfterB).not.toBeNull();
        expect(sdAfterB!.op_id).toBe(opA);

        const { data: chunksAfterB, error: chunksAfterBError } = await client
          .from('content_chunks')
          .select('id, op_id')
          .eq('source_document_id', sdId);
        expect(chunksAfterBError).toBeNull();
        expect(chunksAfterB).not.toBeNull();
        expect(chunksAfterB!.map((c) => c.id as string).sort()).toEqual(
          chunkIdsAfterA,
        );
        for (const chunk of chunksAfterB!) {
          expect(chunk.op_id).toBe(opA);
        }
      },
      WALK_BUDGET_MS * 2 + 120_000,
    );

    // DOCUMENTED GAP — named skip so the census counts it separately (the
    // §5 tier-model precedent: not silently green, not honestly-red noise).
    it.skip('SKIPPED[no-corpus-removal-primitive]: derived rows outlive engine orphan-cleanup after source removal (R4 orphan half — needs a corpus delete route the harness does not have)', () => {
      // id-396/TECH.md:55-59 — implement when a corpus-file removal
      // primitive exists (/stage only adds today).
    });
  },
);
