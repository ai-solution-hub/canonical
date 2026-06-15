/**
 * Unit tests for promoteCorpusExtractions — ID-59 {59.22} + {59.23} + {59.24}
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 4, 5, 6, 7
 * Product invariants tested: INV-1, INV-3, INV-4, INV-5, INV-6, INV-7, INV-8,
 *                            INV-9, INV-10, INV-11, INV-12 + INV-23 equation
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

    const result = await promoteCorpusExtractions(supabase);

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

    const result = await promoteCorpusExtractions(supabase);

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

    const result = await promoteCorpusExtractions(supabase);

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

    const result = await promoteCorpusExtractions(supabase);

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
    const result = await promoteCorpusExtractions(supabase);

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

    const result = await promoteCorpusExtractions(supabase);

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
