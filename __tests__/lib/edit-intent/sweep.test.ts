/**
 * {59.13} — UC3 sweeping-rename orchestrator (batched single-actor file
 * write-back) + whole-sweep / per-match rollback. PRODUCT PC-6 / INV-6 (TECH
 * §PC-6→INV-6).
 *
 * {138.12} T1 RE-POINT (necessary collateral, TECH §3.3 T1/§2.1 R(a)): both
 * `runSweep`/`rollbackSweep` call the SHARED `writeBackFileFirst` primitive,
 * whose file leg PUTs into the `corpus` Storage bucket instead of rewriting a
 * real on-disk file. This test double models the bucket as an in-memory
 * object store (`db.objects`, keyed by `storage_path`) plus a stubbed
 * writer-fence RPC, rather than writing to a real temp directory.
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
 * The testStrategy proofs (unchanged in intent, re-targeted to Storage):
 *   1. one sweep PUTs N objects at their storage_path (object key);
 *   2. all N matches share a single sweep-id, recorded per-match (audit);
 *   3. whole-sweep rollback restores ALL N objects to their prior bytes;
 *   4. arbitrate()/arbitrateMany() are NEVER called (batched single-actor);
 *   5. per-match provenance is auditable AND per-match revert works.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSweep, rollbackSweep } from '@/lib/edit-intent/sweep';
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

interface HistoryRow {
  content_item_id: string;
  version: number;
  content: string;
  edit_intent: string | null;
  change_type: string;
  change_reason: string | null;
  metadata: { sweep_id?: string; prior_content?: string } | null;
  created_by: string | null;
}

/**
 * In-memory supabase stub modelling the tables + Storage surface the sweep +
 * rollback touch: source_documents (extracted_text + storage_path, ID-131
 * {131.17} — a single row per id, read/written directly by PK; `contentItemId`
 * IS the source_documents id post-repoint, no second-table indirection),
 * content_history (the per-match snapshot rows carrying the sweep-id
 * provenance — unchanged, out of this Subtask's file-ownership boundary),
 * the `corpus` Storage bucket (an in-memory object store keyed by
 * storage_path, {138.12} re-point), and the writer-fence RPC (always
 * succeeds — single-actor, no real concurrency to model here). The stub is
 * deliberately small — it only models the exact query shapes the code issues.
 */
function makeDb(files: Record<string, { rel: string; content: string }>): {
  client: unknown;
  history: HistoryRow[];
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
  const history: HistoryRow[] = [];

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
    if (table === 'content_history') {
      return {
        select() {
          return {
            eq(col: string, val: string) {
              // Two consumers: maxVersion-by-item, and whole-sweep fetch by
              // metadata->>'sweep_id'. The route distinguishes them by the
              // builder it chains; we expose both shapes.
              if (col === 'content_item_id') {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          async maybeSingle() {
                            const rows = history
                              .filter((r) => r.content_item_id === val)
                              .sort((a, b) => b.version - a.version);
                            return {
                              data: rows[0] ?? null,
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              }
              // sweep_id fetch
              return {
                async then(resolve: (v: unknown) => void) {
                  const rows = history.filter(
                    (r) => r.metadata?.sweep_id === val,
                  );
                  resolve({ data: rows, error: null });
                },
              };
            },
          };
        },
        insert(row: Partial<HistoryRow>) {
          history.push({
            content_item_id: row.content_item_id ?? '',
            version: row.version ?? 1,
            content: row.content ?? '',
            edit_intent: row.edit_intent ?? null,
            change_type: row.change_type ?? 'edit',
            change_reason: row.change_reason ?? null,
            metadata: row.metadata ?? null,
            created_by: row.created_by ?? null,
          });
          return { error: null };
        },
      };
    }
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
    history,
    objects,
    liveContent: () => {
      const out: Record<string, string> = {};
      for (const [id, doc] of Object.entries(docs))
        out[id] = doc.extracted_text;
      return out;
    },
  };
}

describe('runSweep — UC3 batched single-actor sweep + whole-sweep rollback', () => {
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

  it('PROOF 1+2 — PUTs N objects at storage_path; ALL share one sweep-id recorded per-match', async () => {
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

    // Per-match provenance: every history row carries the SAME sweep-id and the
    // sweep's single intent — recorded per-match for audit.
    expect(db.history).toHaveLength(3);
    for (const row of db.history) {
      expect(row.metadata?.sweep_id).toBe(result.sweepId);
      expect(row.edit_intent).toBe('structural');
      expect(row.change_reason).toBe(`sweep:${result.sweepId}`);
      // prior bytes captured per-match so whole-sweep + per-match revert work.
      expect(typeof row.metadata?.prior_content).toBe('string');
    }
    const ids = db.history.map((r) => r.content_item_id).sort();
    expect(ids).toEqual([ITEM_A, ITEM_B, ITEM_C].sort());
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

  it('PROOF 3 — whole-sweep rollback restores ALL N objects to their prior bytes', async () => {
    const db = makeDb({
      [ITEM_A]: { rel: REL.a, content: PRIOR.a },
      [ITEM_B]: { rel: REL.b, content: PRIOR.b },
      [ITEM_C]: { rel: REL.c, content: PRIOR.c },
    });

    const { sweepId } = await runSweep({
      supabase: db.client as never,
      matches: matches(),
      intent: 'structural',
      actorId: ACTOR,
    });

    // Objects now hold the new bytes.
    expect(db.objects[REL.a]).toBe(NEW.a);

    const rolled = await rollbackSweep({
      supabase: db.client as never,
      sweepId,
      actorId: ACTOR,
    });

    expect(rolled.restoredCount).toBe(3);
    // Every object restored to its PRIOR bytes (whole-sweep, as a unit).
    expect(db.objects[REL.a]).toBe(PRIOR.a);
    expect(db.objects[REL.b]).toBe(PRIOR.b);
    expect(db.objects[REL.c]).toBe(PRIOR.c);
    // Live DB content restored too.
    const live = db.liveContent();
    expect(live[ITEM_A]).toBe(PRIOR.a);
    expect(live[ITEM_B]).toBe(PRIOR.b);
    expect(live[ITEM_C]).toBe(PRIOR.c);
  });

  it('PROOF 5 — per-match revert restores ONLY that match (others untouched)', async () => {
    const db = makeDb({
      [ITEM_A]: { rel: REL.a, content: PRIOR.a },
      [ITEM_B]: { rel: REL.b, content: PRIOR.b },
      [ITEM_C]: { rel: REL.c, content: PRIOR.c },
    });

    const { sweepId } = await runSweep({
      supabase: db.client as never,
      matches: matches(),
      intent: 'structural',
      actorId: ACTOR,
    });

    const rolled = await rollbackSweep({
      supabase: db.client as never,
      sweepId,
      actorId: ACTOR,
      contentItemId: ITEM_B, // per-match revert
    });

    expect(rolled.restoredCount).toBe(1);
    // Only B restored; A and C still hold the new bytes.
    expect(db.objects[REL.b]).toBe(PRIOR.b);
    expect(db.objects[REL.a]).toBe(NEW.a);
    expect(db.objects[REL.c]).toBe(NEW.c);
  });

  it('stamps the sweep intent verbatim WITHOUT arbitration even for a single match', async () => {
    const db = makeDb({ [ITEM_A]: { rel: REL.a, content: PRIOR.a } });

    const result = await runSweep({
      supabase: db.client as never,
      matches: [{ contentItemId: ITEM_A, newContent: NEW.a }],
      intent: 'data',
      actorId: ACTOR,
    });

    expect(result.matchCount).toBe(1);
    expect(db.history[0].edit_intent).toBe('data');
    expect(db.history[0].metadata?.sweep_id).toBe(result.sweepId);
  });
});
