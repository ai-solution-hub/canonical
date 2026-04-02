/**
 * useUserRole Hook Tests (TanStack Query migration)
 *
 * Tests the useUserRole hook — loading state, role resolution from Supabase,
 * unauthenticated state, and canEdit/canAdmin derivation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock Supabase client used inside useUserRole
// ---------------------------------------------------------------------------

const { mockAuth, mockChain, mockFrom } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'single'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    mockAuth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      }),
    },
    mockChain: chain,
    mockFrom: vi.fn().mockReturnValue(chain),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: mockAuth,
    from: mockFrom,
  }),
}));

import { useUserRole } from '@/hooks/use-user-role';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useUserRole', () => {
  beforeEach(() => {
    // Reset to authenticated user
    mockAuth.getUser.mockReset();
    mockAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });

    // Reset chain
    mockChain.select.mockReturnValue(mockChain);
    mockChain.eq.mockReturnValue(mockChain);
    mockChain.single.mockReset();
    mockChain.single.mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue(mockChain);
  });

  it('returns loading state initially', () => {
    // Make the auth call hang to keep loading
    mockAuth.getUser.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useUserRole(), {
      wrapper: createWrapper(),
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.role).toBeNull();
  });

  it('returns admin role after auth resolves', async () => {
    mockChain.single.mockResolvedValue({
      data: { role: 'admin' },
      error: null,
    });

    const { result } = renderHook(() => useUserRole(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBe('admin');
    expect(result.current.canAdmin).toBe(true);
    expect(result.current.canEdit).toBe(true);
  });

  it('returns editor role with canEdit true and canAdmin false', async () => {
    mockChain.single.mockResolvedValue({
      data: { role: 'editor' },
      error: null,
    });

    const { result } = renderHook(() => useUserRole(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBe('editor');
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canAdmin).toBe(false);
  });

  it('returns viewer role with canEdit and canAdmin both false', async () => {
    mockChain.single.mockResolvedValue({
      data: { role: 'viewer' },
      error: null,
    });

    const { result } = renderHook(() => useUserRole(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBe('viewer');
    expect(result.current.canEdit).toBe(false);
    expect(result.current.canAdmin).toBe(false);
  });

  it('defaults to viewer when no role row exists', async () => {
    mockChain.single.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useUserRole(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBe('viewer');
    expect(result.current.canEdit).toBe(false);
    expect(result.current.canAdmin).toBe(false);
  });

  it('returns null role when not authenticated', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'No session' },
    });

    const { result } = renderHook(() => useUserRole(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBeNull();
    expect(result.current.canEdit).toBe(false);
    expect(result.current.canAdmin).toBe(false);
  });
});
