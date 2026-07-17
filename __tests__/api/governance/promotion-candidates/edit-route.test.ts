/**
 * API route tests for the per-candidate promotion EDIT route
 * (`app/api/governance/promotion-candidates/[extractionId]/edit/route.ts`,
 * POST) — ID-145 {145.30} (BI-38 amendment, DR-062, S470).
 *
 * Covers (testStrategy): a reviewer edits an individual `awaiting_review`
 * promotion candidate via a new endpoint; admin/editor auth enforced; body
 * validation (question_text/answer_standard required, NOT NULL columns).
 *
 * editAwaitingReviewCandidate is mocked here — business-logic branching is
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

const { mockEdit } = vi.hoisted(() => ({
  mockEdit: vi.fn(),
}));

vi.mock('@/lib/q-a-pairs/promotion-candidate-review', () => ({
  editAwaitingReviewCandidate: mockEdit,
}));

let mockSupabase: ReturnType<typeof createMockSupabaseTableDispatch>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { POST } from '@/app/api/governance/promotion-candidates/[extractionId]/edit/route';

function makeContext() {
  return { params: createTestParams({ extractionId: EXTRACTION_ID }) };
}

function makeRequest(body?: unknown) {
  return createTestRequest(
    `/api/governance/promotion-candidates/${EXTRACTION_ID}/edit`,
    { method: 'POST', body: body ?? {} },
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

const VALID_EDIT = {
  question_text: 'Do you hold a valid H&S policy document?',
  answer_standard: 'Yes — reviewed annually.',
};

describe('POST /api/governance/promotion-candidates/:id/edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      mockSupabase = build('editor', true);
      const res = await POST(makeRequest(VALID_EDIT), makeContext());
      expect(res.status).toBe(401);
      expect(mockEdit).not.toHaveBeenCalled();
    });

    it('returns 403 for a viewer role', async () => {
      mockSupabase = build('viewer');
      const res = await POST(makeRequest(VALID_EDIT), makeContext());
      expect(res.status).toBe(403);
      expect(mockEdit).not.toHaveBeenCalled();
    });
  });

  describe('body validation', () => {
    it('returns 400 when question_text is missing', async () => {
      mockSupabase = build('editor');
      const res = await POST(
        makeRequest({ answer_standard: 'Yes.' }),
        makeContext(),
      );
      expect(res.status).toBe(400);
      expect(mockEdit).not.toHaveBeenCalled();
    });

    it('returns 400 when question_text is empty', async () => {
      mockSupabase = build('editor');
      const res = await POST(
        makeRequest({ question_text: '', answer_standard: 'Yes.' }),
        makeContext(),
      );
      expect(res.status).toBe(400);
      expect(mockEdit).not.toHaveBeenCalled();
    });

    it('returns 400 when answer_standard is missing', async () => {
      mockSupabase = build('editor');
      const res = await POST(
        makeRequest({ question_text: 'Q?' }),
        makeContext(),
      );
      expect(res.status).toBe(400);
      expect(mockEdit).not.toHaveBeenCalled();
    });

    it('rejects an unknown field (.strict())', async () => {
      mockSupabase = build('editor');
      const res = await POST(
        makeRequest({ ...VALID_EDIT, publication_status: 'archived' }),
        makeContext(),
      );
      expect(res.status).toBe(400);
      expect(mockEdit).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('passes the validated edit body through to editAwaitingReviewCandidate', async () => {
      mockSupabase = build('editor');
      mockEdit.mockResolvedValueOnce({
        ok: true,
        pair: { id: PAIR_ID },
        extraction: { id: EXTRACTION_ID },
      });
      const res = await POST(makeRequest(VALID_EDIT), makeContext());
      expect(res.status).toBe(200);
      expect(mockEdit).toHaveBeenCalledWith(
        mockSupabase,
        EXTRACTION_ID,
        VALID_EDIT,
        'u1',
      );
      const body = await res.json();
      expect(body.disposition).toBe('edited');
    });

    it('accepts an optional alternate_question_phrasings array', async () => {
      mockSupabase = build('editor');
      mockEdit.mockResolvedValueOnce({
        ok: true,
        pair: { id: PAIR_ID },
        extraction: { id: EXTRACTION_ID },
      });
      const withPhrasings = {
        ...VALID_EDIT,
        alternate_question_phrasings: ['H&S doc?'],
      };
      await POST(makeRequest(withPhrasings), makeContext());
      expect(mockEdit).toHaveBeenCalledWith(
        mockSupabase,
        EXTRACTION_ID,
        withPhrasings,
        'u1',
      );
    });
  });

  describe('error mapping', () => {
    it('returns 409 for not_awaiting_review', async () => {
      mockSupabase = build('editor');
      mockEdit.mockResolvedValueOnce({
        ok: false,
        error: { code: 'not_awaiting_review', message: 'self-healing' },
      });
      const res = await POST(makeRequest(VALID_EDIT), makeContext());
      expect(res.status).toBe(409);
    });
  });
});
