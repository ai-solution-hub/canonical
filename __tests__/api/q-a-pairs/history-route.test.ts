/**
 * API route tests for the Q&A revision-history fetch route
 * (`app/api/q-a-pairs/[id]/history/route.ts`, GET) — ID-59 {59.16}
 * (PC-14..17 / INV-14..17 user-edit Diff-UI, Q&A leg; bl-273 promote).
 *
 * Covers:
 *   - Auth gating: unauthenticated (401), viewer allowed (read route).
 *   - Happy path: returns q_a_pair_history rows INCLUDING `edit_intent`,
 *     version-descending, for the requested pair. The list rows carry the
 *     full revision body (answer_standard etc.) so the diff blobs come
 *     straight from the list — no separate per-version detail route.
 *   - Validation: a non-UUID id → 400 (mirrors the items history route).
 *   - Failure surfacing: a DB error → 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// The route logs DB errors via @/lib/logger, which imports `server-only`
// (a no-op under jsdom). Mock it so the suite never pulls the pino/server-only
// chain — we assert on the HTTP status, not on log output.
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET } from '@/app/api/q-a-pairs/[id]/history/route';

const QA_UUID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';

function makeContext(id = QA_UUID) {
  return { params: createTestParams({ id }) };
}

function makeRequest(id = QA_UUID) {
  return createTestRequest(`/api/q-a-pairs/${id}/history`);
}

/** The rows the list query (…range()) resolves to. */
function configureHistoryReturns(
  rows: Array<Record<string, unknown>>,
  count = rows.length,
) {
  mockSupabase._chain.range.mockResolvedValueOnce({
    data: rows,
    error: null,
    count,
  });
}

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.range.mockResolvedValue({
    data: [],
    error: null,
    count: 0,
  });
}

describe('GET /api/q-a-pairs/:id/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(401);
    });

    it('allows the viewer role (read-only history route)', async () => {
      configureRole(mockSupabase, 'viewer');
      configureHistoryReturns([]);
      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
    });
  });

  describe('validation', () => {
    it('returns 400 for a non-UUID id', async () => {
      configureRole(mockSupabase, 'viewer');
      const res = await GET(
        makeRequest('not-a-uuid'),
        makeContext('not-a-uuid'),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('happy path — history rows incl edit_intent', () => {
    it('returns q_a_pair_history rows carrying edit_intent for the pair', async () => {
      configureRole(mockSupabase, 'editor');
      configureHistoryReturns([
        {
          id: 'h2',
          q_a_pair_id: QA_UUID,
          version: 2,
          question_text: 'What is the SLA?',
          answer_standard: 'Four hours.',
          answer_advanced: null,
          origin_kind: 'curated_explicit',
          publication_status: 'published',
          changed_at: '2026-06-10T10:00:00.000Z',
          changed_by: 'user-1',
          edit_intent: 'data',
        },
        {
          id: 'h1',
          q_a_pair_id: QA_UUID,
          version: 1,
          question_text: 'What is the SLA?',
          answer_standard: 'Eight hours.',
          answer_advanced: null,
          origin_kind: 'curated_explicit',
          publication_status: 'published',
          changed_at: '2026-06-09T10:00:00.000Z',
          changed_by: 'user-1',
          edit_intent: 'cosmetic',
        },
      ]);

      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      const body = await res.json();

      // The route targets q_a_pair_history, filtered to this pair.
      expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pair_history');
      expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
        'q_a_pair_id',
        QA_UUID,
      );

      // edit_intent is present on every returned row (the {59.16} contract).
      expect(body.versions).toHaveLength(2);
      expect(body.versions[0].edit_intent).toBe('data');
      expect(body.versions[1].edit_intent).toBe('cosmetic');
      expect(body.total).toBe(2);

      // The history select() column list MUST request edit_intent. (The first
      // select() call belongs to the getAuthorisedClient role lookup, so match
      // across all calls for the one carrying the history column set.)
      const selectArgs = mockSupabase._chain.select.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(selectArgs.some((arg) => arg.includes('edit_intent'))).toBe(true);
    });
  });

  describe('failure surfacing', () => {
    it('returns 500 when the history query fails', async () => {
      configureRole(mockSupabase, 'editor');
      mockSupabase._chain.range.mockResolvedValueOnce({
        data: null,
        error: { message: 'boom', code: 'XXXXX' },
        count: null,
      });

      const res = await GET(makeRequest(), makeContext());
      expect(res.status).toBe(500);
    });
  });
});
