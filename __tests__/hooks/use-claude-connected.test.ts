/**
 * useClaudeConnected Hook Tests (TanStack Query migration)
 *
 * Tests the useClaudeConnected hook — OAuth grant detection for Claude
 * connectivity status.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;

import { useClaudeConnected } from '@/hooks/use-claude-connected';

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

describe('useClaudeConnected', () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null while loading', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useClaudeConnected(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeNull();
  });

  it('returns true when Claude grant exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        grants: [{ client: { name: 'Claude Desktop' } }],
      }),
    });

    const { result } = renderHook(() => useClaudeConnected(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('returns true when Knowledge Hub grant exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        grants: [{ client: { name: 'Knowledge Hub MCP' } }],
      }),
    });

    const { result } = renderHook(() => useClaudeConnected(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('returns false when no matching grants', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        grants: [{ client: { name: 'Some other app' } }],
      }),
    });

    const { result } = renderHook(() => useClaudeConnected(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('returns false when grants array is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ grants: [] }),
    });

    const { result } = renderHook(() => useClaudeConnected(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('returns false on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useClaudeConnected(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('returns false on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorised' }),
    });

    const { result } = renderHook(() => useClaudeConnected(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });
});
