/**
 * Admin API route tests.
 *
 * Tests the admin user management endpoints:
 *   - GET  /api/admin/users         — list all users with roles
 *   - POST /api/admin/users/invite  — invite a new user
 *   - PATCH /api/admin/users/[id]   — update a user's role
 *   - DELETE /api/admin/users/[id]  — deactivate a user
 *
 * Auth enforcement for these routes is tested in auth.test.ts.
 * These tests focus on business logic, validation, and error handling.
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
mockSupabase.auth.admin.inviteUserByEmail = vi
  .fn()
  .mockResolvedValue({ data: { user: null }, error: null });

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

import { GET as listUsers } from '@/app/api/admin/users/route';
import { POST as inviteUser } from '@/app/api/admin/users/invite/route';
import {
  PATCH as updateUserRole,
  DELETE as deactivateUser,
} from '@/app/api/admin/users/[userId]/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_USER_UUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

function resetMocks() {
  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'admin-user-id', email: 'admin@example.com' } },
    error: null,
  });

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });

  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // Re-establish chainable returns
  const chain = mockSupabase._chain;
  const chainableMethods: (keyof typeof chain)[] = [
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
  ];
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }
  mockSupabase.from.mockReturnValue(chain);

  // Reset admin auth methods
  mockSupabase.auth.admin.listUsers.mockReset();
  mockSupabase.auth.admin.listUsers.mockResolvedValue({
    data: { users: [] },
    error: null,
  });
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin API routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // GET /api/admin/users — list all users
  // =========================================================================

  describe('GET /api/admin/users', () => {
    it('returns user list with roles for admin', async () => {
      configureRole(mockSupabase, 'admin');

      // WP-G3.4 Batch 2: bulk read goes through user_profiles + user_roles
      // (two sequential .from().select() calls). Mock the .then() resolver
      // in order: first call → user_profiles, second call → user_roles.
      mockSupabase._chain.then
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                id: 'user-1',
                email: 'alice@example.com',
                full_name: 'Alice',
                created_at: '2026-01-01T00:00:00Z',
              },
              {
                id: 'user-2',
                email: 'bob@example.com',
                full_name: null,
                created_at: '2026-02-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [
              { user_id: 'user-1', role: 'editor' },
              { user_id: 'user-2', role: 'viewer' },
            ],
            error: null,
          }),
        );

      // last_sign_in_at still comes from the residual auth.admin.listUsers()
      // call retained for the one column not in the v1 mirror (D-G3.4-7).
      mockSupabase.auth.admin.listUsers.mockResolvedValueOnce({
        data: {
          users: [
            {
              id: 'user-1',
              email: 'alice@example.com',
              last_sign_in_at: '2026-03-01T10:00:00Z',
            },
            {
              id: 'user-2',
              email: 'bob@example.com',
              last_sign_in_at: null,
            },
          ],
        },
        error: null,
      });

      const response = await listUsers();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveLength(2);
      expect(body[0]).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        display_name: 'Alice',
        role: 'editor',
        created_at: '2026-01-01T00:00:00Z',
        last_sign_in_at: '2026-03-01T10:00:00Z',
      });
      expect(body[1].display_name).toBeNull();
      expect(body[1].role).toBe('viewer');
    });

    it('defaults role to viewer when user_roles entry is missing', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.then
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                id: 'user-no-role',
                email: 'norole@example.com',
                full_name: null,
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );

      mockSupabase.auth.admin.listUsers.mockResolvedValueOnce({
        data: { users: [] },
        error: null,
      });

      const response = await listUsers();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body[0].role).toBe('viewer');
    });

    it('returns 500 when user_profiles read fails', async () => {
      configureRole(mockSupabase, 'admin');

      // First .from().select() — user_profiles — fails.
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: null,
            error: { message: 'permission denied' },
          }),
      );

      const response = await listUsers();
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe('Failed to list users');
    });

    it('returns 500 when user_roles read fails', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.then
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                id: 'user-1',
                email: 'alice@example.com',
                full_name: 'Alice',
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'permission denied' } }),
        );

      const response = await listUsers();
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe('Failed to fetch user roles');
    });

    it('degrades last_sign_in_at to NULL when listUsers fails (S156 soft-fallback)', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.then
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                id: 'user-1',
                email: 'alice@example.com',
                full_name: 'Alice',
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [{ user_id: 'user-1', role: 'editor' }],
            error: null,
          }),
        );

      // Simulate S156-class GoTrue corruption.
      mockSupabase.auth.admin.listUsers.mockResolvedValueOnce({
        data: { users: [] },
        error: { message: 'Service unavailable' },
      });

      const response = await listUsers();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveLength(1);
      expect(body[0].last_sign_in_at).toBeNull();
      // Load-bearing assertion: bulk read still succeeds even when GoTrue
      // is degraded. The S156 incident proved this is the right contract.
      expect(body[0].id).toBe('user-1');
      expect(body[0].role).toBe('editor');
    });

    it('returns null (never empty string) for last_sign_in_at when the user has never signed in (WP-S8i)', async () => {
      // Widened contract: `last_sign_in_at` MUST be `string | null` —
      // never `''` or `undefined`. The team-section UI distinguishes
      // "Never" (null) from a real timestamp; an empty-string would
      // parse to Invalid Date and render as the string "Invalid Date".
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.then
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [
              {
                id: 'never-signed-in',
                email: 'newbie@example.com',
                full_name: 'Newbie',
                created_at: '2026-04-01T00:00:00Z',
              },
              {
                id: 'missing-from-auth',
                email: 'ghost@example.com',
                full_name: null,
                created_at: '2026-04-02T00:00:00Z',
              },
              {
                id: 'has-signed-in',
                email: 'returning@example.com',
                full_name: 'Returning',
                created_at: '2026-04-03T00:00:00Z',
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce((resolve: (v: unknown) => void) =>
          resolve({
            data: [
              { user_id: 'never-signed-in', role: 'viewer' },
              { user_id: 'missing-from-auth', role: 'viewer' },
              { user_id: 'has-signed-in', role: 'editor' },
            ],
            error: null,
          }),
        );

      mockSupabase.auth.admin.listUsers.mockResolvedValueOnce({
        data: {
          users: [
            // Has signed in: real ISO timestamp.
            {
              id: 'has-signed-in',
              email: 'returning@example.com',
              last_sign_in_at: '2026-04-15T12:00:00Z',
            },
            // Has never signed in: GoTrue surfaces null.
            {
              id: 'never-signed-in',
              email: 'newbie@example.com',
              last_sign_in_at: null,
            },
            // 'missing-from-auth' deliberately absent — Map.get() returns
            // undefined, must be coerced to null in the response.
          ],
        },
        error: null,
      });

      const response = await listUsers();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveLength(3);

      const byId = new Map(
        body.map((u: { id: string; last_sign_in_at: string | null }) => [
          u.id,
          u.last_sign_in_at,
        ]),
      );

      // Real timestamp passes through verbatim.
      expect(byId.get('has-signed-in')).toBe('2026-04-15T12:00:00Z');
      // Never-signed-in user: null, NOT empty string.
      expect(byId.get('never-signed-in')).toBeNull();
      expect(byId.get('never-signed-in')).not.toBe('');
      // Missing from auth response (unmatched profile): also null, not undefined.
      expect(byId.get('missing-from-auth')).toBeNull();
      expect(byId.get('missing-from-auth')).not.toBe('');
      expect(byId.get('missing-from-auth')).not.toBeUndefined();
    });
  });

  // =========================================================================
  // POST /api/admin/users/invite — invite a new user
  // =========================================================================

  describe('POST /api/admin/users/invite', () => {
    it('invites a user with valid email and role', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValueOnce({
        data: {
          user: {
            id: TARGET_USER_UUID,
            email: 'newuser@example.com',
          },
        },
        error: null,
      });

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: {
          email: 'newuser@example.com',
          role: 'editor',
          display_name: 'New User',
        },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body).toEqual({
        id: TARGET_USER_UUID,
        email: 'newuser@example.com',
        role: 'editor',
        display_name: 'New User',
      });
    });

    it('returns 400 for missing email', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { role: 'editor' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
      );
    });

    it('returns 400 for invalid email format', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { email: 'not-an-email', role: 'editor' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: 'A valid email address is required',
          }),
        ]),
      );
    });

    it('returns 400 for invalid role', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { email: 'user@example.com', role: 'superadmin' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'role' })]),
      );
    });

    it('returns 409 for duplicate user', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValueOnce({
        data: { user: null },
        error: {
          message: 'A user with this email address has already been registered',
        },
      });

      const request = createTestRequest('/api/admin/users/invite', {
        method: 'POST',
        body: { email: 'existing@example.com', role: 'editor' },
      });

      const response = await inviteUser(request);
      expect(response.status).toBe(409);

      const body = await response.json();
      expect(body.error).toContain('already exists');
    });

    it('returns 400 for invalid JSON body', async () => {
      configureRole(mockSupabase, 'admin');

      const request = new (await import('next/server')).NextRequest(
        'http://localhost:3000/api/admin/users/invite',
        {
          method: 'POST',
          body: 'not valid json{{{',
          headers: { 'content-type': 'application/json' },
        },
      );

      const response = await inviteUser(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Invalid JSON');
    });
  });

  // =========================================================================
  // PATCH /api/admin/users/[userId] — update user role
  // =========================================================================

  describe('PATCH /api/admin/users/[userId]', () => {
    it('updates role for valid UUID and role', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(
        `/api/admin/users/${TARGET_USER_UUID}`,
        {
          method: 'PATCH',
          body: { role: 'editor' },
        },
      );

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: TARGET_USER_UUID }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual({ id: TARGET_USER_UUID, role: 'editor' });
    });

    it('returns 400 for invalid UUID', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/not-a-uuid', {
        method: 'PATCH',
        body: { role: 'editor' },
      });

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: 'not-a-uuid' }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('UUID');
    });

    it('returns 400 for invalid role value', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(
        `/api/admin/users/${TARGET_USER_UUID}`,
        {
          method: 'PATCH',
          body: { role: 'superadmin' },
        },
      );

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: TARGET_USER_UUID }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'role' })]),
      );
    });

    it('returns 500 when upsert fails', async () => {
      configureRole(mockSupabase, 'admin');

      // Make the upsert (via chain) fail
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'DB error' } }),
      );

      const request = createTestRequest(
        `/api/admin/users/${TARGET_USER_UUID}`,
        {
          method: 'PATCH',
          body: { role: 'editor' },
        },
      );

      const response = await updateUserRole(request, {
        params: createTestParams({ userId: TARGET_USER_UUID }),
      });
      expect(response.status).toBe(500);
    });
  });

  // =========================================================================
  // DELETE /api/admin/users/[userId] — deactivate user
  // =========================================================================

  describe('DELETE /api/admin/users/[userId]', () => {
    it('deactivates a user by banning them', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.auth.admin.updateUserById.mockResolvedValueOnce({
        data: { user: { id: TARGET_USER_UUID } },
        error: null,
      });

      const request = createTestRequest(
        `/api/admin/users/${TARGET_USER_UUID}`,
        {
          method: 'DELETE',
        },
      );

      const response = await deactivateUser(request, {
        params: createTestParams({ userId: TARGET_USER_UUID }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);

      // Verify ban_duration was passed
      expect(mockSupabase.auth.admin.updateUserById).toHaveBeenCalledWith(
        TARGET_USER_UUID,
        { ban_duration: '876000h' },
      );
    });

    it('returns 400 when admin tries to deactivate themselves', async () => {
      // Use a valid UUID that matches the authenticated user ID
      const adminUuid = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f';
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: adminUuid, email: 'admin@example.com' } },
        error: null,
      });
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(`/api/admin/users/${adminUuid}`, {
        method: 'DELETE',
      });

      const response = await deactivateUser(request, {
        params: createTestParams({ userId: adminUuid }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('cannot deactivate your own');
    });

    it('returns 400 for invalid UUID', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/admin/users/bad-id', {
        method: 'DELETE',
      });

      const response = await deactivateUser(request, {
        params: createTestParams({ userId: 'bad-id' }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('UUID');
    });

    it('returns 500 when ban fails', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.auth.admin.updateUserById.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Service error' },
      });

      const request = createTestRequest(
        `/api/admin/users/${TARGET_USER_UUID}`,
        {
          method: 'DELETE',
        },
      );

      const response = await deactivateUser(request, {
        params: createTestParams({ userId: TARGET_USER_UUID }),
      });
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe('Failed to deactivate user');
    });
  });
});
