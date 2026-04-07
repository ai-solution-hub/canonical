/**
 * Bid response API route tests.
 *
 * Tests the bid response endpoints:
 *   - GET   /api/bids/:id/responses/:rId — fetch response with citations
 *   - PATCH /api/bids/:id/responses/:rId — update response content or status
 *
 * Covers auth enforcement, UUID validation, successful operations,
 * and error handling.
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

// Mock editor-utils for word counting
vi.mock('@/lib/editor-utils', () => ({
  countWordsFromHtml: vi.fn().mockReturnValue(42),
}));

// Suppress console.error noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import {
  GET as getResponse,
  PATCH as patchResponse,
} from '@/app/api/bids/[id]/responses/[rId]/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BID_UUID = '00000000-0000-4000-8000-000000000001';
const RESPONSE_UUID = '00000000-0000-4000-8000-000000000002';
const QUESTION_UUID = '00000000-0000-4000-8000-000000000003';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bid Responses API', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // GET /api/bids/:id/responses/:rId
  // =========================================================================

  describe('GET /api/bids/:id/responses/:rId', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
      );

      const response = await getResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 400 for invalid bid UUID', async () => {
      const request = createTestRequest(
        `/api/bids/not-a-uuid/responses/${RESPONSE_UUID}`,
      );

      const response = await getResponse(request, {
        params: createTestParams({ id: 'not-a-uuid', rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Invalid ID');
    });

    it('returns 400 for invalid response UUID', async () => {
      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/bad-id`,
      );

      const response = await getResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: 'bad-id' }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Invalid ID');
    });

    it('returns 404 when response does not exist', async () => {
      // First .single() call: response lookup returns nothing
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
      );

      const response = await getResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBe('Response not found');
    });

    it('returns 200 with response data on success', async () => {
      // First .single(): response found
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          response_text: '<p>Test response</p>',
          response_text_advanced: null,
          source_content_ids: [],
          metadata: {},
          review_status: 'draft',
          version: 1,
          drafted_by: 'test-user-id',
          last_edited_by: null,
          approved_by: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      });

      // Second .single(): question lookup
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: QUESTION_UUID,
          question_text: 'What is your approach?',
          word_limit: 500,
          section_name: 'Technical',
          confidence_posture: 'high',
        },
        error: null,
      });

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
      );

      const response = await getResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.id).toBe(RESPONSE_UUID);
      expect(body.question.question_text).toBe('What is your approach?');
      expect(body.response_text).toBe('<p>Test response</p>');
      expect(body.review_status).toBe('draft');
    });
  });

  // =========================================================================
  // PATCH /api/bids/:id/responses/:rId
  // =========================================================================

  describe('PATCH /api/bids/:id/responses/:rId', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        { method: 'PATCH', body: { response_text: 'Updated' } },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        { method: 'PATCH', body: { response_text: 'Updated' } },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(403);
    });

    it('returns 400 for invalid UUID in params', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(
        `/api/bids/not-valid/responses/${RESPONSE_UUID}`,
        { method: 'PATCH', body: { response_text: 'Updated' } },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: 'not-valid', rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Invalid ID');
    });

    it('returns 404 when response does not exist', async () => {
      configureRole(mockSupabase, 'editor');

      // .single() for response lookup: not found
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        { method: 'PATCH', body: { response_text: 'Updated' } },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBe('Response not found');
    });

    it('returns 200 on successful update as editor', async () => {
      configureRole(mockSupabase, 'editor');

      // First .single(): fetch existing response
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          metadata: {},
        },
        error: null,
      });

      // .maybeSingle(): verify question belongs to bid
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: QUESTION_UUID, word_limit: 500 },
        error: null,
      });

      // Second .single(): the update result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          response_text: '<p>Updated response</p>',
          response_text_advanced: null,
          review_status: 'edited',
          version: 2,
          last_edited_by: 'test-user-id',
          approved_by: null,
          updated_at: '2026-03-01T00:00:00Z',
        },
        error: null,
      });

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        {
          method: 'PATCH',
          body: {
            response_text: '<p>Updated response</p>',
            review_status: 'edited',
          },
        },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.response_text).toBe('<p>Updated response</p>');
      expect(body.review_status).toBe('edited');
    });

    it('returns 200 on successful update as admin', async () => {
      configureRole(mockSupabase, 'admin');

      // First .single(): fetch existing response
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          metadata: {},
        },
        error: null,
      });

      // .maybeSingle(): verify question belongs to bid
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: QUESTION_UUID, word_limit: null },
        error: null,
      });

      // Second .single(): the update result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          response_text: '<p>Admin update</p>',
          response_text_advanced: null,
          review_status: 'approved',
          version: 3,
          last_edited_by: 'test-user-id',
          approved_by: 'test-user-id',
          updated_at: '2026-03-01T00:00:00Z',
        },
        error: null,
      });

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        {
          method: 'PATCH',
          body: {
            response_text: '<p>Admin update</p>',
            review_status: 'approved',
          },
        },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.review_status).toBe('approved');
    });

    it('verifies update payload includes last_edited_by', async () => {
      configureRole(mockSupabase, 'editor');

      // First .single(): fetch existing response
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          metadata: {},
        },
        error: null,
      });

      // .maybeSingle(): verify question belongs to bid
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: QUESTION_UUID, word_limit: null },
        error: null,
      });

      // Second .single(): update result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          response_text: 'Updated',
          response_text_advanced: null,
          review_status: 'edited',
          version: 2,
          last_edited_by: 'test-user-id',
          approved_by: null,
          updated_at: '2026-03-01T00:00:00Z',
        },
        error: null,
      });

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        { method: 'PATCH', body: { review_status: 'edited' } },
      );

      await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });

      // Verify the .update() call included last_edited_by
      expect(mockSupabase._chain.update).toHaveBeenCalled();
      const updateArg = mockSupabase._chain.update.mock.calls[0][0];
      expect(updateArg.last_edited_by).toBe('test-user-id');
    });

    it('returns 400 for invalid review_status value', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        { method: 'PATCH', body: { review_status: 'invalid_status' } },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 500 when database update fails', async () => {
      configureRole(mockSupabase, 'editor');

      // First .single(): fetch existing response
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: RESPONSE_UUID,
          question_id: QUESTION_UUID,
          metadata: {},
        },
        error: null,
      });

      // .maybeSingle(): verify question belongs to bid
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { id: QUESTION_UUID, word_limit: null },
        error: null,
      });

      // Second .single(): update fails
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      const request = createTestRequest(
        `/api/bids/${BID_UUID}/responses/${RESPONSE_UUID}`,
        { method: 'PATCH', body: { review_status: 'edited' } },
      );

      const response = await patchResponse(request, {
        params: createTestParams({ id: BID_UUID, rId: RESPONSE_UUID }),
      });
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe('Failed to update response');
    });
  });
});
