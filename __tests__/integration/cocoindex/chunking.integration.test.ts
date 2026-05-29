/**
 * Integration test — cocoindex chunking stage (ID-56.9).
 *
 * Subtask ID-56.9 (chunking-stage invariant coverage). Exercises the {56.8}
 * budget-driven chunking stage end-to-end: a file staged into the watched
 * corpus produces `content_chunks` rows via the cocoindex flow's
 * RecursiveSplitter stage, with the PRODUCT C-10..C-13 / C-21 / C-31 shape.
 *
 * Four cases (each cites the PRODUCT invariant it verifies):
 *   1. Short doc → single row (C-10).
 *   2. Long doc → multi-row, monotonic positions (C-11, C-12).
 *   3. Memo no-op re-ingest → op_id + embedding unchanged (C-31, §2.7).
 *   4. op_id round-trip → chunk op_id == parent content_items.op_id, and a
 *      pipeline_runs row exists for that op_id (C-13, C-21).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. These tests SKIP locally (the
 * fixture-staging service is not yet running — S273 OQ); that is EXPECTED and
 * correct. Do NOT force them green locally.
 *
 * References:
 *   - docs/specs/id-56-content-model-invariants/PRODUCT.md C-10..C-13, C-21,
 *     C-31.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.7 (memo cascade).
 *   - docs/reference/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasRealLiveDbCredentials } from '../helpers/supabase-client';
import {
  dropFixture,
  pollContentChunksFor,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import { assertOpIdRoundTrip, UUID_V4_REGEX } from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

// The {56.5}-ratified Variant-B byte budget the {56.8} stage runs with — used
// only to bound the last-chunk char_count assertion in case 2 (C-12).
const MIN_CHUNK_SIZE_BYTES = 1000;
const CHUNK_SIZE_BYTES = 2000;

const POLL_TIMEOUT_MS = 120_000;

// Distinct title prefixes per case so the parallel-safe poll + cleanup never
// collide across cases sharing the same suite run.
const SHORT_PREFIX = `[56.9-C10-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const LONG_PREFIX = `[56.9-C11-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const MEMO_PREFIX = `[56.9-C31-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const ROUNDTRIP_PREFIX = `[56.9-C13-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;

const SHORT_FIXTURE = '__tests__/fixtures/cocoindex-chunking/short-clause.md';
const LONG_FIXTURE = '__tests__/fixtures/cocoindex-chunking/long-terms.md';

const seededContentIds: string[] = [];

beforeAll(async () => {
  if (!ENABLED) return;
  // Stage all four fixtures up front so the pipeline processes them in
  // parallel; each case polls for its own prefix.
  await Promise.all([
    stageFixture({
      fixturePath: SHORT_FIXTURE,
      destPath: `chunking-c10/${SHORT_PREFIX}.md`,
      titlePrefix: SHORT_PREFIX,
    }),
    stageFixture({
      fixturePath: LONG_FIXTURE,
      destPath: `chunking-c11/${LONG_PREFIX}.md`,
      titlePrefix: LONG_PREFIX,
    }),
    stageFixture({
      fixturePath: LONG_FIXTURE,
      destPath: `chunking-c13/${ROUNDTRIP_PREFIX}.md`,
      titlePrefix: ROUNDTRIP_PREFIX,
    }),
  ]);
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({
    titlePrefix: SHORT_PREFIX,
    contentIds: seededContentIds,
  });
}, 60_000);

describe.skipIf(!ENABLED)('cocoindex chunking stage', () => {
  it(
    'C-10 — a short doc (< chunk_size) lands as exactly one content_chunks row at position 0',
    async () => {
      const items = await pollContentItemsFor(SHORT_PREFIX, {
        timeoutMs: POLL_TIMEOUT_MS,
      });
      expect(items.length).toBe(1);
      const parent = items[0]!;
      seededContentIds.push(parent.id);

      const chunks = await pollContentChunksFor(parent.id, {
        timeoutMs: POLL_TIMEOUT_MS,
      });

      // C-10: exactly one row for a short document.
      expect(chunks.length).toBe(1);
      const chunk = chunks[0]!;
      expect(chunk.position).toBe(0);
      // C-30: the chunk carries a populated embedding.
      expect(chunk.embedding).not.toBeNull();
      // C-21 / C-13: op_id stamped + a valid v4 UUID.
      expect(chunk.op_id).not.toBeNull();
      expect(chunk.op_id!).toMatch(UUID_V4_REGEX);
      // C-13 + [GAP-CMI-004] (a): heading-derived columns are NULL; heading_path
      // resolves to its DB default '{}' (an empty array, NOT NULL).
      expect(chunk.heading_text).toBeNull();
      expect(chunk.heading_level).toBeNull();
      expect(chunk.parent_chunk_id).toBeNull();
      expect(chunk.heading_path).toEqual([]);
    },
    POLL_TIMEOUT_MS + 60_000,
  );

  it(
    'C-11/C-12 — a long doc splits into multiple rows with monotonic positions and budget-bounded sizes',
    async () => {
      const items = await pollContentItemsFor(LONG_PREFIX, {
        timeoutMs: POLL_TIMEOUT_MS,
      });
      expect(items.length).toBe(1);
      const parent = items[0]!;
      seededContentIds.push(parent.id);

      const chunks = await pollContentChunksFor(parent.id, {
        timeoutMs: POLL_TIMEOUT_MS,
        minRows: 2,
      });

      // C-11: a doc longer than chunk_size produces multiple rows.
      expect(chunks.length).toBeGreaterThan(1);

      // C-11: positions are a contiguous monotonic 0,1,2... run.
      const positions = chunks.map((c) => c.position);
      expect(positions).toEqual(
        Array.from({ length: chunks.length }, (_, i) => i),
      );

      // Every chunk carries a non-null op_id (C-21).
      for (const c of chunks) {
        expect(c.op_id).not.toBeNull();
        expect(c.op_id!).toMatch(UUID_V4_REGEX);
      }

      // C-12: the final chunk's char_count is consistent with the
      // min_chunk_size..chunk_size budget. (RecursiveSplitter's chunk_size is a
      // BYTE budget; for ASCII-dominant UK procurement prose char_count tracks
      // byte length closely. A small slack tolerates multi-byte characters and
      // the overlap region.) The C-10 single-row exception does not apply here
      // (this doc was split), so the floor is meaningful.
      const last = chunks[chunks.length - 1]!;
      expect(last.char_count).toBeGreaterThanOrEqual(
        MIN_CHUNK_SIZE_BYTES * 0.5,
      );
      expect(last.char_count).toBeLessThanOrEqual(CHUNK_SIZE_BYTES + 200);
    },
    POLL_TIMEOUT_MS + 60_000,
  );

  it(
    'C-31/§2.7 — a memo no-op re-ingest of identical bytes does NOT re-stamp op_id or re-embed the chunk rows',
    async () => {
      // First ingest.
      const items = await pollContentItemsFor(MEMO_PREFIX, {
        timeoutMs: POLL_TIMEOUT_MS,
      });
      expect(items.length).toBe(1);
      const parent = items[0]!;
      seededContentIds.push(parent.id);

      const before = await pollContentChunksFor(parent.id, {
        timeoutMs: POLL_TIMEOUT_MS,
      });
      expect(before.length).toBeGreaterThan(0);
      const beforeByPosition = new Map(before.map((c) => [c.position, c]));

      // Re-stage the IDENTICAL bytes under the same dest path → cocoindex's
      // content-hash memo (@coco.fn(memo=True)) skips the whole ingest_file
      // component, so the chunk rows are NOT re-declared (C-31, TECH §2.7).
      await stageFixture({
        fixturePath: LONG_FIXTURE,
        destPath: `chunking-c31/${MEMO_PREFIX}.md`,
        titlePrefix: MEMO_PREFIX,
      });

      // Give the watch loop time to observe-and-skip, then re-read.
      const after = await pollContentChunksFor(parent.id, {
        timeoutMs: POLL_TIMEOUT_MS,
        minRows: before.length,
      });

      // The row set is unchanged: same count, same op_id + embedding per
      // position (no delete-then-reinsert, no re-stamp).
      expect(after.length).toBe(before.length);
      for (const a of after) {
        const b = beforeByPosition.get(a.position);
        expect(b).toBeDefined();
        expect(a.id).toBe(b!.id);
        expect(a.op_id).toBe(b!.op_id);
        expect(a.embedding).toEqual(b!.embedding);
      }
    },
    POLL_TIMEOUT_MS + 120_000,
  );

  it(
    'C-13/C-21 — chunk op_id equals the parent content_items.op_id and round-trips to exactly one pipeline_runs row',
    async () => {
      const items = await pollContentItemsFor(ROUNDTRIP_PREFIX, {
        timeoutMs: POLL_TIMEOUT_MS,
      });
      expect(items.length).toBe(1);
      const parent = items[0]!;
      seededContentIds.push(parent.id);
      expect(parent.op_id).not.toBeNull();

      const chunks = await pollContentChunksFor(parent.id, {
        timeoutMs: POLL_TIMEOUT_MS,
        minRows: 2,
      });
      expect(chunks.length).toBeGreaterThan(1);

      // C-13: every chunk's op_id equals the parent content_items row's op_id
      // (same rel_path → same run).
      for (const c of chunks) {
        expect(c.op_id).toBe(parent.op_id);
      }

      // C-21: the op_id round-trips to EXACTLY one pipeline_runs row.
      const runId = await assertOpIdRoundTrip(parent.op_id!);
      expect(runId).toMatch(UUID_V4_REGEX);

      // Cross-check: the chunk's content_item_id FK points at the parent row.
      for (const c of chunks) {
        expect(c.content_item_id).toBe(parent.id);
      }
    },
    POLL_TIMEOUT_MS + 60_000,
  );
});
