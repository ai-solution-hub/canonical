import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fetchProcurementQuestions } from '@/lib/query/procurement-questions';
import { ApiError } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// fetchProcurementQuestions — shared fetcher for BOTH registrants of
// queryKeys.procurement.questions(id) (detail page useFormData + session page
// useProcurementSession). One key, one cached shape: the { questions, stats }
// route envelope. Regression context: the two hooks previously cached
// different shapes under the same key, crashing the session page with
// "questions.map is not a function" on detail -> session navigation.
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const QUESTION = {
  id: 'q-1',
  section_name: 'Section 1',
  section_sequence: 1,
  question_sequence: 1,
  question_text: 'What is your approach?',
  word_limit: 500,
  evaluation_weight: null,
  confidence_posture: 'strong_match',
  status: 'not_started',
  has_variants: false,
  assigned_to: null,
  created_by: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  response: null,
};

describe('fetchProcurementQuestions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns the { questions, stats } envelope from the route', async () => {
    const stats = {
      total_questions: 1,
      strong_match_count: 1,
      partial_match_count: 0,
      needs_sme_count: 0,
      no_content_count: 0,
      unmatched_count: 0,
      drafted_count: 0,
      complete_count: 0,
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ questions: [QUESTION], stats }),
    );

    const payload = await fetchProcurementQuestions('bid-1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/procurement/bid-1/questions',
      undefined,
    );
    expect(payload.questions).toEqual([QUESTION]);
    expect(payload.stats).toEqual(stats);
    expect(payload).not.toHaveProperty('warnings');
  });

  it('normalises a missing stats field to null and carries warnings through', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        questions: [],
        warnings: ['Question stats could not be loaded.'],
      }),
    );

    const payload = await fetchProcurementQuestions('bid-1');

    expect(payload.questions).toEqual([]);
    expect(payload.stats).toBeNull();
    expect(payload.warnings).toEqual(['Question stats could not be loaded.']);
  });

  it('throws (not a silent empty list) when a 200 payload has a non-array questions field', async () => {
    // e.g. an object keyed by id, or a nested envelope — a broken API
    // contract must surface as a query error, never render as "no questions".
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ questions: { 'q-1': QUESTION }, stats: null }),
    );

    await expect(fetchProcurementQuestions('bid-1')).rejects.toThrow(
      /malformed payload.*expected 'questions' to be an array/,
    );
  });

  it('throws when a 200 payload omits the questions field entirely', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ stats: null }));

    await expect(fetchProcurementQuestions('bid-1')).rejects.toThrow(
      /malformed payload/,
    );
  });

  it('propagates HTTP errors as ApiError (Q-37: never swallowed)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'Failed to fetch bid questions' }, false, 500),
    );

    await expect(fetchProcurementQuestions('bid-1')).rejects.toThrow(ApiError);
  });
});
