import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from 'sonner';

const mockFetch = vi.fn();

// ─── Import after mocks ──────────────────────────────────────────────────

import { useTagsData, type TagCount } from '@/hooks/use-tags-data';

// ─── Helpers ─────────────────────────────────────────────────────────────

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

const MOCK_TAGS: TagCount[] = [
  { tag: 'compliance', count: 12, source: 'ai' },
  { tag: 'security', count: 8, source: 'ai' },
  { tag: 'manual-tag', count: 3, source: 'user' },
];

const MOCK_DUPLICATES = [
  { canonical: 'compliance', variants: ['compliant', 'compliances'] },
];

const MOCK_DOMAIN_GROUPS = [
  { domain: 'Technical', tags: ['security', 'compliance'], count: 2 },
];

function mockFetchSuccess(url: string) {
  if (url.includes('/api/tags/duplicates')) {
    return Promise.resolve({
      ok: true,
      json: async () => MOCK_DUPLICATES,
    });
  }
  if (url.includes('/api/tags/by-domain')) {
    return Promise.resolve({
      ok: true,
      json: async () => MOCK_DOMAIN_GROUPS,
    });
  }
  if (url === '/api/tags') {
    return Promise.resolve({
      ok: true,
      json: async () => MOCK_TAGS,
    });
  }
  // Fallback for mutation endpoints
  return Promise.resolve({
    ok: true,
    json: async () => ({ affected: 5 }),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('useTagsData', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockImplementation(mockFetchSuccess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads tags, duplicates, and domain groups', async () => {
    const { result } = renderHook(() => useTagsData(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tags).toEqual(MOCK_TAGS);
    expect(result.current.duplicates).toEqual(MOCK_DUPLICATES);
    expect(result.current.domainGroups).toEqual(MOCK_DOMAIN_GROUPS);
  });

  it('rename mutation calls /api/tags/rename and shows toast', async () => {
    const { result } = renderHook(() => useTagsData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.renameMutation.mutate({
        old: 'compliance',
        new: 'regulatory-compliance',
        type: 'ai',
      });
    });

    await waitFor(() => {
      expect(result.current.renameMutation.isSuccess).toBe(true);
    });

    // Verify mutationFetchJson was called (uses fetch under the hood)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tags/rename',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining(
        'Renamed "compliance" to "regulatory-compliance"',
      ),
    );
  });

  it('merge mutation calls /api/tags/merge and shows toast', async () => {
    const { result } = renderHook(() => useTagsData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.mergeMutation.mutate({
        source: 'compliant',
        target: 'compliance',
        type: 'ai',
      });
    });

    await waitFor(() => {
      expect(result.current.mergeMutation.isSuccess).toBe(true);
    });

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('Merged "compliant" into "compliance"'),
    );
  });

  it('delete mutation calls /api/tags with DELETE method', async () => {
    const { result } = renderHook(() => useTagsData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.deleteMutation.mutate({
        tag: 'manual-tag',
        type: 'user',
      });
    });

    await waitFor(() => {
      expect(result.current.deleteMutation.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tags',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('Deleted "manual-tag"'),
    );
  });

  it('shows error toast when mutation fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/tags/rename')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server error' }),
        });
      }
      return mockFetchSuccess(url);
    });

    const { result } = renderHook(() => useTagsData(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.renameMutation.mutate({
        old: 'test',
        new: 'test-new',
        type: 'ai',
      });
    });

    await waitFor(() => {
      expect(result.current.renameMutation.isError).toBe(true);
    });

    expect(toast.error).toHaveBeenCalledWith('Server error');
  });

  it('returns empty arrays while loading', () => {
    // Make fetch hang forever
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useTagsData(), {
      wrapper: createWrapper(),
    });

    expect(result.current.tags).toEqual([]);
    expect(result.current.duplicates).toEqual([]);
    expect(result.current.domainGroups).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
});
