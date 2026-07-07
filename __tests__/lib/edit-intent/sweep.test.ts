/**
 * {59.13} — UC3 sweeping-rename orchestrator (batched single-actor file
 * write-back). PRODUCT PC-6 / INV-6 (TECH §PC-6→INV-6).
 *
 * {138.12} T1 RE-POINT (necessary collateral, TECH §3.3 T1/§2.1 R(a)):
 * `runSweep` calls the SHARED `writeBackFileFirst` primitive, whose file leg
 * PUTs into the `corpus` Storage bucket instead of rewriting a real on-disk
 * file. `configureSweepDb()` below wires the shared
 * `createMockSupabaseClient()` double's `storage.from(CORPUS_BUCKET)` bucket
 * as an in-memory object store (keyed by `storage_path`) rather than writing
 * to a real temp directory.
 *
 * ID-131 {131.17} G-IMS-DELETE KEEP-list RE-POINT: `sweep.ts` +
 * `write-back.ts` now read/write `source_documents` directly (`content` ->
 * `extracted_text`) keyed by the SAME id the caller passes as
 * `contentItemId` — the FORMER two-hop `content_items` -> `source_document_id`
 * FK -> `source_documents.storage_path` indirection collapses to ONE direct
 * read/write, since content_items and source_documents were independent PK
 * spaces pre-repoint.
 *
 * ID-131 FIX-SLICE (S447, BI-34): `runSweep` no longer INSERTs a
 * `content_history` audit snapshot per match — `content_item_id` has been a
 * dead FK since the M0c debris-wipe (content_items is permanently empty;
 * every insert FK-violated), and content_history itself drops at M6.
 *
 * ID-131.19 S450 Wave 1 Fix 4: `rollbackSweep` — which still READ
 * `content_history` by `metadata.sweep_id` post-S447 — was REMOVED entirely
 * from `sweep.ts` (0 production callers, confirmed via `gitnexus_impact` + a
 * repo-wide grep; content_history drops at M6). The rollback-specific tests
 * (PROOF 3, PROOF 5) were removed alongside — there is no `rollbackSweep`
 * left to exercise.
 *
 * bl-403 (mock-discipline migration, S446 check-138-12 nit): the hand-rolled
 * `makeDb` Supabase double (pre-existing debt, extended not introduced by
 * {138.12}) is replaced by the shared `createMockSupabaseClient()` helper
 * (`__tests__/helpers/mock-supabase.ts`) per test-philosophy's mock
 * discipline. The `content_history`-never-touched regression guard, formerly
 * an incidental `from()` throw on any unmodelled table, is now an explicit
 * assertion (`expect(mockSupabase.from).not.toHaveBeenCalledWith('content_history')`).
 *
 * The testStrategy proofs (re-targeted to Storage, {138.12}; audit-write
 * proof re-targeted again for the content_history retirement, S447):
 *   1. one sweep PUTs N objects at their storage_path (object key);
 *   2. all N matches share a single sweep-id (no content_history audit
 *      write — retired, BI-34);
 *   4. arbitrate()/arbitrateMany() are NEVER called (batched single-actor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSweep } from '@/lib/edit-intent/sweep';
import type { SweepMatchInput } from '@/lib/edit-intent/sweep';
import { CORPUS_BUCKET } from '@/lib/edit-intent/write-back';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// Spy targets — proves the sweep NEVER calls arbitration (batched single-actor).
import * as arbitrateModule from '@/lib/edit-intent/arbitrate';

// ID-131 {131.17}: these are source_documents ids (the `contentItemId` field
// name is kept for caller-contract stability — see sweep.ts/write-back.ts).
// Must be valid v4-shaped UUIDs for the route boundary.
const ITEM_A = '11111111-1111-4111-8111-111111111111';
const ITEM_B = '22222222-2222-4222-8222-222222222222';
const ITEM_C = '33333333-3333-4333-8333-333333333333';
const ACTOR = 'a0000000-0000-4000-8000-000000000099';

/**
 * The shape of the storage bucket double `createMockSupabaseClient()` wires
 * `storage.from()` to resolve to (mirrors `write-back.test.ts`'s local
 * `MockStorageBucket` — the shared helper's `storage.from` return type is a
 * bare, un-parameterised Mock, so a local cast is the minimal fix).
 */
interface MockStorageBucket {
  upload: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
}

/** The corpus-bucket storage double `mockSupabase.storage.from(CORPUS_BUCKET)` resolves to. */
function bucket(client: MockSupabaseClient): MockStorageBucket {
  const from = client.storage.from as unknown as (
    bucketName: string,
  ) => MockStorageBucket;
  return from(CORPUS_BUCKET);
}

/**
 * Wire the shared mock to model the exact surface `runSweep` touches:
 *   - `source_documents.storage_path` resolution
 *     (`writeBackFileFirst`'s `.select('storage_path').eq('id', id)
 *     .maybeSingle()`), queued in the SAME order `files` iterates — `runSweep`
 *     is a sequential for-loop over `matches`, so queuing
 *     `maybeSingle.mockResolvedValueOnce()` calls by that same order is
 *     deterministic;
 *   - the `corpus` Storage bucket as an in-memory object store keyed by
 *     `storage_path` (download = snapshot, upload = PUT/restore, {138.12}
 *     re-point);
 *   - the writer-fence RPC, always succeeding (single-actor sweep, no real
 *     concurrency to model).
 *
 * `source_documents.extracted_text` UPDATEs resolve via the shared chain's
 * default `.then()` (`{ data: [], error: null }` — falsy `error`, so
 * `applyDbLeg` never throws); no per-id UPDATE echo is modelled since
 * `runSweep` never reads `extracted_text` back.
 */
function configureSweepDb(
  client: MockSupabaseClient,
  files: Record<string, { rel: string; content: string }>,
): { objects: Record<string, string> } {
  const objects: Record<string, string> = {};
  for (const f of Object.values(files)) objects[f.rel] = f.content;

  for (const f of Object.values(files)) {
    client._chain.maybeSingle.mockResolvedValueOnce({
      data: { storage_path: f.rel },
      error: null,
    });
  }

  const storageBucket = bucket(client);
  storageBucket.download.mockImplementation(async (objectKey: string) => {
    if (!(objectKey in objects)) {
      return { data: null, error: { message: 'Object not found' } };
    }
    return { data: new Blob([objects[objectKey]]), error: null };
  });
  storageBucket.upload.mockImplementation(
    async (objectKey: string, content: string) => {
      objects[objectKey] = content;
      return { data: { path: objectKey }, error: null };
    },
  );

  client.rpc.mockResolvedValue({ data: true, error: null });

  return { objects };
}

describe('runSweep — UC3 batched single-actor sweep', () => {
  const REL = {
    a: 'corpus/team/alpha.md',
    b: 'corpus/team/bravo.md',
    c: 'corpus/team/charlie.md',
  };
  const PRIOR = {
    a: '# Alpha\n\nold-name appears here\n',
    b: '# Bravo\n\nold-name twice: old-name\n',
    c: '# Charlie\n\nold-name at the end\n',
  };
  const NEW = {
    a: '# Alpha\n\nnew-name appears here\n',
    b: '# Bravo\n\nnew-name twice: new-name\n',
    c: '# Charlie\n\nnew-name at the end\n',
  };

  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function matches(): SweepMatchInput[] {
    return [
      { contentItemId: ITEM_A, newContent: NEW.a },
      { contentItemId: ITEM_B, newContent: NEW.b },
      { contentItemId: ITEM_C, newContent: NEW.c },
    ];
  }

  function client(): Parameters<typeof runSweep>[0]['supabase'] {
    return mockSupabase as unknown as Parameters<
      typeof runSweep
    >[0]['supabase'];
  }

  it('PROOF 1+2 — PUTs N objects at storage_path; ALL share one sweep-id; NO content_history audit row written (retired, BI-34)', async () => {
    const { objects } = configureSweepDb(mockSupabase, {
      [ITEM_A]: { rel: REL.a, content: PRIOR.a },
      [ITEM_B]: { rel: REL.b, content: PRIOR.b },
      [ITEM_C]: { rel: REL.c, content: PRIOR.c },
    });

    const result = await runSweep({
      supabase: client(),
      matches: matches(),
      intent: 'structural',
      actorId: ACTOR,
    });

    // Every affected object was rewritten at its EXACT storage_path (object key).
    expect(objects[REL.a]).toBe(NEW.a);
    expect(objects[REL.b]).toBe(NEW.b);
    expect(objects[REL.c]).toBe(NEW.c);

    // ONE sweep-id, shared by all three matches.
    expect(result.sweepId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.matchCount).toBe(3);
    const ids = result.matches.map((m) => m.contentItemId).sort();
    expect(ids).toEqual([ITEM_A, ITEM_B, ITEM_C].sort());

    // ID-131 FIX-SLICE (S447): the per-match content_history audit insert is
    // retired (dead FK post-M0c debris-wipe) — assert directly that `from()`
    // was never called with 'content_history' (the regression guard against
    // a future edit reintroducing that read/write).
    expect(mockSupabase.from).not.toHaveBeenCalledWith('content_history');
  });

  it('PROOF 4 — does NOT invoke arbitrate()/arbitrateMany() (batched single-actor)', async () => {
    const arbitrateSpy = vi.spyOn(arbitrateModule, 'arbitrate');
    const arbitrateManySpy = vi.spyOn(arbitrateModule, 'arbitrateMany');

    configureSweepDb(mockSupabase, {
      [ITEM_A]: { rel: REL.a, content: PRIOR.a },
      [ITEM_B]: { rel: REL.b, content: PRIOR.b },
      [ITEM_C]: { rel: REL.c, content: PRIOR.c },
    });

    await runSweep({
      supabase: client(),
      matches: matches(),
      intent: 'data',
      actorId: ACTOR,
    });

    expect(arbitrateSpy).not.toHaveBeenCalled();
    expect(arbitrateManySpy).not.toHaveBeenCalled();
  });

  it('does not write a content_history row even for a single-match sweep (audit write retired, BI-34)', async () => {
    const { objects } = configureSweepDb(mockSupabase, {
      [ITEM_A]: { rel: REL.a, content: PRIOR.a },
    });

    const result = await runSweep({
      supabase: client(),
      matches: [{ contentItemId: ITEM_A, newContent: NEW.a }],
      intent: 'data',
      actorId: ACTOR,
    });

    expect(result.matchCount).toBe(1);
    expect(objects[REL.a]).toBe(NEW.a);
    expect(mockSupabase.from).not.toHaveBeenCalledWith('content_history');
  });

  // rollbackSweep tests REMOVED (ID-131.19 S450 Wave 1 Fix 4) — the function
  // itself is removed from sweep.ts (0 production callers; see the module
  // header for the full rationale). Nothing left to exercise.
});
