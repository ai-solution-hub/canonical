/**
 * {59.13} — UC3 sweeping-rename orchestrator (batched single-actor file
 * write-back). PRODUCT PC-6 / INV-6 (TECH §PC-6→INV-6).
 *
 * {138.12} T1 RE-POINT (necessary collateral, TECH §3.3 T1/§2.1 R(a)):
 * `runSweep` calls the SHARED `writeBackFileFirst` primitive, whose file leg
 * PUTs into the `corpus` Storage bucket instead of rewriting a real on-disk
 * file. This test double models the bucket as an in-memory object store
 * (`db.objects`, keyed by `storage_path`) plus a stubbed writer-fence RPC,
 * rather than writing to a real temp directory.
 *
 * ID-131 {131.17} G-IMS-DELETE KEEP-list RE-POINT: `sweep.ts` +
 * `write-back.ts` now read/write `source_documents` directly (`content` ->
 * `extracted_text`) keyed by the SAME id the caller passes as
 * `contentItemId` — the FORMER two-hop `content_items` -> `source_document_id`
 * FK -> `source_documents.storage_path` indirection collapses to ONE direct
 * read/write, since content_items and source_documents were independent PK
 * spaces pre-repoint. The mock below models a single `source_documents`
 * table (extracted_text + storage_path per id) rather than the former
 * two-table split.
 *
 * ID-131 FIX-SLICE (S447, BI-34): `runSweep` no longer INSERTs a
 * `content_history` audit snapshot per match — `content_item_id` has been a
 * dead FK since the M0c debris-wipe (content_items is permanently empty;
 * every insert FK-violated), and content_history itself drops at M6.
 *
 * ID-131.19 S450 Wave 1 Fix 4 (this Subtask): `rollbackSweep` — which still
 * READ `content_history` by `metadata.sweep_id` post-S447 — is REMOVED
 * entirely from `sweep.ts` (0 production callers, confirmed via
 * `gitnexus_impact` + a repo-wide grep; content_history drops at M6). The
 * rollback-specific tests (PROOF 3, PROOF 5, and the `content_history` mock
 * table + `HistoryRow` plumbing they depended on) are removed alongside —
 * there is no `rollbackSweep` left to exercise.
 *
 * The testStrategy proofs (re-targeted to Storage, {138.12}; audit-write
 * proof re-targeted again for the content_history retirement, S447):
 *   1. one sweep PUTs N objects at their storage_path (object key);
 *   2. all N matches share a single sweep-id (no content_history audit
 *      write — retired, BI-34);
 *   4. arbitrate()/arbitrateMany() are NEVER called (batched single-actor).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSweep } from '@/lib/edit-intent/sweep';
import type { SweepMatchInput } from '@/lib/edit-intent/sweep';
import { CORPUS_BUCKET } from '@/lib/edit-intent/write-back';

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
 * In-memory supabase stub modelling the table + Storage surface `runSweep`
 * touches: source_documents (extracted_text + storage_path, ID-131 {131.17}
 * — a single row per id, read/written directly by PK; `contentItemId` IS the
 * source_documents id post-repoint, no second-table indirection), the
 * `corpus` Storage bucket (an in-memory object store keyed by storage_path,
 * {138.12} re-point), and the writer-fence RPC (always succeeds —
 * single-actor, no real concurrency to model here). The stub is deliberately
 * small — it only models the exact query shapes the code issues. It
 * DELIBERATELY does not model `content_history` (ID-131.19 S450 Wave 1
 * Fix 4) — `runSweep` never touches it, and `from()`'s catch-all
 * `throw new Error('unexpected table ...')` below is now itself the
 * regression guard against a future edit reintroducing that read/write.
 */
function makeDb(files: Record<string, { rel: string; content: string }>): {
  client: unknown;
  liveContent: () => Record<string, string>;
  objects: Record<string, string>;
} {
  // One source_documents row per item — extracted_text (live "content") +
  // storage_path (the corpus bucket object key), keyed directly by the id
  // the caller passes as `contentItemId`.
  const docs: Record<string, { extracted_text: string; storage_path: string }> =
    {};
  // The `corpus` bucket's in-memory object store, keyed by storage_path
  // (the {138.12} object key) — seeded with each match's PRIOR bytes, the
  // same role the real temp-dir files played pre-re-point.
  const objects: Record<string, string> = {};
  for (const [id, f] of Object.entries(files)) {
    docs[id] = { extracted_text: f.content, storage_path: f.rel };
    objects[f.rel] = f.content;
  }

  // A tiny PostgREST-shaped builder. Each `.from(table)` returns a builder
  // whose terminal awaitable resolves the query. We only model the verbs the
  // production code uses.
  function from(table: string) {
    if (table === 'source_documents') {
      return {
        select() {
          return {
            eq(_col: string, id: string) {
              return {
                async maybeSingle() {
                  const doc = docs[id];
                  if (!doc) return { data: null, error: null };
                  return {
                    data: { storage_path: doc.storage_path },
                    error: null,
                  };
                },
                async single() {
                  const doc = docs[id];
                  if (!doc)
                    return { data: null, error: { message: 'not found' } };
                  return {
                    data: { extracted_text: doc.extracted_text },
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(patch: { extracted_text?: string }) {
          return {
            async eq(_col: string, id: string) {
              if (docs[id] && patch.extracted_text !== undefined) {
                docs[id].extracted_text = patch.extracted_text;
              }
              return { error: null };
            },
          };
        },
      };
    }
    // content_history is DELIBERATELY not modelled (ID-131.19 S450 Wave 1
    // Fix 4) — runSweep never touches it; this throw is the regression
    // guard against a future edit reintroducing that read/write.
    throw new Error(`unexpected table ${table}`);
  }

  // The `corpus` Storage bucket double — an in-memory object store keyed by
  // storage_path (the {138.12} object key), backing `writeBackFileFirst`'s
  // Storage leg (download = snapshot, upload = PUT/restore).
  const storageBucket = {
    async download(objectKey: string) {
      if (!(objectKey in objects)) {
        return { data: null, error: { message: 'Object not found' } };
      }
      return { data: new Blob([objects[objectKey]]), error: null };
    },
    async upload(objectKey: string, content: string) {
      objects[objectKey] = content;
      return { data: { path: objectKey }, error: null };
    },
  };
  const storage = {
    from(bucket: string) {
      if (bucket !== CORPUS_BUCKET) {
        throw new Error(`unexpected bucket ${bucket}`);
      }
      return storageBucket;
    },
  };

  // The writer-fence RPC — always succeeds (single-actor sweep, no real
  // concurrency to model here); mirrors createMockSupabaseClient()'s default.
  async function rpc() {
    return { data: true, error: null };
  }

  return {
    client: { from, storage, rpc } as unknown,
    objects,
    liveContent: () => {
      const out: Record<string, string> = {};
      for (const [id, doc] of Object.entries(docs))
        out[id] = doc.extracted_text;
      return out;
    },
  };
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

  it('PROOF 1+2 — PUTs N objects at storage_path; ALL share one sweep-id; NO content_history audit row written (retired, BI-34)', async () => {
    const db = makeDb({
      [ITEM_A]: { rel: REL.a, content: PRIOR.a },
      [ITEM_B]: { rel: REL.b, content: PRIOR.b },
      [ITEM_C]: { rel: REL.c, content: PRIOR.c },
    });

    const result = await runSweep({
      supabase: db.client as never,
      matches: matches(),
      intent: 'structural',
      actorId: ACTOR,
    });

    // Every affected object was rewritten at its EXACT storage_path (object key).
    expect(db.objects[REL.a]).toBe(NEW.a);
    expect(db.objects[REL.b]).toBe(NEW.b);
    expect(db.objects[REL.c]).toBe(NEW.c);

    // ONE sweep-id, shared by all three matches.
    expect(result.sweepId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.matchCount).toBe(3);
    const ids = result.matches.map((m) => m.contentItemId).sort();
    expect(ids).toEqual([ITEM_A, ITEM_B, ITEM_C].sort());

    // ID-131 FIX-SLICE (S447): the per-match content_history audit insert is
    // retired (dead FK post-M0c debris-wipe) — the mock's `from()` throws on
    // any table other than source_documents (content_history is
    // deliberately not modelled, ID-131.19 S450 Wave 1 Fix 4), so this test
    // completing without throwing IS the proof no history row is attempted.
  });

  it('PROOF 4 — does NOT invoke arbitrate()/arbitrateMany() (batched single-actor)', async () => {
    const arbitrateSpy = vi.spyOn(arbitrateModule, 'arbitrate');
    const arbitrateManySpy = vi.spyOn(arbitrateModule, 'arbitrateMany');

    const db = makeDb({
      [ITEM_A]: { rel: REL.a, content: PRIOR.a },
      [ITEM_B]: { rel: REL.b, content: PRIOR.b },
      [ITEM_C]: { rel: REL.c, content: PRIOR.c },
    });

    await runSweep({
      supabase: db.client as never,
      matches: matches(),
      intent: 'data',
      actorId: ACTOR,
    });

    expect(arbitrateSpy).not.toHaveBeenCalled();
    expect(arbitrateManySpy).not.toHaveBeenCalled();
  });

  it('does not write a content_history row even for a single-match sweep (audit write retired, BI-34)', async () => {
    const db = makeDb({ [ITEM_A]: { rel: REL.a, content: PRIOR.a } });

    const result = await runSweep({
      supabase: db.client as never,
      matches: [{ contentItemId: ITEM_A, newContent: NEW.a }],
      intent: 'data',
      actorId: ACTOR,
    });

    expect(result.matchCount).toBe(1);
    expect(db.objects[REL.a]).toBe(NEW.a);
  });

  // rollbackSweep tests REMOVED (ID-131.19 S450 Wave 1 Fix 4) — the function
  // itself is removed from sweep.ts (0 production callers; see the module
  // header for the full rationale). Nothing left to exercise.
});
