/**
 * Unit tests for lib/auth.ts helpers.
 *
 * Focused on the discriminated-union return shapes for
 * `getAuthenticatedClient` and `getAuthorisedClient`. Route-level integration
 * tests live in `__tests__/api/auth.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
  configureAuthServiceError,
  configureRole,
} from '../helpers/mock-supabase';

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

import { getAuthenticatedClient, getAuthorisedClient } from '@/lib/auth';

describe('lib/auth helpers', () => {
  beforeEach(() => {
    mockSupabase.auth.getUser.mockReset();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
    mockSupabase._chain.single.mockReset();
    mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  });

  describe('getAuthenticatedClient', () => {
    it('returns success when supabase.auth.getUser returns a user', async () => {
      const result = await getAuthenticatedClient();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.id).toBe('test-user-id');
        expect(result.supabase).toBeDefined();
      }
    });

    it('returns reason=unauthenticated when AuthSessionMissingError', async () => {
      configureUnauthenticated(mockSupabase);
      const result = await getAuthenticatedClient();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('unauthenticated');
      }
    });

    it('returns reason=auth_service_failed on a real auth-service error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      configureAuthServiceError(mockSupabase);
      const result = await getAuthenticatedClient();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('auth_service_failed');
      }
      // Underlying error must be logged so ops can debug
      expect(consoleSpy).toHaveBeenCalledWith(
        '[auth] supabase.auth.getUser() failed:',
        expect.objectContaining({ name: 'AuthApiError' }),
      );
      consoleSpy.mockRestore();
    });

    it('returns reason=unauthenticated when user is null with no error', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });
      const result = await getAuthenticatedClient();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('unauthenticated');
      }
    });
  });

  describe('getAuthorisedClient', () => {
    it('inherits auth_service_failed from getAuthenticatedClient', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      configureAuthServiceError(mockSupabase);
      const result = await getAuthorisedClient(['admin']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('auth_service_failed');
      }
    });

    it('returns success with role on happy path', async () => {
      configureRole(mockSupabase, 'admin');
      const result = await getAuthorisedClient(['admin']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.role).toBe('admin');
      }
    });
  });
});
