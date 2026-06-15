/**
 * Unit tests for promoteCorpusExtractions — ID-59 {59.22}
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 5 (this subtask stops at draft; embedding is {59.23})
 * Product invariants tested: INV-1, INV-4, INV-5, INV-6, INV-7, INV-8
 *
 * Tests verify OBSERVABLE BEHAVIOUR via the returned PromotionSummary and
 * the mock Supabase calls made — NOT implementation internals.
 *
 * Mock discipline: createMockSupabaseClient() from the shared helper — never
 * hand-roll Supabase mocks (per __tests__/CLAUDE.md + test-philosophy).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// SUT import (will fail until lib/q-a-pairs/promote-corpus.ts is created)
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
// Test suite
// ---------------------------------------------------------------------------

describe('promoteCorpusExtractions — {59.22} core loop', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    supabase = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Scenario 1: empty eligible set — nothing to do
  // -------------------------------------------------------------------------
  it('returns all-zero summary when RPC returns empty set', async () => {
    // RPC returns empty list
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

    expect(result.considered).toBe(0);
    expect(result.promoted).toBe(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.already_promoted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: live unlinked extraction → pair inserted with correct field map,
  //             CAS succeeds (1 row affected), promoted === 1
  // -------------------------------------------------------------------------
  it('promotes a live unlinked extraction: correct field map, origin_kind, NULL form FKs', async () => {
    const extraction = makeExtraction({ id: UUID_A });

    // RPC returns one eligible extraction (live, unlinked)
    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // INSERT q_a_pairs → returns the new pair id
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });

    // CAS UPDATE on q_a_extractions → 1 row affected (success)
    // The chain awaits directly (then), so configure `then`
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: extraction.id }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

    expect(result.considered).toBe(1);
    expect(result.promoted).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.already_promoted).toBe(0);

    // Verify INSERT was called on q_a_pairs
    expect(supabase.from).toHaveBeenCalledWith('q_a_pairs');

    // Verify the INSERT payload via the insert mock
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
    // alternate_question_phrasings defaults to '{}' (no dedicated column on extractions)
    expect(insertPayload.alternate_question_phrasings).toEqual('{}');
    // publication_status must be 'draft' (not yet published — embedding is {59.23})
    expect(insertPayload.publication_status).toBe('draft');
    // question_embedding must NOT be set in this subtask ({59.23} adds it)
    expect(insertPayload.question_embedding).toBeUndefined();
    // Form FKs must be absent (route-i pairs have no form response lineage)
    expect(insertPayload.source_form_response_id).toBeUndefined();
    expect(insertPayload.source_question_id).toBeUndefined();
    // source_workspace_id must be omitted (nullable — mirrors route-iii omission)
    expect(insertPayload.source_workspace_id).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 3: NULL extracted_answer_text → skip with reason no_answer_text,
  //             no INSERT, no throw (INV-7)
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
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual({
      extractionId: UUID_A,
      reason: 'no_answer_text',
    });

    // No INSERT on q_a_pairs
    expect(supabase._chain.insert).not.toHaveBeenCalled();
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
  });

  // -------------------------------------------------------------------------
  // Scenario 5: CAS returns 0 rows (concurrent race) →
  //   orphan pair DELETE fires, already_promoted === 1, no duplicate pair
  // (INV-5, INV-8, SILENT-DEFAULT #3)
  // -------------------------------------------------------------------------
  it('on CAS 0-row result (race): deletes orphan pair, counts already_promoted', async () => {
    const extraction = makeExtraction({ id: UUID_A });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    // INSERT succeeds → returns new pair id
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

    // Verify DELETE was called on q_a_pairs (the orphan cleanup)
    expect(supabase._chain.delete).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scenario 6: linked-but-unembedded extraction (promoted_to_pair_id IS SET)
  //   → pass-through, no INSERT, no CAS; {59.23} will embed it
  // (R1 step 3d)
  // -------------------------------------------------------------------------
  it('linked-but-unembedded extraction is passed through without INSERT or CAS', async () => {
    const extraction = makeExtraction({
      id: UUID_A,
      promoted_to_pair_id: UUID_NEW_PAIR, // already linked
    });

    supabase.rpc.mockResolvedValueOnce({ data: [extraction], error: null });

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

    expect(result.considered).toBe(1);
    expect(result.promoted).toBe(0);
    expect(result.already_promoted).toBe(0);
    expect(result.skipped).toHaveLength(0);
    // pass_through is the bucket for linked-but-unembedded rows
    expect(result.pass_through).toBe(1);

    // No INSERT on q_a_pairs
    expect(supabase._chain.insert).not.toHaveBeenCalled();
    // No UPDATE (CAS) on q_a_extractions
    expect(supabase._chain.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scenario 7: RPC call fails → error propagates (not silently swallowed)
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

  // -------------------------------------------------------------------------
  // Scenario 8: mixed batch — one promoted, one skipped, one pass-through
  // -------------------------------------------------------------------------
  it('handles a mixed batch: one promoted, one skipped, one pass-through', async () => {
    const live = makeExtraction({ id: UUID_A });
    const nullAnswer = makeExtraction({
      id: UUID_B,
      extracted_answer_text: null,
    });
    const linkedUnembedded = makeExtraction({
      id: '00000000-0000-4000-a000-000000000003',
      promoted_to_pair_id: UUID_NEW_PAIR,
    });

    supabase.rpc.mockResolvedValueOnce({
      data: [live, nullAnswer, linkedUnembedded],
      error: null,
    });

    // For the live extraction: INSERT succeeds
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: UUID_NEW_PAIR },
      error: null,
    });

    // CAS UPDATE → 1 row affected
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: live.id }], error: null }),
    );

    const result: PromotionSummary = await promoteCorpusExtractions(supabase);

    expect(result.considered).toBe(3);
    expect(result.promoted).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].extractionId).toBe(UUID_B);
    expect(result.pass_through).toBe(1);
    expect(result.already_promoted).toBe(0);
  });
});
