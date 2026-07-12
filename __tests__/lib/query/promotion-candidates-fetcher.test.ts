/**
 * fetchQaPromotionCandidates / postQaPromoteCorpus tests (ID-145.22 —
 * TECH §5/§7 I, BI-38/39).
 *
 * Acceptance (testStrategy): promotion candidates are reviewable, driven by
 * the existing `q_a_extractions_promotion_candidates()` RPC ({138.17}); the
 * fetcher classifies each row's `kind` by mirroring
 * `promoteCorpusExtractions`' own DR-026 gate (lib/q-a-pairs/promote-corpus.ts)
 * — a linked row is 'self_healing' ONLY when its pair is confirmed still
 * 'draft'; every other outcome (published/in_review/archived, or an
 * unreadable/missing pair row) is 'awaiting_review' — the UI must never claim
 * an auto-apply disposition the batch write path would not actually take.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockSupabaseTableDispatch } from '@/__tests__/helpers/mock-supabase';

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

import {
  fetchQaPromotionCandidates,
  postQaPromoteCorpus,
} from '@/lib/query/fetchers';

const NEW_ID = '11111111-1111-4111-8111-111111111111';
const SELF_HEAL_ID = '22222222-2222-4222-8222-222222222222';
const AWAITING_REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const UNKNOWN_PAIR_ID = '44444444-4444-4444-8444-444444444444';
const DRAFT_PAIR_ID = '55555555-5555-4555-8555-555555555555';
const PUBLISHED_PAIR_ID = '66666666-6666-4666-8666-666666666666';
const MISSING_PAIR_ID = '77777777-7777-4777-8777-777777777777';

function makeExtractionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NEW_ID,
    extracted_question_text: 'What is your H&S policy?',
    extracted_answer_text: 'We maintain a documented H&S policy.',
    promoted_to_pair_id: null,
    created_at: '2026-07-01T08:00:00Z',
    ...overrides,
  };
}

function setClient(client: ReturnType<typeof createMockSupabaseTableDispatch>) {
  mockCreateClient.mockReturnValue(client);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchQaPromotionCandidates', () => {
  it('returns an empty array when the RPC returns no candidates', async () => {
    setClient(createMockSupabaseTableDispatch({}, { data: [], error: null }));
    const result = await fetchQaPromotionCandidates();
    expect(result).toEqual([]);
  });

  it("classifies an unlinked row as 'new'", async () => {
    setClient(
      createMockSupabaseTableDispatch(
        {},
        {
          data: [makeExtractionRow({ promoted_to_pair_id: null })],
          error: null,
        },
      ),
    );
    const result = await fetchQaPromotionCandidates();
    expect(result).toEqual([
      expect.objectContaining({
        id: NEW_ID,
        kind: 'new',
        promotedToPairId: null,
      }),
    ]);
  });

  it("classifies a row linked to a still-draft pair as 'self_healing'", async () => {
    setClient(
      createMockSupabaseTableDispatch(
        {
          q_a_pairs: {
            data: [{ id: DRAFT_PAIR_ID, publication_status: 'draft' }],
            error: null,
          },
        },
        {
          data: [
            makeExtractionRow({
              id: SELF_HEAL_ID,
              promoted_to_pair_id: DRAFT_PAIR_ID,
            }),
          ],
          error: null,
        },
      ),
    );
    const result = await fetchQaPromotionCandidates();
    expect(result).toEqual([
      expect.objectContaining({
        id: SELF_HEAL_ID,
        kind: 'self_healing',
        promotedToPairId: DRAFT_PAIR_ID,
      }),
    ]);
  });

  it.each(['published', 'in_review', 'archived'])(
    "classifies a row linked to a %s pair as 'awaiting_review' (DR-026 — never auto-mutated)",
    async (status) => {
      setClient(
        createMockSupabaseTableDispatch(
          {
            q_a_pairs: {
              data: [{ id: PUBLISHED_PAIR_ID, publication_status: status }],
              error: null,
            },
          },
          {
            data: [
              makeExtractionRow({
                id: AWAITING_REVIEW_ID,
                promoted_to_pair_id: PUBLISHED_PAIR_ID,
              }),
            ],
            error: null,
          },
        ),
      );
      const result = await fetchQaPromotionCandidates();
      expect(result).toEqual([
        expect.objectContaining({
          id: AWAITING_REVIEW_ID,
          kind: 'awaiting_review',
          promotedToPairId: PUBLISHED_PAIR_ID,
        }),
      ]);
    },
  );

  it("fail-safes an unconfirmed/missing linked-pair row to 'awaiting_review' (never claim an auto-apply that cannot be confirmed)", async () => {
    setClient(
      createMockSupabaseTableDispatch(
        { q_a_pairs: { data: [], error: null } },
        {
          data: [
            makeExtractionRow({
              id: UNKNOWN_PAIR_ID,
              promoted_to_pair_id: MISSING_PAIR_ID,
            }),
          ],
          error: null,
        },
      ),
    );
    const result = await fetchQaPromotionCandidates();
    expect(result).toEqual([
      expect.objectContaining({ id: UNKNOWN_PAIR_ID, kind: 'awaiting_review' }),
    ]);
  });

  it('throws when the RPC errors', async () => {
    setClient(
      createMockSupabaseTableDispatch(
        {},
        { data: null, error: new Error('rpc boom') },
      ),
    );
    await expect(fetchQaPromotionCandidates()).rejects.toThrow();
  });

  it('throws when the linked-pairs follow-up read errors', async () => {
    setClient(
      createMockSupabaseTableDispatch(
        { q_a_pairs: { data: null, error: new Error('pairs boom') } },
        {
          data: [
            makeExtractionRow({
              id: SELF_HEAL_ID,
              promoted_to_pair_id: DRAFT_PAIR_ID,
            }),
          ],
          error: null,
        },
      ),
    );
    await expect(fetchQaPromotionCandidates()).rejects.toThrow();
  });
});

describe('postQaPromoteCorpus', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to /api/q-a-pairs/promote-corpus with no body params (the whole eligible set, {59.25})', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        considered: 2,
        promoted: 1,
        skipped: [],
        already_promoted: 0,
        embed_failed: 0,
        retired: 0,
        retired_no_replacement: 0,
        sidecar_failed: 0,
        failures: [],
        proposed: 1,
        proposals: [
          { extractionId: AWAITING_REVIEW_ID, pairId: PUBLISHED_PAIR_ID },
        ],
      }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await postQaPromoteCorpus();

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/q-a-pairs/promote-corpus',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.promoted).toBe(1);
    expect(result.proposals).toEqual([
      { extractionId: AWAITING_REVIEW_ID, pairId: PUBLISHED_PAIR_ID },
    ]);
  });
});
