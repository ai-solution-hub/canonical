/**
 * API route tests for the requirement-catalogue write surface
 * (`app/api/procurement/requirement-catalogue/route.ts`, POST/PATCH) —
 * ID-147 {147.16} fix-mode remediation (Checker FAIL, TECH §7/§H1, PRODUCT
 * §H3, ID-145 BI-47).
 *
 * Covers: admin/editor auth gating (`getAuthorisedClient` +
 * `authFailureResponse`), body validation, and the happy-path
 * create/update against `form_requirement_templates`. Mirrors
 * `__tests__/api/governance/promotion-candidates/edit-route.test.ts`'s
 * gating pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseTableDispatch } from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

const VALID_CREATE = {
  template_name: 'Standard PSQ',
  template_type: 'PSQ',
  section_ref: '3.2',
  section_name: 'Health and Safety',
  requirement_text: 'Describe your H&S policy.',
  requirement_type: 'policy',
  is_mandatory: true,
  is_current: true,
  display_order: 0,
};

const ROW_ID = 'a0000000-0000-4000-8000-000000000001';

let mockSupabase: ReturnType<typeof createMockSupabaseTableDispatch>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { POST, PATCH } from '@/app/api/procurement/requirement-catalogue/route';

function makeRequest(method: 'POST' | 'PATCH', body?: unknown) {
  return createTestRequest('/api/procurement/requirement-catalogue', {
    method,
    body: body ?? {},
  });
}

function build(role: 'admin' | 'editor' | 'viewer', unauthenticated = false) {
  const dispatch = createMockSupabaseTableDispatch({
    user_roles: { data: { role }, error: null },
    form_requirement_templates: {
      data: { id: ROW_ID, ...VALID_CREATE },
      error: null,
    },
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

describe('POST /api/procurement/requirement-catalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      mockSupabase = build('editor', true);
      const res = await POST(makeRequest('POST', VALID_CREATE));
      expect(res.status).toBe(401);
    });

    it('returns 403 for a viewer role', async () => {
      mockSupabase = build('viewer');
      const res = await POST(makeRequest('POST', VALID_CREATE));
      expect(res.status).toBe(403);
    });
  });

  describe('body validation', () => {
    it('returns 400 when template_name is missing', async () => {
      mockSupabase = build('editor');
      const { template_name: _omit, ...rest } = VALID_CREATE;
      const res = await POST(makeRequest('POST', rest));
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid requirement_type', async () => {
      mockSupabase = build('editor');
      const res = await POST(
        makeRequest('POST', { ...VALID_CREATE, requirement_type: 'bogus' }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('happy path', () => {
    it('inserts the row and returns 201 for an editor', async () => {
      mockSupabase = build('editor');
      mockSupabase._chains.form_requirement_templates.single.mockResolvedValue({
        data: { id: ROW_ID, ...VALID_CREATE },
        error: null,
      });

      const res = await POST(makeRequest('POST', VALID_CREATE));

      expect(res.status).toBe(201);
      expect(mockSupabase.from).toHaveBeenCalledWith(
        'form_requirement_templates',
      );
      expect(
        mockSupabase._chains.form_requirement_templates.insert,
      ).toHaveBeenCalledWith(expect.objectContaining(VALID_CREATE));
      const body = await res.json();
      expect(body.id).toBe(ROW_ID);
    });

    it('inserts the row and returns 201 for an admin', async () => {
      mockSupabase = build('admin');
      mockSupabase._chains.form_requirement_templates.single.mockResolvedValue({
        data: { id: ROW_ID, ...VALID_CREATE },
        error: null,
      });

      const res = await POST(makeRequest('POST', VALID_CREATE));
      expect(res.status).toBe(201);
    });
  });

  describe('error mapping', () => {
    it('returns 500 when the insert errors', async () => {
      mockSupabase = build('editor');
      mockSupabase._chains.form_requirement_templates.single.mockResolvedValue({
        data: null,
        error: new Error('insert boom'),
      });

      const res = await POST(makeRequest('POST', VALID_CREATE));
      expect(res.status).toBe(500);
    });
  });
});

describe('PATCH /api/procurement/requirement-catalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      mockSupabase = build('editor', true);
      const res = await PATCH(
        makeRequest('PATCH', { id: ROW_ID, requirement_text: 'Updated.' }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for a viewer role', async () => {
      mockSupabase = build('viewer');
      const res = await PATCH(
        makeRequest('PATCH', { id: ROW_ID, requirement_text: 'Updated.' }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe('body validation', () => {
    it('returns 400 when id is missing', async () => {
      mockSupabase = build('editor');
      const res = await PATCH(
        makeRequest('PATCH', { requirement_text: 'Updated.' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when id is not a valid UUID', async () => {
      mockSupabase = build('editor');
      const res = await PATCH(
        makeRequest('PATCH', {
          id: 'not-a-uuid',
          requirement_text: 'Updated.',
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when no fields besides id are provided', async () => {
      mockSupabase = build('editor');
      const res = await PATCH(makeRequest('PATCH', { id: ROW_ID }));
      expect(res.status).toBe(400);
    });
  });

  describe('happy path', () => {
    it('updates the row matching id and returns 200 for an editor', async () => {
      mockSupabase = build('editor');
      mockSupabase._chains.form_requirement_templates.single.mockResolvedValue({
        data: { id: ROW_ID, ...VALID_CREATE, requirement_text: 'Updated.' },
        error: null,
      });

      const res = await PATCH(
        makeRequest('PATCH', { id: ROW_ID, requirement_text: 'Updated.' }),
      );

      expect(res.status).toBe(200);
      expect(
        mockSupabase._chains.form_requirement_templates.update,
      ).toHaveBeenCalledWith({ requirement_text: 'Updated.' });
      expect(
        mockSupabase._chains.form_requirement_templates.eq,
      ).toHaveBeenCalledWith('id', ROW_ID);
      const body = await res.json();
      expect(body.requirement_text).toBe('Updated.');
    });
  });

  describe('error mapping', () => {
    it('returns 404 when the row does not exist (PGRST116)', async () => {
      mockSupabase = build('editor');
      mockSupabase._chains.form_requirement_templates.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      });

      const res = await PATCH(
        makeRequest('PATCH', { id: ROW_ID, requirement_text: 'Updated.' }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 500 for any other update error', async () => {
      mockSupabase = build('editor');
      mockSupabase._chains.form_requirement_templates.single.mockResolvedValue({
        data: null,
        error: { code: '500', message: 'update boom' },
      });

      const res = await PATCH(
        makeRequest('PATCH', { id: ROW_ID, requirement_text: 'Updated.' }),
      );
      expect(res.status).toBe(500);
    });
  });
});
