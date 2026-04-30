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

// WP2 (S19): lib/auth.ts now routes auth-service-error logs through
// @/lib/logger (logger.error) instead of console.error. Mock the server
// logger surface so we can assert the structured `{ err }` shape directly.
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

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
    loggerMocks.error.mockClear();
    loggerMocks.warn.mockClear();
    loggerMocks.info.mockClear();
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
      configureAuthServiceError(mockSupabase);
      const result = await getAuthenticatedClient();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('auth_service_failed');
      }
      // Underlying error must be logged so ops can debug. Assert the
      // structured `{ err }` shape so the AuthApiError is captured.
      expect(loggerMocks.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ name: 'AuthApiError' }),
        }),
        '[auth] supabase.auth.getUser() failed',
      );
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
