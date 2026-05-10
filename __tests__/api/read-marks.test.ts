/**
 * Read marks API route tests.
 *
 * Tests the read-tracking endpoints:
 *   - GET  /api/read-marks           — check read status for items
 *   - POST /api/read-marks           — mark/unmark items as read
 *
 * Covers auth enforcement, body validation (discriminated union),
 * successful mark/unmark, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

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

import {
  GET as getReadMarks,
  POST as postReadMark,
} from '@/app/api/read-marks/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ITEM_UUID = '00000000-0000-4000-8000-000000000001';

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

describe('Read Marks API', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // GET /api/read-marks
  // =========================================================================

  describe('GET /api/read-marks', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/read-marks');

      const response = await getReadMarks(request);
      expect(response.status).toBe(401);
    });

    it('returns counts when no item_ids provided', async () => {
      // Promise.all calls: both resolve via .then
      // The GET handler uses Promise.all with two queries that are awaited
      // Both will resolve through the chain's .then default
      const request = createTestRequest('/api/read-marks');

      const response = await getReadMarks(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('read_item_ids');
      expect(body).toHaveProperty('read_count');
      expect(body).toHaveProperty('total_count');
      expect(body.read_item_ids).toEqual([]);
    });

    it('returns 400 for invalid item_ids parameter', async () => {
      const request = createTestRequest('/api/read-marks', {
        searchParams: { item_ids: 'not-a-uuid,also-invalid' },
      });

      const response = await getReadMarks(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toBeDefined();
    });

    it('accepts a single UUID (no comma) as item_ids', async () => {
      // parseSearchParams returns a string for single comma-less values; schema
      // must coerce to [uuid]. Regression guard for `?item_ids=<single-uuid>`.
      const request = createTestRequest('/api/read-marks', {
        searchParams: { item_ids: '38cee67d-82d9-4b99-9cec-49920df62237' },
      });

      const response = await getReadMarks(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('read_item_ids');
    });
  });

  // =========================================================================
  // POST /api/read-marks — mark_read
  // =========================================================================

  describe('POST /api/read-marks (mark_read)', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'mark_read', item_id: ITEM_UUID },
      });

      const response = await postReadMark(request);
      expect(response.status).toBe(401);
    });

    it('returns 200 on successful mark_read', async () => {
      // upsert resolves via the chain's .then default (no error)
      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'mark_read', item_id: ITEM_UUID },
      });

      const response = await postReadMark(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('records the read mark against the authenticated caller', async () => {
      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'mark_read', item_id: ITEM_UUID, source: 'manual' },
      });

      await postReadMark(request);

      // Verify upsert was called with the authenticated user's ID
      expect(mockSupabase._chain.upsert).toHaveBeenCalled();
      const upsertArg = mockSupabase._chain.upsert.mock.calls[0][0];
      expect(upsertArg.user_id).toBe('test-user-id');
      expect(upsertArg.content_item_id).toBe(ITEM_UUID);
    });

    it('returns 400 for invalid item_id', async () => {
      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'mark_read', item_id: 'not-valid' },
      });

      const response = await postReadMark(request);
      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // POST /api/read-marks — mark_unread
  // =========================================================================

  describe('POST /api/read-marks (mark_unread)', () => {
    it('returns 200 on successful mark_unread', async () => {
      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'mark_unread', item_id: ITEM_UUID },
      });

      const response = await postReadMark(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('calls delete with correct user_id and item_id', async () => {
      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'mark_unread', item_id: ITEM_UUID },
      });

      await postReadMark(request);

      // Verify delete chain was called
      expect(mockSupabase._chain.delete).toHaveBeenCalled();
      // eq should have been called with content_item_id and user_id
      expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
        'content_item_id',
        ITEM_UUID,
      );
      expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
        'user_id',
        'test-user-id',
      );
    });
  });

  // =========================================================================
  // POST /api/read-marks — mark_bulk_read
  // =========================================================================

  describe('POST /api/read-marks (mark_bulk_read)', () => {
    it('returns 200 on successful bulk mark', async () => {
      const itemIds = [
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
      ];

      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'mark_bulk_read', item_ids: itemIds },
      });

      const response = await postReadMark(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  // =========================================================================
  // Invalid action
  // =========================================================================

  describe('POST /api/read-marks (invalid action)', () => {
    it('returns 400 for unknown action type', async () => {
      const request = createTestRequest('/api/read-marks', {
        method: 'POST',
        body: { action: 'toggle', item_id: ITEM_UUID },
      });

      const response = await postReadMark(request);
      expect(response.status).toBe(400);
    });
  });
});
