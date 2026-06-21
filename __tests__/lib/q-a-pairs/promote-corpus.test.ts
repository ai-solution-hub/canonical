/**
 * Unit tests for promoteCorpusExtractions — ID-59 {59.22} + {59.23} + {59.24}
 *                                                  + {59.29} (sidecar emit)
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 4, 5, 6, 7
 *       specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-sidecar-canonical.md
 *       R1 (corpus-promotion emit leg)
 * Product invariants tested: INV-1, INV-3, INV-4, INV-5, INV-6, INV-7, INV-8,
 *                            INV-9, INV-10, INV-11, INV-12 + INV-23 equation
 *
 * Tests verify OBSERVABLE BEHAVIOUR via the returned PromotionSummary and
 * the mock Supabase calls made — NOT implementation internals.
 *
 * Mock discipline: createMockSupabaseClient() from the shared helper — never
 * hand-roll Supabase mocks (per __tests__/CLAUDE.md + test-philosophy). The
 * {59.29} sidecar-emit tests write to a REAL temp directory (a stand-in for
 * COCOINDEX_SOURCE_PATH) so the carried-set file contents are proven against
 * actual bytes on disk, mirroring the {59.9} write-back.test.ts pattern.
 *
 * generateEmbedding is stubbed via vi.hoisted() per __tests__/CLAUDE.md hoisting
 * rules — module-level mock variables must be initialised with vi.hoisted().
 *
 * @vitest-environment node
 */

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
import {
  qaSidecarRelPath,
  sdUuid5,
  parseCarriedSet,
} from '@/lib/q-a-pairs/sidecar-path';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factory must be initialised before vi.mock() is hoisted
// ---------------------------------------------------------------------------
const { mockGenerateEmbedding } = vi.hoisted(() => {
  return { mockGenerateEmbedding: vi.fn() };
});

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

// ---------------------------------------------------------------------------
// SUT import
// ---------------------------------------------------------------------------
import {
  promoteCorpusExtractions,
  type PromotionSummary,
  type SupabaseClientLike,
} from '@/lib/q-a-pairs/promote-corpus';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const UUID_A = '00000000-0000-4000-a000-000000000001';
const UUID_B = '00000000-0000-4000-a000-000000000002';
const UUID_NEW_PAIR = '00000000-0000-4000-a000-000000000099';
const UUID_EXISTING_PAIR = '00000000-0000-4000-a000-000000000098';

/** Stub embedding — 1024-dim, non-null. */
const STUB_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i / 1024);

interface ExtractionRow {
  id: string;
  extracted_question_text: string;
  extracted_answer_text: string | null;
  promoted_to_pair_id: string | null;
  invalidated_at: string | null;
  extractor_kind: string;
  source_content_item_id: string | null;
  extraction_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function makeExtraction(overrides: Partial<ExtractionRow> = {}): ExtractionRow {
  return {
    id: UUID_A,
    extracted_question_text: 'What is the procurement threshold?',
    extracted_answer_text: 'The threshold is £25,000.',
    promoted_to_pair_id: null,
    invalidated_at: null,
    extractor_kind: 'llm_extraction',
    source_content_item_id: null,
    extraction_metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite — {59.22} core loop (retained, updated for embed summary field)
// ---------------------------------------------------------------------------

describe('promoteCorpusExtractions — {59.22} core loop', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    supabase = createMockSupabaseClient();
    vi.clearAllMocks();
    // Default: generateEmbedding resolves with stub embedding
    mockGenerateEmbedding.mockResolvedValue(STUB_EMBEDDING);
  });

  // -------------------------------------------------------------------------
  // Scenario 1: empty eligible set — nothing to do
  // -------------------------------------------------------------------------
  it('returns all-zero summary when RPC returns empty set', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.considered).toBe(0);
    expect(result.promoted).toBe(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.already_promoted).toBe(0);
    expect(result.embed_failed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: live unlinked extraction → pair inserted with correct field
  //   map, CAS succeeds, embed fires, pair published (INV-3/INV-4/INV-12)
  // -------------------------------------------------------------------------
  it('promotes a live unlinked extraction: correct field map, embed + publish together', async () => {
    const extraction = makeExtraction({ id: UUID_A });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // INSERT q_a_pairs → returns the new pair id
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });

    // CAS UPDATE on q_a_extractions → 1 row affected (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );

    // Embed UPDATE on q_a_pairs → 1 row affected (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.considered).toBe(1);
    expect(result.promoted).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.already_promoted).toBe(0);
    expect(result.embed_failed).toBe(0);

    // Verify INSERT field map
    const insertMock = supabase._chain.insert;
    expect(insertMock).toHaveBeenCalled();
    const insertPayload = insertMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // INV-4: origin_kind must be 'extracted_from_corpus'
    expect(insertPayload.origin_kind).toBe('extracted_from_corpus');
    // INV-6 field map
    expect(insertPayload.question_text).toBe(
      extraction.extracted_question_text,
    );
    expect(insertPayload.answer_standard).toBe(
      extraction.extracted_answer_text,
    );
    // alternate_question_phrasings omitted — DB DEFAULT '{}' fills it
    expect(insertPayload.alternate_question_phrasings).toBeUndefined();
    // publication_status must be 'draft' at insert time
    expect(insertPayload.publication_status).toBe('draft');
    // question_embedding must NOT be set in the INSERT (set via UPDATE)
    expect(insertPayload.question_embedding).toBeUndefined();
    // Form FKs must be absent (route-i pairs have no form response lineage)
    expect(insertPayload.source_form_response_id).toBeUndefined();
    expect(insertPayload.source_question_id).toBeUndefined();
    expect(insertPayload.source_workspace_id).toBeUndefined();

    // Verify generateEmbedding called with the extraction's question text
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      extraction.extracted_question_text,
    );

    // Verify embed UPDATE sets BOTH question_embedding AND publication_status
    // in the same payload (INV-12: publish ONLY with embedding together)
    const updateMock = supabase._chain.update;
    expect(updateMock).toHaveBeenCalled();
    const updateCalls = updateMock.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const embedUpdateCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'published',
    );
    expect(embedUpdateCall).toBeDefined();
    const embedUpdatePayload = embedUpdateCall![0];
    expect(embedUpdatePayload.question_embedding).toBe(
      JSON.stringify(STUB_EMBEDDING),
    );
    expect(embedUpdatePayload.publication_status).toBe('published');
  });

  // -------------------------------------------------------------------------
  // Scenario 3: NULL extracted_answer_text → skip with reason no_answer_text,
  //             no INSERT, no embed, no throw (INV-7)
  // -------------------------------------------------------------------------
  it('skips extraction with NULL answer text — records reason, no INSERT, no throw', async () => {
    const extraction = makeExtraction({
      id: UUID_A,
      extracted_answer_text: null,
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.considered).toBe(1);
    expect(result.promoted).toBe(0);
    expect(result.already_promoted).toBe(0);
    expect(result.embed_failed).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual({
      extractionId: UUID_A,
      reason: 'no_answer_text',
    });

    expect(supabase._chain.insert).not.toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scenario 4: empty/whitespace extracted_answer_text → skip (INV-7)
  // -------------------------------------------------------------------------
  it('skips extraction with empty/whitespace answer text', async () => {
    const extraction = makeExtraction({
      id: UUID_A,
      extracted_answer_text: '   ',
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('no_answer_text');
    expect(result.promoted).toBe(0);
    expect(result.embed_failed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: CAS returns 0 rows (concurrent race) →
  //   orphan pair DELETE fires, already_promoted === 1, no embed attempted
  // -------------------------------------------------------------------------
  it('on CAS 0-row result (race): deletes orphan pair, counts already_promoted, no embed', async () => {
    const extraction = makeExtraction({ id: UUID_A });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });

    // CAS UPDATE → 0 rows affected (race lost)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // DELETE orphan pair → success
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.promoted).toBe(0);
    expect(result.already_promoted).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.embed_failed).toBe(0);

    expect(supabase._chain.delete).toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scenario 6: RPC call fails → error propagates (not silently swallowed)
  // -------------------------------------------------------------------------
  it('throws when RPC returns an error', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'connection timeout',
        code: 'NETWORK_ERROR',
        details: '',
        hint: '',
      },
    });

    await expect(
      promoteCorpusExtractions(supabase as unknown as SupabaseClientLike),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test suite — {59.23} embed-decouple + self-heal (OQ-3)
// ---------------------------------------------------------------------------

describe('promoteCorpusExtractions — {59.23} embed-decouple + self-heal (OQ-3)', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    supabase = createMockSupabaseClient();
    vi.clearAllMocks();
    // Default: generateEmbedding resolves with stub embedding
    mockGenerateEmbedding.mockResolvedValue(STUB_EMBEDDING);
  });

  // -------------------------------------------------------------------------
  // OQ-3 Run 1: generateEmbedding THROWS → pair stays draft+NULL,
  //   summary.embed_failed includes it, batch does NOT throw,
  //   other rows still processed. (INV-10/INV-11)
  // -------------------------------------------------------------------------
  it('OQ-3 run 1: embed failure leaves pair draft+NULL, increments embed_failed, batch continues', async () => {
    const extractionA = makeExtraction({
      id: UUID_A,
      extracted_question_text: 'Question A?',
      extracted_answer_text: 'Answer A.',
    });
    const extractionB = makeExtraction({
      id: UUID_B,
      extracted_question_text: 'Question B?',
      extracted_answer_text: 'Answer B.',
    });

    supabase.rpc.mockResolvedValueOnce({
      data: [extractionA, extractionB],
      error: null,
    });

    // Row A: INSERT → new pair
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });
    // Row A: CAS → 1 row (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extractionA.id }], error: null }),
    );
    // Row A: generateEmbedding THROWS
    mockGenerateEmbedding.mockRejectedValueOnce(
      new Error('OpenAI embedding API timeout'),
    );

    // Row B: INSERT → new pair
    const UUID_NEW_PAIR_B = '00000000-0000-4000-a000-000000000097';
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR_B },
      error: null,
    });
    // Row B: CAS → 1 row (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extractionB.id }], error: null }),
    );
    // Row B: embed UPDATE → success
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR_B }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // Batch must NOT throw — embed failure is a soft error
    // promoted = 2 (both CAS-won; both count as promotion attempts)
    expect(result.considered).toBe(2);
    expect(result.promoted).toBe(2);
    // embed_failed = 1 (Row A whose generateEmbedding threw)
    expect(result.embed_failed).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.already_promoted).toBe(0);

    // INV-23 equation: published-this-run == promoted - embed_failed = 2 - 1 = 1
    expect(result.promoted - result.embed_failed).toBe(1);
  });

  // -------------------------------------------------------------------------
  // OQ-3 Run 2 (self-heal): a linked-but-unembedded row from the RPC →
  //   NO new INSERT, NO CAS UPDATE, embed + publish on the EXISTING pair.
  //   (R1 step 3d → step 4; INV-10, INV-11)
  // -------------------------------------------------------------------------
  it('OQ-3 self-heal: linked-but-unembedded row re-syncs carried + embeds existing pair, no insert, no CAS', async () => {
    // Extraction already linked in a prior run but embedding failed
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // single #1: {59.31} re-promote reads the pair's stored question_text. Same
    // value as the re-extraction → no mark-stale, focus stays on embed/publish.
    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: extraction.extracted_question_text },
      error: null,
    });
    // then #1: {59.31} carried-only UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );
    // then #2: embed UPDATE on the EXISTING pair → 1 row affected (publish)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.considered).toBe(1);
    // Self-heal counts as promoted (promotion attempt this run)
    expect(result.promoted).toBe(1);
    expect(result.embed_failed).toBe(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.already_promoted).toBe(0);

    // INV-23: published-this-run == promoted - embed_failed = 1 - 0 = 1
    expect(result.promoted - result.embed_failed).toBe(1);

    // NO INSERT on q_a_pairs (pair already exists)
    expect(supabase._chain.insert).not.toHaveBeenCalled();

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      extraction.extracted_question_text,
    );

    // Two UPDATEs now: the {59.31} carried re-sync, then the embed/publish.
    // Neither is a CAS update on q_a_extractions (no promoted_to_pair_id write).
    const updateMock = supabase._chain.update;
    expect(updateMock).toHaveBeenCalledTimes(2);
    const updateCalls = updateMock.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(
      updateCalls.find((call) => 'promoted_to_pair_id' in call[0]),
    ).toBeUndefined();

    // The carried re-sync UPDATE carries no lifecycle keys (INV-9).
    const carried = updateCalls.find(
      (call) =>
        call[0].publication_status === undefined && 'question_text' in call[0],
    )?.[0];
    expect(carried).toBeDefined();
    expect(carried!.publication_status).toBeUndefined();
    expect(carried!.source_document_id).toBeUndefined();

    // INV-12: the embed UPDATE sets question_embedding AND publication_status.
    const embedPayload = updateCalls.find(
      (call) => call[0].publication_status === 'published',
    )?.[0];
    expect(embedPayload).toBeDefined();
    expect(embedPayload!.question_embedding).toBe(
      JSON.stringify(STUB_EMBEDDING),
    );
    expect(embedPayload!.publication_status).toBe('published');
  });

  // -------------------------------------------------------------------------
  // INV-12: published-with-NULL-embedding is UNREACHABLE.
  // Every UPDATE that sets publication_status='published' must also set
  // question_embedding, and vice versa — never one without the other.
  // -------------------------------------------------------------------------
  it('INV-12: embed UPDATE always sets question_embedding AND publication_status together', async () => {
    const extraction = makeExtraction({ id: UUID_A });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });

    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );

    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR }], error: null }),
    );

    await promoteCorpusExtractions(supabase as unknown as SupabaseClientLike);

    const updateMock = supabase._chain.update;
    for (const call of updateMock.mock.calls as Array<
      [Record<string, unknown>]
    >) {
      const payload = call[0];
      if (payload.publication_status === 'published') {
        expect(payload.question_embedding).toBeDefined();
        expect(payload.question_embedding).not.toBeNull();
      }
      if (
        'question_embedding' in payload &&
        payload.question_embedding !== undefined
      ) {
        expect(payload.publication_status).toBe('published');
      }
    }
  });

  // -------------------------------------------------------------------------
  // INV-23 equation in a mixed batch:
  //   published-this-run == promoted - embed_failed
  //   (A=new+ok, B=new+embed-fail, C=self-heal+ok)
  // -------------------------------------------------------------------------
  it('INV-23: published-this-run == promoted - embed_failed across new + self-heal rows', async () => {
    const extractionA = makeExtraction({
      id: UUID_A,
      extracted_question_text: 'Question A?',
      extracted_answer_text: 'Answer A.',
    });
    const extractionB = makeExtraction({
      id: UUID_B,
      extracted_question_text: 'Question B?',
      extracted_answer_text: 'Answer B.',
    });
    const extractionC = makeExtraction({
      id: '00000000-0000-4000-a000-000000000003',
      extracted_question_text: 'Question C (self-heal)?',
      extracted_answer_text: 'Answer C.',
      promoted_to_pair_id: UUID_EXISTING_PAIR,
    });

    supabase.rpc.mockResolvedValueOnce({
      data: [extractionA, extractionB, extractionC],
      error: null,
    });

    // Row A: INSERT → CAS wins → embed OK
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extractionA.id }], error: null }),
    );
    // Row A: embed UPDATE success
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR }], error: null }),
    );

    // Row B: INSERT → CAS wins → embed FAILS
    const UUID_NEW_PAIR_B = '00000000-0000-4000-a000-000000000096';
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR_B },
      error: null,
    });
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extractionB.id }], error: null }),
    );

    // Row C (self-heal): single #3 reads the pair's stored question_text
    // ({59.31} re-promote). Same value as the re-extraction → no mark-stale.
    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: extractionC.extracted_question_text },
      error: null,
    });
    // Row C: carried-only UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );
    // Row C: embed UPDATE success
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    // generateEmbedding: A ok, B throws, C ok
    mockGenerateEmbedding
      .mockResolvedValueOnce(STUB_EMBEDDING)
      .mockRejectedValueOnce(new Error('embed fail B'))
      .mockResolvedValueOnce(STUB_EMBEDDING);

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // promoted = 3 (A CAS-win + B CAS-win + C self-heal attempt)
    expect(result.promoted).toBe(3);
    // embed_failed = 1 (B)
    expect(result.embed_failed).toBe(1);
    // INV-23: published-this-run = 3 - 1 = 2
    expect(result.promoted - result.embed_failed).toBe(2);
    expect(result.considered).toBe(3);
    expect(result.skipped).toHaveLength(0);
    expect(result.already_promoted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Embed UPDATE returning 0 rows → embed_failed (REST PATCH silent no-op gotcha)
  // -------------------------------------------------------------------------
  it('embed UPDATE returning 0 rows is treated as embed_failed (REST PATCH silent no-op)', async () => {
    const extraction = makeExtraction({ id: UUID_A });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });

    // CAS → success
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );

    // Embed UPDATE → 0 rows (silent no-op — REST PATCH gotcha)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // 0 rows on embed UPDATE is a defect — counted as embed_failed
    expect(result.embed_failed).toBe(1);
    expect(result.promoted).toBe(1);
    // INV-23 still holds: 1 - 1 = 0 published this run
    expect(result.promoted - result.embed_failed).toBe(0);
    // batch does not throw
  });
});

// ---------------------------------------------------------------------------
// Test suite — {59.24} OQ-2 active retirement pass (R1 step 6)
// ---------------------------------------------------------------------------

const UUID_OLD_PAIR = '00000000-0000-4000-a000-000000000010';
const UUID_NEW_PAIR_REPLACEMENT = '00000000-0000-4000-a000-000000000011';
const UUID_SOURCE_ITEM = '00000000-0000-4000-a000-000000000020';
const UUID_INVALIDATED_EXTRACTION = '00000000-0000-4000-a000-000000000030';
const UUID_LIVE_EXTRACTION = '00000000-0000-4000-a000-000000000031';

/**
 * Build a retirement candidate row (invalidated extraction whose promoted pair
 * is still published) in the shape returned by the embed PostgREST query.
 */
function makeRetirementCandidate(
  overrides: {
    id?: string;
    source_content_item_id?: string | null;
    promoted_to_pair_id?: string;
  } = {},
) {
  const pairId = overrides.promoted_to_pair_id ?? UUID_OLD_PAIR;
  return {
    id: overrides.id ?? UUID_INVALIDATED_EXTRACTION,
    source_content_item_id:
      overrides.source_content_item_id !== undefined
        ? overrides.source_content_item_id
        : UUID_SOURCE_ITEM,
    promoted_to_pair_id: pairId,
    // Shape returned by PostgREST embed: q_a_pairs!promoted_to_pair_id
    'q_a_pairs!promoted_to_pair_id': {
      id: pairId,
      publication_status: 'published',
    },
  };
}

describe('promoteCorpusExtractions — {59.24} OQ-2 active retirement pass', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    supabase = createMockSupabaseClient();
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(STUB_EMBEDDING);
  });

  // -------------------------------------------------------------------------
  // Retirement scenario 1: invalidated promoted extraction + live replacement
  // for the same source_content_item_id → old pair archived WITH superseded_by.
  //
  // Mock call order (promote loop produces nothing; retirement pass runs):
  //   RPC → [] (no promote candidates)
  //   then #1 → retirement candidates (one row with embedded published pair)
  //   then #2 → replacement lookup (live extraction with new pair id)
  //   then #3 → archive UPDATE (1 row affected)
  //   then #4 → second-pass candidates (empty → loop exits)
  // -------------------------------------------------------------------------
  it('{59.24} Scenario 1: invalidated+promoted pair has live replacement → archived with superseded_by, retired===1', async () => {
    // Promote loop: no candidates
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    // Retirement pass — iter 1:
    // then #1: candidate query (embed path) → one candidate
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [makeRetirementCandidate()],
          error: null,
        }),
    );

    // then #2: replacement lookup → live extraction with new pair
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ promoted_to_pair_id: UUID_NEW_PAIR_REPLACEMENT }],
          error: null,
        }),
    );

    // then #3: archive UPDATE → 1 row affected (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_OLD_PAIR }], error: null }),
    );

    // Retirement pass — iter 2 (loop-until-dry check):
    // then #4: candidate query → empty (no more published+invalidated pairs)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // Summary: retirement counted correctly
    expect(result.retired).toBe(1);
    expect(result.retired_no_replacement).toBe(0);

    // Promote loop was idle
    expect(result.promoted).toBe(0);
    expect(result.considered).toBe(0);

    // Archive UPDATE must carry BOTH superseded_by AND publication_status='archived'
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const archiveCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'archived',
    );
    expect(archiveCall).toBeDefined();
    expect(archiveCall![0].superseded_by).toBe(UUID_NEW_PAIR_REPLACEMENT);
    expect(archiveCall![0].publication_status).toBe('archived');
  });

  // -------------------------------------------------------------------------
  // Retirement scenario 2: invalidated promoted extraction with NO live
  // replacement → archived WITHOUT superseded_by, retired_no_replacement===1.
  // "correct-but-missing over wrong-but-present" (OQ-2 ratified posture).
  // -------------------------------------------------------------------------
  it('{59.24} Scenario 2: invalidated+promoted pair with no replacement → archived superseded_by=null, retired_no_replacement===1', async () => {
    // Promote loop: no candidates
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    // Retirement pass — iter 1:
    // then #1: candidate query → one candidate
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [makeRetirementCandidate()],
          error: null,
        }),
    );

    // then #2: replacement lookup → empty (no live replacement)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // then #3: archive UPDATE → 1 row affected (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_OLD_PAIR }], error: null }),
    );

    // Retirement pass — iter 2:
    // then #4: candidate query → empty → loop exits
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.retired).toBe(0);
    expect(result.retired_no_replacement).toBe(1);

    // Archive UPDATE must have superseded_by === null
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const archiveCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'archived',
    );
    expect(archiveCall).toBeDefined();
    expect(archiveCall![0].superseded_by).toBeNull();
    expect(archiveCall![0].publication_status).toBe('archived');
  });

  // -------------------------------------------------------------------------
  // Retirement scenario 3: source_content_item_id IS NULL → no replacement
  // lookup possible → archived as retired_no_replacement (OQ-2 spec: sidecar
  // extractions cannot be matched by source).
  // -------------------------------------------------------------------------
  it('{59.24} Scenario 3: source_content_item_id IS NULL → no replacement lookup, retired_no_replacement===1', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    // Candidate with null source_content_item_id
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [makeRetirementCandidate({ source_content_item_id: null })],
          error: null,
        }),
    );

    // NO replacement lookup call expected (source_content_item_id IS NULL skips it)

    // then #2: archive UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_OLD_PAIR }], error: null }),
    );

    // then #3: second-pass candidates → empty
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.retired).toBe(0);
    expect(result.retired_no_replacement).toBe(1);

    // Verify the replacement lookup was NOT called (no eq on source_content_item_id
    // with a non-null value). We check that the update mock was called exactly once
    // (archive only, no promote-loop updates).
    expect(supabase._chain.update).toHaveBeenCalledTimes(1);
    const archivePayload = (
      supabase._chain.update.mock.calls[0] as [Record<string, unknown>]
    )[0];
    expect(archivePayload.superseded_by).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Retirement scenario 4: idempotency.
  // Already-archived pairs (publication_status='archived') are not returned
  // by the retirement candidate query (filter is publication_status='published').
  // → retired===0, retired_no_replacement===0, no UPDATE fired.
  // -------------------------------------------------------------------------
  it('{59.24} Scenario 4 (idempotency): already-archived pair returns no candidates → retired===0, retired_no_replacement===0', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    // Retirement candidate query returns empty (no published+invalidated pairs)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.retired).toBe(0);
    expect(result.retired_no_replacement).toBe(0);

    // No archive UPDATE should have been fired
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const archiveCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'archived',
    );
    expect(archiveCall).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Retirement scenario 4b (CAS concurrent-archive race): the archive UPDATE
  // returns 0 rows because a concurrent run already archived the same pair.
  //
  // This must NOT throw — it must gracefully `continue` (the pair IS retired,
  // just not by this run). Mirrors the {59.22}:320 CAS-0-row pattern.
  //
  // Mock call order:
  //   RPC → [] (no promote candidates)
  //   then #1 → retirement candidates (one candidate with published pair)
  //   then #2 → replacement lookup (live replacement exists)
  //   then #3 → archive UPDATE → 0 rows (concurrent run beat us)
  //   then #4 → second-pass candidates → empty (loop exits)
  // -------------------------------------------------------------------------
  it('{59.24} Scenario 4b (concurrent-archive race): 0-row archive UPDATE → no throw, retired===0, retired_no_replacement===0', async () => {
    // Promote loop: no candidates
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    // Retirement pass — iter 1:
    // then #1: candidate query → one candidate (pair still shows as published)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [makeRetirementCandidate()],
          error: null,
        }),
    );

    // then #2: replacement lookup → live replacement found
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ promoted_to_pair_id: UUID_NEW_PAIR_REPLACEMENT }],
          error: null,
        }),
    );

    // then #3: archive UPDATE → 0 rows, no error (concurrent run already archived)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // then #4: second-pass candidate query → empty (loop exits)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Must NOT throw — concurrent archive is a benign race, not a defect.
    const result = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // The pair was NOT archived by THIS run — no count increment.
    expect(result.retired).toBe(0);
    expect(result.retired_no_replacement).toBe(0);

    // Promote loop was idle
    expect(result.promoted).toBe(0);
    expect(result.considered).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Retirement scenario 5: ordering proof — retirement runs AFTER the promote
  // loop. A same-run promoted extraction creates its replacement pair BEFORE
  // the retirement pass runs, so superseded_by can point at it.
  //
  // Setup: one live unlinked extraction (promote loop processes it) + one
  // invalidated extraction for the same source_content_item_id.
  // The retirement pass should find the just-promoted pair as the replacement.
  // -------------------------------------------------------------------------
  it('{59.24} Scenario 5 (ordering): replacement pair created in promote loop is available for superseded_by in retirement pass', async () => {
    const liveExtraction = makeExtraction({
      id: UUID_LIVE_EXTRACTION,
      extracted_question_text: 'Updated procurement threshold?',
      extracted_answer_text: 'The new threshold is £30,000.',
      source_content_item_id: UUID_SOURCE_ITEM,
    });

    // RPC returns the live extraction as a promote candidate
    supabase.rpc.mockResolvedValueOnce({ data: [liveExtraction], error: null });

    // Promote loop: INSERT → new replacement pair
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR_REPLACEMENT },
      error: null,
    });

    // CAS → 1 row (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: liveExtraction.id }], error: null }),
    );

    // Embed UPDATE → 1 row (success)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR_REPLACEMENT }], error: null }),
    );

    // Retirement pass — iter 1:
    // then #3: candidate query → the invalidated extraction with old published pair
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            makeRetirementCandidate({
              id: UUID_INVALIDATED_EXTRACTION,
              source_content_item_id: UUID_SOURCE_ITEM,
              promoted_to_pair_id: UUID_OLD_PAIR,
            }),
          ],
          error: null,
        }),
    );

    // then #4: replacement lookup → finds the live extraction just promoted above
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ promoted_to_pair_id: UUID_NEW_PAIR_REPLACEMENT }],
          error: null,
        }),
    );

    // then #5: archive UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_OLD_PAIR }], error: null }),
    );

    // then #6: second-pass → empty
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // Promote loop ran first
    expect(result.promoted).toBe(1);
    expect(result.considered).toBe(1);

    // Then retirement ran with the just-created replacement pair available
    expect(result.retired).toBe(1);
    expect(result.retired_no_replacement).toBe(0);

    // Archive payload includes superseded_by = UUID_NEW_PAIR_REPLACEMENT
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const archiveCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'archived',
    );
    expect(archiveCall).toBeDefined();
    expect(archiveCall![0].superseded_by).toBe(UUID_NEW_PAIR_REPLACEMENT);
  });
});

// ---------------------------------------------------------------------------
// Test suite — {59.29} corpus sidecar-emit leg (TECH R1; INV-9/INV-10/INV-11;
//             folds bl-323). emit-THEN-publish ordering.
//
// These are file-backed behaviour tests: the sidecar file is written to a REAL
// temp directory (a stand-in for COCOINDEX_SOURCE_PATH) so the carried-set
// bytes on disk are asserted directly — NOT a mock (mirrors the {59.9}
// write-back.test.ts proofs). The DB legs stay on the shared Supabase mock so
// each failure mode is forced deterministically.
//
// CAS-won emit-then-publish DB-call order (COCOINDEX_SOURCE_PATH set):
//   rpc                              → eligible set
//   single                           → INSERT pair returns new pair id
//   then #1                          → CAS UPDATE (1 row)
//   then #2                          → source_document_id UPDATE (emit DB leg)
//   then #3                          → embed UPDATE (publish)
// ---------------------------------------------------------------------------

describe('promoteCorpusExtractions — {59.29} corpus sidecar-emit leg (emit-then-publish)', () => {
  let supabase: MockSupabaseClient;
  let sourceRoot: string;
  const priorSourcePath = process.env.COCOINDEX_SOURCE_PATH;

  beforeEach(async () => {
    supabase = createMockSupabaseClient();
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(STUB_EMBEDDING);
    sourceRoot = await mkdtemp(join(tmpdir(), 'kh-corpus-sidecar-'));
    process.env.COCOINDEX_SOURCE_PATH = sourceRoot;
  });

  afterEach(async () => {
    if (priorSourcePath === undefined) {
      delete process.env.COCOINDEX_SOURCE_PATH;
    } else {
      process.env.COCOINDEX_SOURCE_PATH = priorSourcePath;
    }
    await rm(sourceRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path: a successful promotion writes the sidecar .md (carried set
  // ONLY — NO lifecycle keys) AND sets source_document_id = sdUuid5(relPath),
  // keyed on the PAIR PK. The pair is then published (embed UPDATE fires).
  // (INV-9 / INV-11; seed = newPairId consistency with {59.30})
  // -------------------------------------------------------------------------
  it('writes the carried-set sidecar (no lifecycle keys) keyed on the pair PK + sets source_document_id, then publishes', async () => {
    const extraction = makeExtraction({
      id: UUID_A,
      extracted_question_text: 'What is the procurement threshold?',
      extracted_answer_text: 'The threshold is £25,000.',
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });
    // INSERT pair → new pair id
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });
    // then #1: CAS UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );
    // then #2: source_document_id UPDATE (emit DB leg) → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR }], error: null }),
    );
    // then #3: embed UPDATE (publish) → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.promoted).toBe(1);
    expect(result.sidecar_failed).toBe(0);
    expect(result.embed_failed).toBe(0);
    expect(result.failures).toHaveLength(0);

    // The sidecar is keyed on the PAIR PK (newPairId), NOT the extraction id.
    const relPath = qaSidecarRelPath(UUID_NEW_PAIR);
    expect(relPath).not.toContain(UUID_A); // not keyed on the extraction id
    const onDisk = await readFile(join(sourceRoot, relPath), 'utf8');

    // Carried set round-trips: question + standard answer present.
    const carried = parseCarriedSet(onDisk);
    expect(carried.question_text).toBe('What is the procurement threshold?');
    expect(carried.answer_standard).toBe('The threshold is £25,000.');

    // INV-9 / INV-11: NO lifecycle keys anywhere in the written file.
    for (const forbidden of [
      'edit_intent',
      'valid_from',
      'valid_to',
      'source_document_id',
      'publication_status',
      'created_at',
      'updated_at',
      'question_embedding',
    ]) {
      expect(onDisk).not.toContain(forbidden);
    }

    // source_document_id UPDATE carries sdUuid5(relPath) for the pair PK.
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const linkCall = updateCalls.find(
      (call) => 'source_document_id' in call[0],
    );
    expect(linkCall).toBeDefined();
    expect(linkCall![0].source_document_id).toBe(sdUuid5(relPath));

    // Publish happened (emit succeeded first): embed UPDATE fired.
    const embedCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'published',
    );
    expect(embedCall).toBeDefined();
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Sidecar failure (file leg) ABORTS publish: the pair stays draft (NOT
  // published-without-a-file), sidecar_failed increments, the failure record
  // carries extractionId + newPairId (bl-323), and embed is never attempted.
  // Forced via the source_document_id UPDATE returning 0 rows (silent no-op
  // → affected-row assertion → restore → 'failed').
  // -------------------------------------------------------------------------
  it('sidecar failure aborts publish (pair stays draft), increments sidecar_failed, records extractionId+newPairId (bl-323), no embed', async () => {
    const extraction = makeExtraction({ id: UUID_A });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });
    // then #1: CAS UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );
    // then #2: source_document_id UPDATE → 0 rows (silent no-op → emit fails)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // promoted++ happened (INV-23 attempt), but the publish was aborted.
    expect(result.promoted).toBe(1);
    expect(result.sidecar_failed).toBe(1);
    expect(result.embed_failed).toBe(0);

    // bl-323 unified failure record.
    expect(result.failures).toContainEqual({
      extractionId: UUID_A,
      newPairId: UUID_NEW_PAIR,
      reason: 'sidecar_failed',
    });

    // The pair was NOT published — embed was never attempted (emit-then-publish).
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const embedCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'published',
    );
    expect(embedCall).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Self-heal after a sidecar failure: a subsequent run re-selects the
  // linked-but-unembedded pair (RPC returns it with promoted_to_pair_id set)
  // and succeeds — the embed UPDATE publishes it. Proves the draft pair is
  // retryable, not stuck (INV-11 self-healing).
  // -------------------------------------------------------------------------
  it('self-heals next run: a linked-but-unembedded pair re-selected by the RPC publishes via the embed path', async () => {
    // Run 2 input: the pair from a prior sidecar-failed run is now linked.
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });
    // Self-heal path: NO INSERT, NO CAS, NO file emit (the sidecar already
    // exists on disk). {59.31}: a carried re-sync UPDATE precedes the embed.
    // single #1: read the pair's stored question_text (unchanged → no mark-stale)
    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: extraction.extracted_question_text },
      error: null,
    });
    // then #1: carried-only UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );
    // then #2: embed UPDATE → 1 row (publish)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.promoted).toBe(1);
    expect(result.embed_failed).toBe(0);
    expect(result.sidecar_failed).toBe(0);
    expect(result.failures).toHaveLength(0);

    // No new pair INSERT (the pair already exists from the prior run).
    expect(supabase._chain.insert).not.toHaveBeenCalled();
    // Published this run.
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const embedCall = updateCalls.find(
      (call) => call[0]?.publication_status === 'published',
    );
    expect(embedCall).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // File-write failure (not just the DB leg): COCOINDEX_SOURCE_PATH points at
  // a regular FILE, so mkdir/writeFile under it throws ENOTDIR. The emit fails
  // → publish aborted → sidecar_failed, no embed. Proves the real file-write
  // failure path (not only the affected-row assertion).
  // -------------------------------------------------------------------------
  it('real file-write failure (source path is a file, not a dir) → sidecar_failed, publish aborted', async () => {
    // Point COCOINDEX_SOURCE_PATH at a regular file inside the temp dir.
    const filePath = join(sourceRoot, 'not-a-dir');
    await writeFile(filePath, 'x', 'utf8');
    process.env.COCOINDEX_SOURCE_PATH = filePath;

    const extraction = makeExtraction({ id: UUID_A });
    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });
    // then #1: CAS UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.sidecar_failed).toBe(1);
    expect(result.failures).toContainEqual({
      extractionId: UUID_A,
      newPairId: UUID_NEW_PAIR,
      reason: 'sidecar_failed',
    });
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Idle mode: COCOINDEX_SOURCE_PATH unset → publish proceeds DB-only, no
  // sidecar file, NOT counted sidecar_failed (idle ≠ failure). The bound
  // re-walk self-heals later. (write-back.ts idle precedent; TECH R2.4)
  // -------------------------------------------------------------------------
  it('idle mode (COCOINDEX_SOURCE_PATH unset): publishes DB-only, no sidecar file, NOT sidecar_failed', async () => {
    delete process.env.COCOINDEX_SOURCE_PATH;

    const extraction = makeExtraction({ id: UUID_A });
    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });
    // then #1: CAS UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );
    // then #2: embed UPDATE (publish) → 1 row — NO source_document_id UPDATE
    // is fired in idle mode (the emit DB leg is skipped).
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.promoted).toBe(1);
    expect(result.sidecar_failed).toBe(0);
    expect(result.failures).toHaveLength(0);

    // Published DB-only.
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(
      updateCalls.find((call) => call[0]?.publication_status === 'published'),
    ).toBeDefined();
    // No source_document_id linkage UPDATE in idle mode.
    expect(
      updateCalls.find((call) => 'source_document_id' in call[0]),
    ).toBeUndefined();

    // No sidecar file was written under the (now-restored) temp root.
    await expect(
      access(join(sourceRoot, qaSidecarRelPath(UUID_NEW_PAIR))),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test suite — {59.31} re-walk not-round-tripped enforcement (S233 gate)
//             + mark-stale on question_text change.
//
// Spec: TECH-qa-sidecar-canonical.md R3 (maps INV-1/2/3/9/10); the S233
//       SIDECAR-REOPENED gate re-ratified.
//
// SHAPE: these exercise the re-promotion (self-heal) path — an extraction the
// eligibility RPC returns with promoted_to_pair_id ALREADY set (pair exists,
// embedding NULL). The re-walk ({59.26}) has UPSERTed the same-PK extraction
// row with the re-extracted carried text; this slice re-syncs ONLY the carried
// fields onto the linked pair and NEVER touches the not-carried (lifecycle)
// set (INV-9). On a question_text change the embedding is NULL'd in the SAME
// carried UPDATE (the explicit INV-10 mark-stale exception).
//
// DB-call order on the re-promotion path (COCOINDEX_SOURCE_PATH irrelevant —
// no file leg on re-promote; the sidecar already exists on disk):
//   rpc                              → eligible set (one linked-unembedded row)
//   single #1                        → read the pair's stored question_text
//   then  #1                         → carried-only UPDATE (1 row)
//   then  #2                         → embed UPDATE (publish)
//
// The carried set re-synced from the extraction is exactly the fields the
// extraction carries: question_text, answer_standard, alternate_question_
// phrasings. The NOT-CARRIED set is asserted ABSENT from every re-promote
// payload (the S233 gate).
// ---------------------------------------------------------------------------

describe('promoteCorpusExtractions — {59.31} re-walk carried-only re-promote + mark-stale', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    supabase = createMockSupabaseClient();
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(STUB_EMBEDDING);
  });

  /** The not-carried (lifecycle) set that MUST NEVER appear in a re-promote
   *  carried UPDATE payload (INV-9 / the S233 gate). question_embedding is the
   *  ONLY not-carried key permitted, and ONLY as the mark-stale NULL rider. */
  const NOT_CARRIED_KEYS = [
    'publication_status',
    'superseded_by',
    'source_workspace_id',
    'edit_intent',
    'valid_from',
    'valid_to',
    'created_at',
    'updated_at',
    'source_document_id',
  ] as const;

  /** Find the carried-only UPDATE payload — the re-promote UPDATE is the one
   *  that carries answer_standard or question_text but is NOT the embed/publish
   *  UPDATE (which carries publication_status='published'). */
  function findCarriedUpdate(
    client: MockSupabaseClient,
  ): Record<string, unknown> | undefined {
    const updateCalls = client._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    return updateCalls
      .map((call) => call[0])
      .find(
        (payload) =>
          payload.publication_status === undefined &&
          ('answer_standard' in payload || 'question_text' in payload),
      );
  }

  // -------------------------------------------------------------------------
  // S233 gate: a changed answer_standard re-syncs ONLY the carried field; the
  // not-carried lifecycle set is byte-untouched (never in the payload), and
  // because question_text is UNCHANGED the embedding is NOT NULL'd (no
  // mark-stale rider). The pair then re-embeds + publishes.
  // -------------------------------------------------------------------------
  it('S233: changed answer_standard → carried-only UPDATE, NO not-carried keys, NO mark-stale (question unchanged)', async () => {
    const STORED_QUESTION = 'What is the procurement threshold?';
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
      extracted_question_text: STORED_QUESTION, // unchanged from the stored pair
      extracted_answer_text: 'The threshold is now £30,000.', // CHANGED
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // single #1: read the pair's stored question_text (unchanged → no mark-stale)
    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: STORED_QUESTION },
      error: null,
    });
    // then #1: carried-only UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );
    // then #2: embed UPDATE (publish) → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.promoted).toBe(1);
    expect(result.embed_failed).toBe(0);

    const carried = findCarriedUpdate(supabase);
    expect(carried).toBeDefined();
    // The carried field changed → present in the payload.
    expect(carried!.answer_standard).toBe('The threshold is now £30,000.');
    // INV-9 / S233: NONE of the not-carried lifecycle keys are in the payload.
    for (const key of NOT_CARRIED_KEYS) {
      expect(carried!).not.toHaveProperty(key);
    }
    // question_text UNCHANGED → no mark-stale rider (embedding key absent).
    expect(carried!).not.toHaveProperty('question_embedding');
  });

  // -------------------------------------------------------------------------
  // INV-10 mark-stale: a changed question_text NULLs the embedding in the SAME
  // carried UPDATE (the only permitted not-carried touch). The pair then
  // re-embeds via the existing self-heal embed path → no published+stale-vector
  // window (the wrong-vector hazard the RPC's NULL-embedding exclusion closes).
  // -------------------------------------------------------------------------
  it('INV-10: changed question_text → mark-stale NULLs question_embedding in the SAME carried UPDATE', async () => {
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
      extracted_question_text: 'What is the NEW procurement threshold?', // CHANGED
      extracted_answer_text: 'The threshold is £25,000.',
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // single #1: stored question_text DIFFERS → mark-stale fires
    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: 'What is the procurement threshold?' },
      error: null,
    });
    // then #1: carried-only UPDATE (with the embedding-NULL rider) → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );
    // then #2: embed UPDATE (re-embed + publish) → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    expect(result.promoted).toBe(1);

    const carried = findCarriedUpdate(supabase);
    expect(carried).toBeDefined();
    expect(carried!.question_text).toBe(
      'What is the NEW procurement threshold?',
    );
    // INV-10: embedding NULL'd in the SAME UPDATE.
    expect(carried!).toHaveProperty('question_embedding', null);
    // The embedding-NULL rider is the ONLY not-carried touch — all other
    // lifecycle keys are still absent (INV-9).
    for (const key of NOT_CARRIED_KEYS) {
      expect(carried!).not.toHaveProperty(key);
    }
  });

  // -------------------------------------------------------------------------
  // Carried UPDATE 0-row result (REST PATCH silent no-op): the re-sync did not
  // land (the pair vanished / a concurrent change beat us). The re-promotion is
  // a soft failure — embed_failed++, a failure record is logged, embedding is
  // NOT attempted, and the batch does NOT throw (self-heals next run). This is
  // the "assert affected-row = 1" guard routed into the existing soft-fail
  // accounting (no new public failure-reason enum value).
  // -------------------------------------------------------------------------
  it('carried UPDATE 0-row (silent no-op) → embed_failed, no embed attempted, no throw', async () => {
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
      extracted_question_text: 'What is the procurement threshold?',
      extracted_answer_text: 'The threshold is £25,000.',
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // single #1: read stored question_text
    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: 'What is the procurement threshold?' },
      error: null,
    });
    // then #1: carried UPDATE → 0 rows (silent no-op)
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // Soft failure: counted, logged, but the batch did NOT throw.
    expect(result.promoted).toBe(1);
    expect(result.embed_failed).toBe(1);
    expect(result.failures).toContainEqual({
      extractionId: UUID_A,
      newPairId: UUID_EXISTING_PAIR,
      reason: 'embed_failed',
    });
    // Embedding was NOT attempted — the carried re-sync gates the embed.
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // INV-3 no-duplicate: the re-promotion path NEVER inserts a new pair — it
  // re-syncs the EXISTING linked pair. No INSERT, no CAS UPDATE on
  // q_a_extractions. (The promoted_to_pair_id anchor keys the pair; the
  // re-walk reconstructs the SAME projection rather than minting a duplicate.)
  // -------------------------------------------------------------------------
  it('INV-3: re-promotion re-syncs the existing pair — NO insert, NO CAS, no duplicate', async () => {
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
      extracted_question_text: 'What is the procurement threshold?',
      extracted_answer_text: 'The threshold is £25,000.',
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: 'What is the procurement threshold?' },
      error: null,
    });
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    await promoteCorpusExtractions(supabase as unknown as SupabaseClientLike);

    // No new pair INSERT on the re-promotion path.
    expect(supabase._chain.insert).not.toHaveBeenCalled();

    // No CAS UPDATE on q_a_extractions (no promoted_to_pair_id write).
    const updateCalls = supabase._chain.update.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(
      updateCalls.find((call) => 'promoted_to_pair_id' in call[0]),
    ).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Mixed batch: a fresh unlinked extraction (INSERT + CAS + emit + publish)
  // and a re-promoted linked extraction (carried re-sync + publish) in ONE
  // run. Proves the re-promote path slots beside the existing fresh-promote
  // path without disturbing it — both count as promoted; the re-sync carried
  // UPDATE never carries lifecycle keys.
  // -------------------------------------------------------------------------
  it('mixed batch: fresh unlinked + re-promoted linked both publish; carried UPDATE stays lifecycle-free', async () => {
    const fresh = makeExtraction({
      id: UUID_A,
      extracted_question_text: 'Fresh question?',
      extracted_answer_text: 'Fresh answer.',
    });
    const relinked = makeExtraction({
      id: UUID_B,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
      extracted_question_text: 'Relinked question?',
      extracted_answer_text: 'Relinked answer (changed).',
    });

    supabase.rpc.mockResolvedValueOnce({
      data: [fresh, relinked],
      error: null,
    });

    // Fresh row: INSERT → new pair
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });
    // Fresh: then #1 CAS → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: fresh.id }], error: null }),
    );
    // Fresh: then #2 embed UPDATE (publish, idle mode — no sidecar leg) → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_NEW_PAIR }], error: null }),
    );

    // Relinked row: single #1 read stored question_text (changed → mark-stale)
    supabase._chain.single.mockResolvedValueOnce({
      data: { question_text: 'Original relinked question?' },
      error: null,
    });
    // Relinked: then #3 carried UPDATE → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );
    // Relinked: then #4 embed UPDATE (publish) → 1 row
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(
      supabase as unknown as SupabaseClientLike,
    );

    // Both promoted (fresh CAS-win + relinked re-sync).
    expect(result.promoted).toBe(2);
    expect(result.embed_failed).toBe(0);
    expect(result.already_promoted).toBe(0);

    // The re-sync carried UPDATE (relinked) carries question_text + the
    // mark-stale rider, but no other lifecycle key.
    const carried = findCarriedUpdate(supabase);
    expect(carried).toBeDefined();
    expect(carried!.question_text).toBe('Relinked question?');
    expect(carried!).toHaveProperty('question_embedding', null);
    for (const key of NOT_CARRIED_KEYS) {
      expect(carried!).not.toHaveProperty(key);
    }
  });
});
