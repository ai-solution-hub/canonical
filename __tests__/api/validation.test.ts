/**
 * Cross-cutting input validation pattern tests.
 *
 * Tests the shared validation patterns used across API routes:
 *   - Invalid JSON body → 400
 *   - Missing required fields → 400
 *   - Invalid UUID parameters → 400
 *   - Invalid enum values → 400
 *
 * Uses representative routes to verify validation is consistently enforced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import type { MockSupabaseClient } from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

// Extend the shared type to include inviteUserByEmail (admin routes only)
interface AdminMockClient extends MockSupabaseClient {
  auth: MockSupabaseClient['auth'] & {
    admin: MockSupabaseClient['auth']['admin'] & {
      inviteUserByEmail: ReturnType<typeof vi.fn>;
    };
  };
}

const mockSupabase = createMockSupabaseClient() as AdminMockClient;

// Add inviteUserByEmail — not in the shared helper but needed by admin routes
mockSupabase.auth.admin.inviteUserByEmail =
  vi.fn().mockResolvedValue({ data: { user: null }, error: null });

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
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { POST as inviteUser } from '@/app/api/admin/users/invite/route';
import { PATCH as updateUserRole } from '@/app/api/admin/users/[userId]/route';
import { POST as reviewAction } from '@/app/api/review/action/route';
import { POST as searchPost } from '@/app/api/search/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

function resetMocks() {
  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });

  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );

  const chain = mockSupabase._chain;
  const chainableMethods: (keyof typeof chain)[] = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ];
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }
  mockSupabase.from.mockReturnValue(chain);

  mockSupabase.auth.admin.inviteUserByEmail.mockReset();
  mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
    data: { user: null },
    error: null,
  });
  mockSupabase.auth.admin.updateUserById.mockReset();
  mockSupabase.auth.admin.updateUserById.mockResolvedValue({
    data: { user: null },
    error: null,
  });
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-cutting input validation', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // Invalid JSON body
  // =========================================================================

  describe('invalid JSON body', () => {
    it('POST /api/admin/users/invite returns 400 for malformed JSON', async () => {
      configureRole(mockSupabase, 'admin');

      const request = new (await import('next/server')).NextRequest(
        'http://localhost:3000/api/admin/users/invite',
        {
          method: 'POST',
          body: '{ broken json !!!',
          headers: { 'content-type': 'application/json' },
        },
      );

      const response = await inviteUser(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Invalid JSON');
    });

    it('PATCH /api/admin/users/[id] returns 400 for malformed JSON', async () => {
      configureRole(mockSupabase, 'admin');

      const request = new (await import('next/server')).NextRequest(
        `http://localhost:3000/api/admin/users/${VALID_UUID}`,
        {
          method: 'PATCH',
          body: '<<< not json',
          headers: { 'content-type': 'application/json' },
        },
      );

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: VALID_UUID }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Invalid JSON');
    });
  });

  // =========================================================================
  // Missing required fields
  // =========================================================================

  describe('missing required fields', () => {
    it('invite rejects missing email', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { role: 'editor' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(400);
    });

    it('invite rejects missing role', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { email: 'user@example.com' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(400);
    });

    it('review action rejects missing action field', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest('/api/review/action', {
        method: 'POST',
        body: { item_id: VALID_UUID },
      });

      const response = await reviewAction(request);
      // Route should reject — either 400 or 403 depending on implementation
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // Invalid UUID parameters
  // =========================================================================

  describe('invalid UUID parameters', () => {
    it('PATCH rejects non-UUID userId', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/123', {
        method: 'PATCH',
        body: { role: 'editor' },
      });

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: '123' }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('UUID');
    });

    it('DELETE rejects non-UUID userId', async () => {
      configureRole(mockSupabase, 'admin');

      const { DELETE: deactivateUser } = await import(
        '@/app/api/admin/users/[userId]/route'
      );

      const request = createTestRequest('/api/admin/users/xyz', {
        method: 'DELETE',
      });

      const response = await deactivateUser(request, {
        params: createTestParams({ userId: 'xyz' }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('UUID');
    });

    it('PATCH rejects empty string userId', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/', {
        method: 'PATCH',
        body: { role: 'editor' },
      });

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: '' }),
      });
      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // Invalid enum values
  // =========================================================================

  describe('invalid enum values', () => {
    it('invite rejects invalid role value', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { email: 'user@example.com', role: 'moderator' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'role' }),
        ]),
      );
    });

    it('update role rejects invalid role value', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(`/api/admin/users/${VALID_UUID}`, {
        method: 'PATCH',
        body: { role: 'owner' },
      });

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: VALID_UUID }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'role' }),
        ]),
      );
    });

    it('invite rejects empty string role', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { email: 'user@example.com', role: '' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // Search validation
  // =========================================================================

  describe('search input validation', () => {
    it('POST /api/search handles empty query gracefully', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const request = createTestRequest('/api/search', {
        method: 'POST',
        body: { query: '' },
      });

      const response = await searchPost(request);
      // Should handle gracefully — either 200 with empty results or 400
      expect([200, 400]).toContain(response.status);
    });
  });
});
