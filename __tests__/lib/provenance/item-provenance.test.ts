/**
 * Lib-level test for `getItemProvenance()` review-schedule projection.
 *
 * P0 Document Control §5.5 Phase 3 T4 — confirms `next_review_date`,
 * `review_cadence_days`, and `verified_at` surface in
 * `ItemProvenanceResponse.reviewSchedule`.
 *
 * ID-131 {131.17} G-IMS-DELETE KEEP-list: `getItemProvenance` re-pointed off
 * content_items onto source_documents (M3 gave SD the classification
 * family). The review-schedule fields moved to the `record_lifecycle`
 * governance facet (G-GOV-FACET) — the function now issues a SECOND
 * `maybeSingle()`-terminated read for those columns, so each test queues TWO
 * `mockResolvedValueOnce` results in call order: (1) source_documents
 * classification row, (2) record_lifecycle governance row.
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
    // (1) source_documents classification row.
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
      },
      error: null,
    });
    // (2) record_lifecycle governance row (owner_kind='source_document').
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        next_review_date: '2026-10-23',
        review_cadence_days: 182,
        verified_at: '2026-04-23T09:00:00Z',
      },
      error: null,
    });

    // form_responses + count + workspaces all empty (default mock)
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
    // (1) source_documents classification row.
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
      },
      error: null,
    });
    // (2) record_lifecycle governance row — no facet row for this id.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
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
