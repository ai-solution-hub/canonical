/**
 * API route tests for the per-candidate promotion REJECT route
 * (`app/api/governance/promotion-candidates/[extractionId]/reject/route.ts`,
 * POST) — ID-145 {145.30} (BI-38 amendment, DR-062, S470).
 *
 * Covers (testStrategy): a reviewer rejects an individual `awaiting_review`
 * promotion candidate via a new endpoint; admin/editor auth enforced.
 *
 * rejectAwaitingReviewCandidate is mocked here — business-logic branching is
 * unit-tested in __tests__/lib/q-a-pairs/promotion-candidate-review.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseTableDispatch } from '../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../helpers/mock-next';

const EXTRACTION_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_ID = '22222222-2222-4222-8222-222222222222';

const { mockReject } = vi.hoisted(() => ({
  mockReject: vi.fn(),
}));

vi.mock('@/lib/q-a-pairs/promotion-candidate-review', () => ({
  rejectAwaitingReviewCandidate: mockReject,
}));

let mockSupabase: ReturnType<typeof createMockSupabaseTableDispatch>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { POST } from '@/app/api/governance/promotion-candidates/[extractionId]/reject/route';

function makeContext() {
  return { params: createTestParams({ extractionId: EXTRACTION_ID }) };
}

function makeRequest() {
  return createTestRequest(
    `/api/governance/promotion-candidates/${EXTRACTION_ID}/reject`,
    { method: 'POST' },
  );
}

function build(role: 'admin' | 'editor' | 'viewer', unauthenticated = false) {
  const dispatch = createMockSupabaseTableDispatch({
    user_roles: { data: { role }, error: null },
  });
  dispatch._chains.user_roles.single.mockResolvedValue({
    data: { role },
    error: null,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dispatch as any).auth = {
    getUser: vi.fn().mockResolvedValue(
      unauthenticated
        ? {
            data: { user: null },
            error: { name: 'AuthSessionMissingError', message: 'missing' },
          }
        : { data: { user: { id: 'u1', email: 't@example.com' } }, error: null },
    ),
  };
  return dispatch;
}

describe('POST /api/governance/promotion-candidates/:id/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      mockSupabase = build('editor', true);
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(401);
      expect(mockReject).not.toHaveBeenCalled();
    });

    it('returns 403 for a viewer role', async () => {
      mockSupabase = build('viewer');
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(403);
      expect(mockReject).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('writes nothing to the pair — passes through the disposition + rows', async () => {
      mockSupabase = build('editor');
      mockReject.mockResolvedValueOnce({
        ok: true,
        pair: { id: PAIR_ID },
        extraction: { id: EXTRACTION_ID },
      });
      const res = await POST(makeRequest(), makeContext());
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.disposition).toBe('rejected');
      expect(mockReject).toHaveBeenCalledWith(
        mockSupabase,
        EXTRACTION_ID,
        'u1',
      );
    });
  });

  describe('error mapping', () => {
    it('returns 409 for not_awaiting_review', async () => {
      mockSupabase = build('editor');
      mockReject.mockResolvedValueOnce({
        ok: false,
        error: { code: 'not_awaiting_review', message: 'new candidate' },
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(409);
    });

    it('returns 404 for not_found', async () => {
      mockSupabase = build('editor');
      mockReject.mockResolvedValueOnce({
        ok: false,
        error: { code: 'not_found', message: 'nope' },
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(404);
    });
  });
});
