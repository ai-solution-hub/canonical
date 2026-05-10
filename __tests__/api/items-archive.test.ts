/**
 * Items Archive API Route Tests
 *
 * Tests the POST /api/items/[id]/archive endpoint that soft-archives
 * content items by setting archived_at, archived_by, and archive_reason.
 *
 * Covers:
 *   - Authentication and role enforcement
 *   - UUID validation
 *   - Request body validation (reason field)
 *   - Successful archive operation
 *   - Error handling for missing items and DB failures
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

// Suppress console.error noise from expected error paths
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/items/[id]/archive/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INVALID_UUID = 'not-a-uuid';

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

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
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

describe('POST /api/items/[id]/archive', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // Authentication
  // =========================================================================

  describe('authentication', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Discarded during upload review' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorised');
    });

    it('returns 403 when user has viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Discarded during upload review' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('Forbidden');
    });

    it('allows editor role', async () => {
      configureRole(mockSupabase, 'editor');

      // Configure successful archive response
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          title: 'Test Item',
          archived_at: '2026-03-22T10:00:00Z',
          archived_by: 'test-user-id',
          archive_reason: 'Discarded during upload review',
        },
        error: null,
      });

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Discarded during upload review' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(200);
    });

    it('allows admin role', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          title: 'Test Item',
          archived_at: '2026-03-22T10:00:00Z',
          archived_by: 'test-user-id',
          archive_reason: 'No longer relevant',
        },
        error: null,
      });

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'No longer relevant' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(200);
    });
  });

  // =========================================================================
  // UUID validation
  // =========================================================================

  describe('UUID validation', () => {
    it('returns 400 for invalid UUID format', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(`/api/items/${INVALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Test reason' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: INVALID_UUID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/invalid item id/i);
    });

    it('returns 400 for empty string ID', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest('/api/items//archive', {
        method: 'POST',
        body: { reason: 'Test reason' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: '' }),
      });

      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // Body validation
  // =========================================================================

  describe('body validation', () => {
    it('returns 400 when body has no reason field', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: {},
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 when reason is an empty string', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: '' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 when reason is whitespace only', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: '   ' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 when reason is not a string', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 42 },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 when body is not valid JSON', async () => {
      configureRole(mockSupabase, 'editor');

      // Create a request with invalid JSON body
      const url = new URL(
        `/api/items/${VALID_UUID}/archive`,
        'http://localhost:3000',
      );
      const request = new (await import('next/server')).NextRequest(url, {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/invalid json/i);
    });
  });

  // =========================================================================
  // Successful archive
  // =========================================================================

  describe('successful archive', () => {
    it('records who archived the item, when, and why', async () => {
      configureRole(mockSupabase, 'editor');

      const archivedItem = {
        id: VALID_UUID,
        title: 'ISO 27001 Policy',
        archived_at: '2026-03-22T10:00:00Z',
        archived_by: 'test-user-id',
        archive_reason: 'Discarded during upload review',
      };

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: archivedItem,
        error: null,
      });

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Discarded during upload review' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.id).toBe(VALID_UUID);
      expect(body.archived_at).toBe('2026-03-22T10:00:00Z');
      expect(body.archived_by).toBe('test-user-id');
      expect(body.archive_reason).toBe('Discarded during upload review');
    });

    it('calls supabase update with correct fields', async () => {
      configureRole(mockSupabase, 'editor');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          title: 'Test',
          archived_at: '2026-03-22T10:00:00Z',
          archived_by: 'test-user-id',
          archive_reason: 'Test reason',
        },
        error: null,
      });

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Test reason' },
      });

      await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      // Verify the chain was called: from('content_items').update(...).eq('id', ...).select().single()
      expect(mockSupabase.from).toHaveBeenCalledWith('content_items');
      expect(mockSupabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          archived_by: 'test-user-id',
          archive_reason: 'Test reason',
        }),
      );
      expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', VALID_UUID);
    });

    it('trims the reason string', async () => {
      configureRole(mockSupabase, 'editor');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          title: 'Test',
          archived_at: '2026-03-22T10:00:00Z',
          archived_by: 'test-user-id',
          archive_reason: 'Trimmed reason',
        },
        error: null,
      });

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: '  Trimmed reason  ' },
      });

      await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(mockSupabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          archive_reason: 'Trimmed reason',
        }),
      );
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('returns 404 when item is not found (null data, no error)', async () => {
      configureRole(mockSupabase, 'editor');

      // Supabase returns null data but no error for non-existent items
      // with .single() — actually it returns an error for .single() on 0 rows
      // But our route checks for !data after the DB call
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Test reason' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toMatch(/not found/i);
    });

    it('returns 500 when database update fails', async () => {
      configureRole(mockSupabase, 'editor');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error', code: '42P01' },
      });

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Test reason' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toMatch(/failed to archive/i);
    });

    it('returns 500 when an unexpected error is thrown', async () => {
      configureRole(mockSupabase, 'editor');

      // Simulate an unexpected throw during the archive operation
      mockSupabase._chain.single.mockRejectedValueOnce(
        new Error('Unexpected failure'),
      );

      const request = createTestRequest(`/api/items/${VALID_UUID}/archive`, {
        method: 'POST',
        body: { reason: 'Test reason' },
      });

      const response = await POST(request, {
        params: createTestParams({ id: VALID_UUID }),
      });

      expect(response.status).toBe(500);
    });
  });
});
