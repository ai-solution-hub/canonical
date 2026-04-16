/**
 * useAccountAge Hook Tests
 *
 * Verifies the account-age gate used by `/digest` auto-generation (P0-11).
 * Fresh accounts (< 24h since `auth.users.created_at`) must resolve with
 * `isOver24h === false`; older accounts must resolve with `isOver24h ===
 * true`. `Date.now()` is pinned per CLAUDE.md guidance on date-sensitive
 * tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

import { useAccountAge } from '@/hooks/use-account-age';

// Fixed anchor for `Date.now()` — any timestamp will do; the hook only cares
// about the delta between `Date.now()` and `created_at`.
const NOW_MS = new Date('2026-04-15T12:00:00Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

describe('useAccountAge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isOver24h=false for an account created 10 hours ago', async () => {
    const createdAt = new Date(NOW_MS - 10 * HOUR_MS).toISOString();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', created_at: createdAt } },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAccountAge(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hours).toBeCloseTo(10, 5);
    expect(result.current.isOver24h).toBe(false);
  });

  it('returns isOver24h=true for an account created 48 hours ago', async () => {
    const createdAt = new Date(NOW_MS - 48 * HOUR_MS).toISOString();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-2', created_at: createdAt } },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAccountAge(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hours).toBeCloseTo(48, 5);
    expect(result.current.isOver24h).toBe(true);
  });

  it('returns isOver24h=true exactly at the 24h boundary', async () => {
    const createdAt = new Date(NOW_MS - 24 * HOUR_MS).toISOString();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-3', created_at: createdAt } },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAccountAge(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isOver24h).toBe(true);
  });

  it('returns hours=null and isOver24h=false when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAccountAge(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hours).toBeNull();
    expect(result.current.isOver24h).toBe(false);
  });
});
