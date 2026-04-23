/**
 * usePrimaryFocus Hook Tests
 *
 * Verifies the P0-4 Phase 2 client hook contract (spec section 5.1).
 * Reads `user_metadata.primary_focus` from Supabase Auth and returns
 * a typed PrimaryFocus value or null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { usePrimaryFocus } from '@/hooks/use-primary-focus';

describe('usePrimaryFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stored bid_writing value', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          user_metadata: { primary_focus: 'bid_writing' },
        },
      },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.primaryFocus).toBe('bid_writing');
  });

  it('returns stored account_management value', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-2',
          user_metadata: { primary_focus: 'account_management' },
        },
      },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.primaryFocus).toBe('account_management');
  });

  it('returns stored marketing value', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-3',
          user_metadata: { primary_focus: 'marketing' },
        },
      },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.primaryFocus).toBe('marketing');
  });

  it('returns null when primary_focus is not set in user_metadata', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-4',
          user_metadata: {},
        },
      },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.primaryFocus).toBeNull();
  });

  it('returns null when user_metadata is undefined', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-5',
        },
      },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.primaryFocus).toBeNull();
  });

  it('returns null for invalid primary_focus values', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-6',
          user_metadata: { primary_focus: 'invalid_value' },
        },
      },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.primaryFocus).toBeNull();
  });

  it('returns null when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.primaryFocus).toBeNull();
  });

  it('returns isLoading true before auth data resolves', () => {
    // Never-resolving promise keeps loading state active
    mockGetUser.mockReturnValue(new Promise(() => {}));

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePrimaryFocus(), {
      wrapper: Wrapper,
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.primaryFocus).toBeNull();
  });
});
