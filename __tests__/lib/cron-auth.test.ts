import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// WP2 (S19): lib/cron-auth.ts now routes failure logs through @/lib/logger
// (logger.error) instead of console.error.
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

import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';

describe('verifyCronAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    loggerMocks.error.mockClear();
    loggerMocks.warn.mockClear();
    loggerMocks.info.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true when header matches CRON_SECRET', () => {
    process.env.CRON_SECRET = 'test-secret-123';
    const request = new Request('http://localhost/api/cron/test', {
      headers: { authorization: 'Bearer test-secret-123' },
    });
    expect(verifyCronAuth(request)).toBe(true);
  });

  it('returns false when header does not match', () => {
    process.env.CRON_SECRET = 'test-secret-123';
    const request = new Request('http://localhost/api/cron/test', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(verifyCronAuth(request)).toBe(false);
  });

  it('returns false when no authorization header is provided', () => {
    process.env.CRON_SECRET = 'test-secret-123';
    const request = new Request('http://localhost/api/cron/test');
    expect(verifyCronAuth(request)).toBe(false);
  });

  it('returns false when CRON_SECRET is not set', () => {
    delete process.env.CRON_SECRET;
    const request = new Request('http://localhost/api/cron/test', {
      headers: { authorization: 'Bearer anything' },
    });
    expect(verifyCronAuth(request)).toBe(false);
    // logger.error is invoked with a single string argument (no context object).
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'CRON_SECRET environment variable not set',
    );
  });

  it('requires exact Bearer prefix match', () => {
    process.env.CRON_SECRET = 'test-secret-123';
    const request = new Request('http://localhost/api/cron/test', {
      headers: { authorization: 'Basic test-secret-123' },
    });
    expect(verifyCronAuth(request)).toBe(false);
  });
});

describe('getUsersByRole', () => {
  it('returns user IDs for matching roles', async () => {
    const mockData = [{ user_id: 'user-1' }, { user_id: 'user-2' }];
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        }),
      }),
    };

    const result = await getUsersByRole(mockSupabase as never, [
      'admin',
      'editor',
    ]);
    expect(result).toEqual(['user-1', 'user-2']);
    expect(mockSupabase.from).toHaveBeenCalledWith('user_roles');
  });

  it('returns empty array on error', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'fail' } }),
        }),
      }),
    };

    const result = await getUsersByRole(mockSupabase as never, ['admin']);
    expect(result).toEqual([]);
    // logger.error is invoked with the structured `{ err }` shape.
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: { message: 'fail' } }),
      'Failed to fetch users by role',
    );
  });

  it('returns empty array when data is null', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    };

    const result = await getUsersByRole(mockSupabase as never, ['admin']);
    expect(result).toEqual([]);
  });
});
