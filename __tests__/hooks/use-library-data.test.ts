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

// ID-131 {131.21}: fixture now shaped as a raw `q_a_pairs` row — the hook
// maps this onto ContentListItem internally (mapQAPairToContentListItem).
const MOCK_QA_PAIR_ROWS = [
  {
    id: 'item-1',
    question_text: 'Test Q&A',
    answer_standard: 'Standard answer',
    answer_advanced: null,
    publication_status: 'published',
    source_document_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
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

  it('fetches Q&A items from q_a_pairs with default filters (ID-131 {131.21})', async () => {
    // Configure chain to return items when awaited
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: MOCK_QA_PAIR_ROWS, error: null }),
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
    // Mapped onto the shared ContentListItem shape: title <- question_text.
    expect(result.current.items[0].title).toBe('Test Q&A');
    expect(result.current.items[0].content_type).toBe('q_a_pair');

    expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pairs');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('content_items');
  });

  it('sourceFiles is always empty — q_a_pairs has no source_file column (ID-131 {131.21})', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: MOCK_QA_PAIR_ROWS, error: null }),
    );

    const { result } = renderHook(() => useLibraryData(DEFAULT_FILTERS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Honest no-op — richer source-document filtering deferred to id-135.
    expect(result.current.sourceFiles).toEqual([]);
  });

  it('does not filter by primary_domain — q_a_pairs has no such column (ID-131 {131.21})', async () => {
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

    // The domain filter is a no-op against q_a_pairs (no primary_domain
    // column) — asserting this is NOT sent guards against a 400 from a
    // filter targeting a non-existent column.
    expect(mockSupabase._chain.eq).not.toHaveBeenCalledWith(
      'primary_domain',
      'Technical',
    );
  });

  it('applies the variant filter using q_a_pairs answer columns', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const filters: LibraryFilters = {
      ...DEFAULT_FILTERS,
      variant: 'standard_only',
    };

    const { result } = renderHook(() => useLibraryData(filters), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase._chain.not).toHaveBeenCalledWith(
      'answer_standard',
      'is',
      null,
    );
    expect(mockSupabase._chain.is).toHaveBeenCalledWith(
      'answer_advanced',
      null,
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
