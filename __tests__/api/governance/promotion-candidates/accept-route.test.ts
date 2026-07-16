/**
 * API route tests for the per-candidate promotion ACCEPT route
 * (`app/api/governance/promotion-candidates/[extractionId]/accept/route.ts`,
 * POST) — ID-145 {145.30} (BI-38 amendment, DR-062, S470).
 *
 * Covers (testStrategy): a reviewer accepts an individual `awaiting_review`
 * promotion candidate via a new endpoint; admin/editor auth enforced.
 *
 * Business-logic branching (loader gate, embed re-generation, self-cleaning
 * writes) is unit-tested in
 * __tests__/lib/q-a-pairs/promotion-candidate-review.test.ts —
 * `acceptAwaitingReviewCandidate` is mocked here so this file stays scoped to
 * routing concerns: auth gating, status-code mapping, response shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseTableDispatch } from '../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../helpers/mock-next';

const EXTRACTION_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_ID = '22222222-2222-4222-8222-222222222222';

const { mockAccept } = vi.hoisted(() => ({
  mockAccept: vi.fn(),
}));

vi.mock('@/lib/q-a-pairs/promotion-candidate-review', () => ({
  acceptAwaitingReviewCandidate: mockAccept,
}));

let mockSupabase: ReturnType<typeof createMockSupabaseTableDispatch>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { POST } from '@/app/api/governance/promotion-candidates/[extractionId]/accept/route';

function makeContext() {
  return { params: createTestParams({ extractionId: EXTRACTION_ID }) };
}

function makeRequest() {
  return createTestRequest(
    `/api/governance/promotion-candidates/${EXTRACTION_ID}/accept`,
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

describe('POST /api/governance/promotion-candidates/:id/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      mockSupabase = build('editor', true);
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(401);
      expect(mockAccept).not.toHaveBeenCalled();
    });

    it('returns 403 for a viewer role', async () => {
      mockSupabase = build('viewer');
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(403);
      expect(mockAccept).not.toHaveBeenCalled();
    });

    it('allows the editor role', async () => {
      mockSupabase = build('editor');
      mockAccept.mockResolvedValueOnce({
        ok: true,
        pair: { id: PAIR_ID },
        extraction: { id: EXTRACTION_ID },
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(200);
    });

    it('allows the admin role', async () => {
      mockSupabase = build('admin');
      mockAccept.mockResolvedValueOnce({
        ok: true,
        pair: { id: PAIR_ID },
        extraction: { id: EXTRACTION_ID },
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(200);
    });
  });

  describe('happy path', () => {
    it('calls acceptAwaitingReviewCandidate with the RLS-scoped client + extraction id', async () => {
      mockSupabase = build('editor');
      mockAccept.mockResolvedValueOnce({
        ok: true,
        pair: { id: PAIR_ID },
        extraction: { id: EXTRACTION_ID },
      });
      await POST(makeRequest(), makeContext());
      expect(mockAccept).toHaveBeenCalledWith(
        mockSupabase,
        EXTRACTION_ID,
        'u1',
      );
    });

    it('returns disposition + pair + extraction in the body', async () => {
      mockSupabase = build('editor');
      mockAccept.mockResolvedValueOnce({
        ok: true,
        pair: { id: PAIR_ID, question_text: 'Q' },
        extraction: { id: EXTRACTION_ID },
      });
      const res = await POST(makeRequest(), makeContext());
      const body = await res.json();
      expect(body.disposition).toBe('accepted');
      expect(body.pair.id).toBe(PAIR_ID);
      expect(body.extraction.id).toBe(EXTRACTION_ID);
    });
  });

  describe('error mapping', () => {
    it('returns 404 for not_found', async () => {
      mockSupabase = build('editor');
      mockAccept.mockResolvedValueOnce({
        ok: false,
        error: { code: 'not_found', message: 'nope' },
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(404);
    });

    it('returns 409 for not_awaiting_review', async () => {
      mockSupabase = build('editor');
      mockAccept.mockResolvedValueOnce({
        ok: false,
        error: { code: 'not_awaiting_review', message: 'self-healing' },
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(409);
    });

    it('returns 500 for write_failed', async () => {
      mockSupabase = build('editor');
      mockAccept.mockResolvedValueOnce({
        ok: false,
        error: { code: 'write_failed', message: 'db boom' },
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(500);
    });

    it('returns 500 with a safe error message when the lib throws', async () => {
      mockSupabase = build('editor');
      mockAccept.mockRejectedValueOnce(new Error('unexpected'));
      const res = await POST(makeRequest(), makeContext());
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(typeof body.error).toBe('string');
    });
  });

  describe('proxy-allowlist absence (INV-14)', () => {
    it('isPublicRoute returns false for the promotion-candidates accept path', async () => {
      const { isPublicRoute } = await import('@/lib/routes');
      expect(
        isPublicRoute(
          `/api/governance/promotion-candidates/${EXTRACTION_ID}/accept`,
        ),
      ).toBe(false);
    });
  });
});
