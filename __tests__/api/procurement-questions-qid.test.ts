/**
 * Procurement single-question API route tests — PATCH/DELETE
 * /api/procurement/:id/questions/:qId.
 *
 * ID-145 {145.6} M3 / {145.7}: `form_questions.workspace_id` and
 * `matched_record_ids` are dropped — this route was NOT touched by {145.7}
 * (unlike its siblings questions/route.ts and questions/extract/route.ts,
 * see git history) and still filtered/selected on the dropped columns until
 * {145.17} fixed it in the same pass as the R7 recompute wiring (BI-34).
 * Every "question exists" scenario below resolves against
 * `.eq('form_instance_id', id)`, not `.eq('workspace_id', id)`.
 *
 * {145.17} (R7/BI-34): a successful PATCH also triggers a best-effort
 * `question_match_recompute` call via the shared
 * lib/domains/procurement/question-match-recompute helper — mocked here at
 * the `@/lib/ai/embed` + `@/lib/organisation-profile` boundary (the helper
 * itself is unit-tested directly in
 * __tests__/lib/domains/procurement/question-match-recompute.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client + AI service mocks
// ---------------------------------------------------------------------------

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

const { mockGenerateEmbedding, mockGetOrganisationProfile } = vi.hoisted(
  () => ({
    mockGenerateEmbedding: vi.fn(),
    mockGetOrganisationProfile: vi.fn(),
  }),
);

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@/lib/organisation-profile', () => ({
  getOrganisationProfile: mockGetOrganisationProfile,
}));

vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import {
  PATCH as patchQuestion,
  DELETE as deleteQuestion,
} from '@/app/api/procurement/[id]/questions/[qId]/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORM_UUID = '00000000-0000-4000-8000-000000000001';
const QUESTION_UUID = '00000000-0000-4000-8000-000000000002';

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
    mockSupabase._chain[method].mockReset();
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  mockGenerateEmbedding.mockReset();
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  mockGetOrganisationProfile.mockReset();
  mockGetOrganisationProfile.mockResolvedValue(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Procurement Single Question API (PATCH/DELETE)', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // Auth enforcement
  // =========================================================================

  it('PATCH returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'PATCH', body: { question_text: 'Updated?' } },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(401);
  });

  it('PATCH returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'PATCH', body: { question_text: 'Updated?' } },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(403);
  });

  // =========================================================================
  // UUID validation
  // =========================================================================

  it('PATCH returns 400 for an invalid bid id', async () => {
    configureRole(mockSupabase, 'editor');

    const request = createTestRequest(
      `/api/procurement/not-a-uuid/questions/${QUESTION_UUID}`,
      { method: 'PATCH', body: { question_text: 'Updated?' } },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: 'not-a-uuid', qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(400);
  });

  it('PATCH returns 400 for an invalid question id', async () => {
    configureRole(mockSupabase, 'editor');

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/not-a-uuid`,
      { method: 'PATCH', body: { question_text: 'Updated?' } },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: 'not-a-uuid' }),
    });
    expect(response.status).toBe(400);
  });

  it('PATCH returns 400 when the body has no fields to update', async () => {
    configureRole(mockSupabase, 'editor');

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'PATCH', body: {} },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(400);
  });

  // =========================================================================
  // Successful update — form_instance_id scoping (post-{145.6} M3) + recompute
  // =========================================================================

  it('PATCH scopes the update on form_instance_id, not the dropped workspace_id', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: QUESTION_UUID,
        form_instance_id: FORM_UUID,
        section_name: 'Technical',
        section_sequence: 0,
        question_text: 'What is your approach?',
        question_sequence: 1,
        word_limit: 500,
        evaluation_weight: null,
        confidence_posture: null,
        assigned_to: null,
        created_by: 'test-user-id',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    // form_instances form_type lookup (best-effort)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { form_type: 'itt' },
      error: null,
    });

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'PATCH', body: { question_text: 'What is your approach?' } },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.form_instance_id).toBe(FORM_UUID);
    // No workspace_id/matched_record_ids on the response shape.
    expect(body.workspace_id).toBeUndefined();
    expect(body.matched_record_ids).toBeUndefined();

    // The update chain was filtered on form_instance_id (not workspace_id).
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'form_instance_id',
      FORM_UUID,
    );
    expect(mockSupabase._chain.eq).not.toHaveBeenCalledWith(
      'workspace_id',
      FORM_UUID,
    );
  });

  it('PATCH returns 404 when no question matches (PGRST116)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'PATCH', body: { question_text: 'Updated?' } },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(404);

    // A failed update never reaches the recompute step.
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('PATCH recomputes question_matches with the form_type-derived question_kind after a successful update', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: QUESTION_UUID,
        form_instance_id: FORM_UUID,
        question_text: 'Describe your GDPR compliance approach',
        section_name: 'Technical',
        section_sequence: 0,
        question_sequence: 1,
      },
      error: null,
    });
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { form_type: 'psq' },
      error: null,
    });

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      {
        method: 'PATCH',
        body: { question_text: 'Describe your GDPR compliance approach' },
      },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(200);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('question_match_recompute', {
      p_form_question_id: QUESTION_UUID,
      p_query: 'Describe your GDPR compliance approach',
      p_query_embedding: JSON.stringify([0.1, 0.2, 0.3]),
      p_question_kind: 'psq',
      p_scope_tag: ['psq'],
      p_anti_scope_tag: [],
      p_limit: 20,
    });
  });

  it('PATCH still returns 200 when the form_type lookup finds no row (recompute skipped, non-critical)', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: QUESTION_UUID,
        form_instance_id: FORM_UUID,
        question_text: 'Updated?',
      },
      error: null,
    });
    // form_instances lookup returns no row (maybeSingle default: null, no error)

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'PATCH', body: { question_text: 'Updated?' } },
    );
    const response = await patchQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  // =========================================================================
  // DELETE — form_instance_id scoping (post-{145.6} M3)
  // =========================================================================

  it('DELETE scopes on form_instance_id, not the dropped workspace_id', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'DELETE' },
    );
    const response = await deleteQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });

    expect(response.status).toBe(204);
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'form_instance_id',
      FORM_UUID,
    );
    expect(mockSupabase._chain.eq).not.toHaveBeenCalledWith(
      'workspace_id',
      FORM_UUID,
    );
  });

  it('DELETE returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'DELETE' },
    );
    const response = await deleteQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(401);
  });

  it('DELETE returns 500 on a database error', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'db error' } }),
    );

    const request = createTestRequest(
      `/api/procurement/${FORM_UUID}/questions/${QUESTION_UUID}`,
      { method: 'DELETE' },
    );
    const response = await deleteQuestion(request, {
      params: createTestParams({ id: FORM_UUID, qId: QUESTION_UUID }),
    });
    expect(response.status).toBe(500);
  });
});
