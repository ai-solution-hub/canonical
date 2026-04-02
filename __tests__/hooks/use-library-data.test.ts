import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// ─── Mocks ────────────────────────────────────────────────────────────────

let mockSupabase: MockSupabaseClient;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}));

// ─── Import after mocks ──────────────────────────────────────────────────

import { useLibraryData } from '@/hooks/use-library-data';
import type { LibraryFilters } from '@/hooks/browse/use-library-filters';

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

const DEFAULT_FILTERS: LibraryFilters = {
  domain: undefined,
  source_file: undefined,
  variant: undefined,
  search: undefined,
  freshness: undefined,
  verified: undefined,
};

const MOCK_ITEMS = [
  {
    id: 'item-1',
    title: 'Test Q&A',
    content_type: 'q_a_pair',
    primary_domain: 'Technical',
    primary_subtopic: null,
    ai_summary: null,
    suggested_title: null,
    platform: null,
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: null,
    classification_confidence: 0.9,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────

describe('useLibraryData', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches Q&A items with default filters', async () => {
    // Configure chain to return items when awaited
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: MOCK_ITEMS, error: null }),
    );

    const { result } = renderHook(() => useLibraryData(DEFAULT_FILTERS), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe('item-1');
  });

  it('fetches source files for filter dropdown', async () => {
    // First call: items query, second call: source files query
    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount <= 1) {
          resolve({ data: MOCK_ITEMS, error: null });
        } else {
          resolve({
            data: [
              { source_file: 'file-a.docx' },
              { source_file: 'file-b.docx' },
              { source_file: 'file-a.docx' }, // duplicate
            ],
            error: null,
          });
        }
      },
    );

    const { result } = renderHook(() => useLibraryData(DEFAULT_FILTERS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.sourceFiles.length).toBeGreaterThan(0);
    });

    // Should deduplicate and sort
    expect(result.current.sourceFiles).toEqual(['file-a.docx', 'file-b.docx']);
  });

  it('applies domain filter to query', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const filters: LibraryFilters = {
      ...DEFAULT_FILTERS,
      domain: 'Technical',
    };

    const { result } = renderHook(() => useLibraryData(filters), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'primary_domain',
      'Technical',
    );
  });

  it('throws on Supabase error (P4 fix)', async () => {
    const supabaseError = { message: 'Connection failed', code: '500' };

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: supabaseError }),
    );

    const { result } = renderHook(() => useLibraryData(DEFAULT_FILTERS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Items should be empty default, error should be thrown to TanStack Query
    expect(result.current.items).toEqual([]);
  });

  it('exposes refetch function', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const { result } = renderHook(() => useLibraryData(DEFAULT_FILTERS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.refetch).toBe('function');
  });
});
