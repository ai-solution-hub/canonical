/**
 * Unit tests for promoteCorpusExtractions — ID-59 {59.22} + {59.23}
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 4, 5
 * Product invariants tested: INV-1, INV-3, INV-4, INV-5, INV-6, INV-7, INV-8,
 *                            INV-10, INV-11, INV-12 + INV-23 equation
 *
 * Tests verify OBSERVABLE BEHAVIOUR via the returned PromotionSummary and
 * the mock Supabase calls made — NOT implementation internals.
 *
 * Mock discipline: createMockSupabaseClient() from the shared helper — never
 * hand-roll Supabase mocks (per __tests__/CLAUDE.md + test-philosophy).
 *
 * generateEmbedding is stubbed via vi.hoisted() per __tests__/CLAUDE.md hoisting
 * rules — module-level mock variables must be initialised with vi.hoisted().
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

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

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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

    await expect(promoteCorpusExtractions(supabase)).rejects.toThrow();
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

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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
  it('OQ-3 self-heal: linked-but-unembedded row embeds existing pair, no insert, no CAS', async () => {
    // Extraction already linked in a prior run but embedding failed
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_EXISTING_PAIR,
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // Embed UPDATE on the EXISTING pair → 1 row affected
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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

    // The only UPDATE is the embed UPDATE (not a CAS update on q_a_extractions)
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      extraction.extracted_question_text,
    );

    const updateMock = supabase._chain.update;
    expect(updateMock).toHaveBeenCalledTimes(1);
    const updatePayload = updateMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // INV-12: both question_embedding AND publication_status set together
    expect(updatePayload.question_embedding).toBe(
      JSON.stringify(STUB_EMBEDDING),
    );
    expect(updatePayload.publication_status).toBe('published');
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

    await promoteCorpusExtractions(supabase);

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

    // Row C (self-heal): embed UPDATE success
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: UUID_EXISTING_PAIR }], error: null }),
    );

    // generateEmbedding: A ok, B throws, C ok
    mockGenerateEmbedding
      .mockResolvedValueOnce(STUB_EMBEDDING)
      .mockRejectedValueOnce(new Error('embed fail B'))
      .mockResolvedValueOnce(STUB_EMBEDDING);

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

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

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

    // 0 rows on embed UPDATE is a defect — counted as embed_failed
    expect(result.embed_failed).toBe(1);
    expect(result.promoted).toBe(1);
    // INV-23 still holds: 1 - 1 = 0 published this run
    expect(result.promoted - result.embed_failed).toBe(0);
    // batch does not throw
  });
});
