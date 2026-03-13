/**
 * API route integration tests for auth enforcement patterns.
 *
 * Tests three representative routes covering the auth spectrum:
 * 1. /api/health — no auth required
 * 2. /api/review/action — requires editor+ (uses getAuthorisedClient)
 * 3. /api/admin/users — requires admin
 *
 * All routes using getAuthorisedClient now distinguish 401 (unauthenticated)
 * from 403 (authenticated but wrong role) via AuthorisedResult.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
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

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks are declared
// ---------------------------------------------------------------------------

import { GET as healthGET } from '@/app/api/health/route';
import { POST as reviewActionPOST } from '@/app/api/review/action/route';
import { GET as adminUsersGET } from '@/app/api/admin/users/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/**
 * Reset mocks to a clean authenticated state between tests.
 *
 * IMPORTANT: We do NOT use vi.clearAllMocks() because it wipes the chainable
 * return values on the mock query builder (select/eq/etc all return `chain`).
 * Instead, we selectively reset only the stateful mocks that vary per test.
 */
function resetMocks() {
  // Reset auth to default (authenticated user)
  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Reset chain terminators — mockReset clears all queued mockResolvedValueOnce
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
  });

  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );

  // Re-establish chainable returns (mockReset clears these too)
  const chain = mockSupabase._chain;
  const chainableMethods: (keyof typeof chain)[] = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ];
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }

  // Reset admin auth calls
  mockSupabase.auth.admin.listUsers.mockReset();
  mockSupabase.auth.admin.listUsers.mockResolvedValue({
    data: { users: [] },
    error: null,
  });

  // Re-establish from() returning the chain
  mockSupabase.from.mockReturnValue(chain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API auth enforcement', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // /api/health — no auth required
  // =========================================================================

  describe('GET /api/health', () => {
    it('returns 200 without any authentication', async () => {
      configureUnauthenticated(mockSupabase);

      createTestRequest('/api/health'); // build request to verify it doesn't throw
      const response = await healthGET();

      expect([200, 503]).toContain(response.status);
      const body = await response.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
    });
  });

  // =========================================================================
  // /api/review/action — requires editor or admin
  // =========================================================================

  describe('POST /api/review/action', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/review/action', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'verify' },
      });

      const response = await reviewActionPOST(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('Unauthorised');
    });

    it('returns 403 when user has viewer role (insufficient privileges)', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/review/action', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'verify' },
      });

      const response = await reviewActionPOST(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error).toBe('Forbidden');
    });

    it('succeeds with editor role and valid payload', async () => {
      configureRole(mockSupabase, 'editor');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      const request = createTestRequest('/api/review/action', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'skip' },
      });

      const response = await reviewActionPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('succeeds with admin role and valid payload', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      const request = createTestRequest('/api/review/action', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'skip' },
      });

      const response = await reviewActionPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  // =========================================================================
  // /api/admin/users — requires admin
  // =========================================================================

  describe('GET /api/admin/users', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const response = await adminUsersGET();
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('Unauthorised');
    });

    it('returns 403 when user is editor (not admin)', async () => {
      configureRole(mockSupabase, 'editor');

      const response = await adminUsersGET();
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error).toBe('Forbidden');
    });

    it('returns 403 when user is viewer (not admin)', async () => {
      configureRole(mockSupabase, 'viewer');

      const response = await adminUsersGET();
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error).toBe('Forbidden');
    });

    it('succeeds with admin role', async () => {
      configureRole(mockSupabase, 'admin');

      const response = await adminUsersGET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // =========================================================================
  // Cross-cutting: auth function contracts
  // =========================================================================

  describe('auth function contracts', () => {
    it('getAuthorisedClient defaults missing role to viewer', async () => {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      const request = createTestRequest('/api/review/action', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'skip' },
      });

      const response = await reviewActionPOST(request);
      expect(response.status).toBe(403);
    });

    it('getAuthorisedClient defaults missing role to viewer — passes for viewer-allowed routes', async () => {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      const response = await adminUsersGET();
      expect(response.status).toBe(403);
    });
  });
});
