/**
 * Bid questions creation API route tests.
 *
 * Tests the POST /api/bids/:id/questions endpoint:
 *   - Single question creation
 *   - Batch question creation
 *
 * Covers auth enforcement, UUID validation, body validation,
 * successful operations, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
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

// Suppress console.error noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { POST as postQuestions } from '@/app/api/procurement/[id]/questions/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BID_UUID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

function resetMocks() {
  // NB: `vi.clearAllMocks()` clears `mock.calls` but does NOT drain the
  // `mockResolvedValueOnce` queue. We `mockReset()` terminal methods to
  // drop their queues so leftover once-mocks don't leak into the next test.
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockReset();
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
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bid Questions Create API', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // Auth enforcement
  // =========================================================================

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });
    expect(response.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });
    expect(response.status).toBe(403);
  });

  // =========================================================================
  // UUID validation
  // =========================================================================

  it('returns 400 for invalid bid ID in params', async () => {
    configureRole(mockSupabase, 'editor');

    const request = createTestRequest('/api/bids/not-a-uuid/questions', {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: 'not-a-uuid' }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid bid ID');
  });

  // =========================================================================
  // Body validation
  // =========================================================================

  it('returns 400 for missing question_text in single question', async () => {
    configureRole(mockSupabase, 'editor');

    // Bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: { section_name: 'Technical' },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    // Bid lookup returns null
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found' },
    });

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: { question_text: 'Test question?' },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe('Bid not found');
  });

  // =========================================================================
  // Successful single question creation
  // =========================================================================

  it('returns 201 on successful single question creation', async () => {
    configureRole(mockSupabase, 'editor');

    // First .single(): bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // .then(): max sequence query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ question_sequence: 5 }], error: null }),
    );

    // Second .single(): insert result.
    // Post-T2: `bid_questions.project_id` → `workspace_id`.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: '00000000-0000-4000-8000-000000000099',
        workspace_id: BID_UUID,
        section_name: 'Technical',
        section_sequence: 0,
        question_text: 'What is your approach?',
        question_sequence: 6,
        word_limit: 500,
        evaluation_weight: null,
        confidence_posture: null,
        matched_content_ids: null,
        assigned_to: null,
        created_by: 'test-user-id',
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
      },
      error: null,
    });

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: {
        question_text: 'What is your approach?',
        section_name: 'Technical',
        word_limit: 500,
      },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.workspace_id).toBe(BID_UUID);
    expect(body.question_text).toBe('What is your approach?');
    expect(body.created_by).toBe('test-user-id');
  });

  // =========================================================================
  // Successful batch question creation
  // =========================================================================

  it('returns 201 on successful batch question creation', async () => {
    configureRole(mockSupabase, 'editor');

    // First .single(): bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // .then(): batch insert result.
    // Post-T2: `bid_questions.project_id` → `workspace_id`.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: '00000000-0000-4000-8000-000000000010',
              workspace_id: BID_UUID,
              question_text: 'Question 1?',
              question_sequence: 0,
              created_by: 'test-user-id',
            },
            {
              id: '00000000-0000-4000-8000-000000000011',
              workspace_id: BID_UUID,
              question_text: 'Question 2?',
              question_sequence: 1,
              created_by: 'test-user-id',
            },
          ],
          error: null,
        }),
    );

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: {
        questions: [
          { question_text: 'Question 1?', section_name: 'General' },
          { question_text: 'Question 2?', section_name: 'Technical' },
        ],
      },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.questions).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('verifies questions are inserted with correct workspace_id', async () => {
    configureRole(mockSupabase, 'editor');

    // First .single(): bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    // .then(): batch insert result.
    // Post-T2: `bid_questions.project_id` → `workspace_id`.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: '00000000-0000-4000-8000-000000000010',
              workspace_id: BID_UUID,
            },
          ],
          error: null,
        }),
    );

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: {
        questions: [{ question_text: 'Check workspace_id?' }],
      },
    });

    await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });

    // Verify .insert() was called and rows had correct workspace_id.
    // Post-T2: `bid_questions` keys workspace not legacy project.
    expect(mockSupabase._chain.insert).toHaveBeenCalled();
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    // Could be a single row or array
    const rows = Array.isArray(insertArg) ? insertArg : [insertArg];
    for (const row of rows) {
      expect(row.workspace_id).toBe(BID_UUID);
    }
  });

  it('returns 400 for empty questions array in batch', async () => {
    configureRole(mockSupabase, 'editor');

    // Bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    const request = createTestRequest(`/api/bids/${BID_UUID}/questions`, {
      method: 'POST',
      body: { questions: [] },
    });

    const response = await postQuestions(request, {
      params: createTestParams({ id: BID_UUID }),
    });
    // Empty questions array should fail both batch and single validation
    expect(response.status).toBe(400);
  });
});
