/**
 * POST /api/procurement/[id]/responses/manual — ID-145 {145.44} fix dispatch
 * (BI-40/BI-22, DR-062). The zero-candidate manual-answer affordance's
 * PRIMARY act: create a form_responses row directly, so the question
 * deterministically leaves the "empty" state (never contingent on a later
 * re-match). Honestly stamped review_status='draft' + drafted_by=<the
 * acting user>, never PIPELINE_SYSTEM_USER_ID (that would misrepresent it
 * as AI-drafted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

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

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST } from '@/app/api/procurement/[id]/responses/manual/route';

const BID_ID = '00000000-0000-4000-8000-000000000001';
const QUESTION_ID = '00000000-0000-4000-8000-000000000003';

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

describe('POST /api/procurement/[id]/responses/manual', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: { question_id: QUESTION_ID, response_text: 'x' },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: { question_id: QUESTION_ID, response_text: 'x' },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      '/api/procurement/not-a-uuid/responses/manual',
      {
        method: 'POST',
        body: { question_id: QUESTION_ID, response_text: 'x' },
      },
    );
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid bid ID');
  });

  it('rejects an empty answer with a validation error', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: { question_id: QUESTION_ID, response_text: '   ' },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed question_id with a validation error', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: { question_id: 'not-a-uuid', response_text: 'An answer.' },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the question does not belong to this bid', async () => {
    configureRole(mockSupabase, 'editor');
    // Question ownership check — no row found.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: { question_id: QUESTION_ID, response_text: 'An answer.' },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Question not found for this bid');
  });

  it('creates the response and stamps it honestly as a human draft', async () => {
    configureRole(mockSupabase, 'editor');
    // Question ownership check — found.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID },
      error: null,
    });
    // Insert succeeds.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'resp-1',
        question_id: QUESTION_ID,
        response_text: 'We follow our safeguarding policy at all times.',
        review_status: 'draft',
        drafted_by: 'test-user-id',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: {
          question_id: QUESTION_ID,
          response_text: 'We follow our safeguarding policy at all times.',
        },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.question_id).toBe(QUESTION_ID);
    expect(json.review_status).toBe('draft');
    expect(json.drafted_by).toBe('test-user-id');

    // Never a form_responses upsert (would silently overwrite an existing
    // answer) -- a plain insert, so a genuine duplicate surfaces as a
    // conflict instead.
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        question_id: QUESTION_ID,
        response_text: 'We follow our safeguarding policy at all times.',
        review_status: 'draft',
        drafted_by: 'test-user-id',
      }),
    );
    expect(mockSupabase._chain.upsert).not.toHaveBeenCalled();
  });

  it('returns 409 when the question already has a response', async () => {
    configureRole(mockSupabase, 'editor');
    // Question ownership check — found.
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID },
      error: null,
    });
    // Insert fails on the unique question_id constraint.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: { question_id: QUESTION_ID, response_text: 'An answer.' },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('This question already has a response');
  });

  it('returns 500 on a generic insert failure', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: QUESTION_ID },
      error: null,
    });
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Permission denied' },
    });

    const req = createTestRequest(
      `/api/procurement/${BID_ID}/responses/manual`,
      {
        method: 'POST',
        body: { question_id: QUESTION_ID, response_text: 'An answer.' },
      },
    );
    const params = createTestParams({ id: BID_ID });
    const res = await POST(req, { params });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to save manual response');
  });
});
