import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';

describe('verifyCronAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
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
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('http://localhost/api/cron/test', {
      headers: { authorization: 'Bearer anything' },
    });
    expect(verifyCronAuth(request)).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      'CRON_SECRET environment variable not set',
    );
    consoleSpy.mockRestore();
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

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getUsersByRole(mockSupabase as never, ['admin']);
    expect(result).toEqual([]);
    consoleSpy.mockRestore();
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
