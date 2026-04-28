/**
 * Lib-level test for `getItemProvenance()` review-schedule projection.
 *
 * P0 Document Control §5.5 Phase 3 T4 — confirms the SELECT widens to include
 * `next_review_date`, `review_cadence_days`, and `verified_at`, and that those
 * surface in `ItemProvenanceResponse.reviewSchedule`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../helpers/mock-supabase';

const mockSupabase = createMockSupabaseClient();

// Mock display-name resolver — drafted_by users not relevant to this test.
vi.mock('@/lib/users/display-names', () => ({
  resolveUserDisplayNames: vi.fn(async () => new Map()),
}));

import { getItemProvenance } from '@/lib/provenance/item-provenance';

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('getItemProvenance — Review Schedule projection (T4)', () => {
  beforeEach(() => {
    mockSupabase._chain.maybeSingle.mockReset();
    mockSupabase._chain.then.mockReset();
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    // Re-establish chainable returns
    const chain = mockSupabase._chain;
    const chainable = [
      'select',
      'insert',
      'update',
      'upsert',
      'delete',
      'eq',
      'neq',
      'in',
      'is',
      'not',
      'ilike',
      'contains',
      'gte',
      'lte',
      'gt',
      'lt',
      'or',
      'order',
      'limit',
      'range',
    ] as const;
    for (const m of chainable) {
      chain[m].mockReturnValue(chain);
    }

    mockSupabase.from.mockReturnValue(chain);
  });

  it('surfaces next_review_date, review_cadence_days, and verified_at on reviewSchedule', async () => {
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        classification_confidence: 0.86,
        primary_domain: 'health-safety',
        primary_subtopic: 'cdm-regulations',
        secondary_domain: null,
        secondary_subtopic: null,
        classification_reasoning: null,
        classified_at: '2026-04-10T12:00:00Z',
        classification_model: 'claude-opus-4-6',
        classification_tokens_in: 1420,
        classification_tokens_out: 312,
        classification_cache_creation_tokens: 0,
        classification_cache_read_tokens: 0,
        embedding_model: 'text-embedding-3-large',
        embedding_tokens: 890,
        next_review_date: '2026-10-23',
        review_cadence_days: 182,
        verified_at: '2026-04-23T09:00:00Z',
      },
      error: null,
    });

    // bid_responses + count + workspaces all empty (default mock)
    const result = await getItemProvenance(
      // The full SupabaseClient typing is unnecessary for this test surface
      mockSupabase as unknown as Parameters<typeof getItemProvenance>[0],
      VALID_UUID,
    );

    expect(result).not.toBeNull();
    expect(result?.reviewSchedule).toEqual({
      nextReviewDate: '2026-10-23',
      reviewCadenceDays: 182,
      lastReviewedAt: '2026-04-23T09:00:00Z',
    });
  });

  it('returns null reviewSchedule fields when all three columns are null', async () => {
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        classification_confidence: null,
        primary_domain: null,
        primary_subtopic: null,
        secondary_domain: null,
        secondary_subtopic: null,
        classification_reasoning: null,
        classified_at: null,
        classification_model: null,
        classification_tokens_in: null,
        classification_tokens_out: null,
        classification_cache_creation_tokens: null,
        classification_cache_read_tokens: null,
        embedding_model: null,
        embedding_tokens: null,
        next_review_date: null,
        review_cadence_days: null,
        verified_at: null,
      },
      error: null,
    });

    const result = await getItemProvenance(
      mockSupabase as unknown as Parameters<typeof getItemProvenance>[0],
      VALID_UUID,
    );

    expect(result?.reviewSchedule).toEqual({
      nextReviewDate: null,
      reviewCadenceDays: null,
      lastReviewedAt: null,
    });
  });
});
