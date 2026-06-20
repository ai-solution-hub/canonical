/**
 * useReferenceData — list/search/filter hook tests (ID-111.10).
 *
 * Behaviour-first (test-philosophy.md): we drive the REAL hook through its
 * list-mode and search-mode branches, mocking only the I/O + routing seams:
 * `@/lib/supabase/client` `createClient().rpc` (the reference_list RPC),
 * `@/lib/query/fetchers` `fetchJson` (the {111.9} search endpoint), and
 * `next/navigation` (URL <-> state). Everything in between — the offset
 * pagination, the filter -> RPC-param pushdown (B-31), the list/search mode
 * swap, and the URL writers — runs unmocked.
 *
 * The reference_list RPC is MOCKED (no live DB in vitest); the migration is
 * authored-not-applied until the Orchestrator pushes it on MAIN.
 *
 * Spec: PRODUCT.md B-12, B-13, B-15, B-16, B-17, B-19, B-20; TECH.md Seam 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRpc, mockFetchJson, mockPush, navState } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFetchJson: vi.fn(),
  mockPush: vi.fn(),
  navState: { search: '' },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: mockRpc }),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return { ...actual, fetchJson: mockFetchJson };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navState.search),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/reference',
}));

import { useReferenceData } from '@/hooks/reference/use-reference-data';
import type { ReferenceListItem } from '@/types/reference';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let idCounter = 0;
function makeRow(overrides: Partial<ReferenceListItem> = {}) {
  idCounter += 1;
  return {
    reference_id: `1111111${idCounter}-1111-4111-8111-111111111111`,
    title: `Reference ${idCounter}`,
    summary_preview: 'A short summary preview.',
    body_preview: 'A short body preview.',
    source_url: 'https://example.com/a',
    published_at: '2026-01-15T00:00:00Z',
    primary_domain: 'procurement',
    primary_subtopic: 'tendering',
    layer: 'detail',
    ingestion_source: 'url_import',
    source_document_id: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

function renderReferenceData() {
  const { Wrapper } = createQueryWrapper();
  return renderHook(() => useReferenceData(), { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  navState.search = '';
  idCounter = 0;
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockFetchJson.mockResolvedValue({ results: [] });
});

// ---------------------------------------------------------------------------
// Default list mode (B-12)
// ---------------------------------------------------------------------------

describe('useReferenceData — default list mode', () => {
  it('calls the reference_list RPC (not /api/search) with no filter params', async () => {
    mockRpc.mockResolvedValue({ data: [makeRow(), makeRow()], error: null });

    const { result } = renderReferenceData();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith(
      'reference_list',
      expect.objectContaining({ p_limit: 48, p_offset: 0 }),
    );
    // Default list does not invoke the search endpoint.
    expect(mockFetchJson).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(2);
    expect(result.current.isSearchMode).toBe(false);
  });

  it('passes NULL/undefined for every unset filter param (no client filtering)', async () => {
    mockRpc.mockResolvedValue({ data: [makeRow()], error: null });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const [, params] = mockRpc.mock.calls[0];
    expect(params.p_primary_domain).toBeUndefined();
    expect(params.p_primary_subtopic).toBeUndefined();
    expect(params.p_ingestion_source).toBeUndefined();
    expect(params.p_published_from).toBeUndefined();
    expect(params.p_published_to).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Filters as server-side RPC params (B-16, B-17, B-31)
// ---------------------------------------------------------------------------

describe('useReferenceData — filters (server-side pushdown)', () => {
  it('pushes an active domain filter into the reference_list RPC param', async () => {
    navState.search = 'domain=procurement';
    mockRpc.mockResolvedValue({ data: [makeRow()], error: null });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith(
      'reference_list',
      expect.objectContaining({ p_primary_domain: 'procurement' }),
    );
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('pushes ingestion_source + date range as RPC params and ANDs them', async () => {
    navState.search = 'source=rss_feed&from=2026-01-01&to=2026-02-01';
    mockRpc.mockResolvedValue({ data: [makeRow()], error: null });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith(
      'reference_list',
      expect.objectContaining({
        p_ingestion_source: 'rss_feed',
        p_published_from: '2026-01-01',
        p_published_to: '2026-02-01',
      }),
    );
    // domain + date range absent; source + range = 2 active filter slots.
    expect(result.current.activeFilterCount).toBe(2);
  });

  it('writes a filter change to the URL (B-15/B-17 reflected in URL)', async () => {
    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setFilters({ primary_domain: 'legal' });
    });

    expect(mockPush).toHaveBeenCalledWith('/reference?domain=legal');
  });

  it('clears the dependent subtopic when the domain filter is cleared', async () => {
    navState.search = 'domain=procurement&subtopic=tendering';
    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setFilters({ primary_domain: undefined });
    });

    expect(mockPush).toHaveBeenCalledWith('/reference');
  });
});

// ---------------------------------------------------------------------------
// Search mode (B-13, B-14, B-23) + clearing (B-15)
// ---------------------------------------------------------------------------

describe('useReferenceData — search mode', () => {
  it('swaps to the {111.9} reference endpoint (NOT reference_list, NOT /api/search)', async () => {
    navState.search = 'q=procurement+reform';
    mockFetchJson.mockResolvedValue({
      results: [makeRow({ embedding_score: 0.8, fulltext_score: 0.4 })],
    });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isSearchMode).toBe(true);
    expect(mockFetchJson).toHaveBeenCalledWith(
      '/api/search/reference',
      expect.objectContaining({ method: 'POST' }),
    );
    // The default-list RPC is NOT called in search mode.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].embedding_score).toBe(0.8);
  });

  it('returns the search query in the URL via setSearchQuery', async () => {
    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSearchQuery('vat thresholds');
    });

    expect(mockPush).toHaveBeenCalledWith('/reference?q=vat+thresholds');
  });

  it('clearing the search restores the default list (drops ?q=)', async () => {
    navState.search = 'q=procurement';
    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSearchQuery(undefined);
    });

    // Empty params -> bare pathname (default list).
    expect(mockPush).toHaveBeenCalledWith('/reference');
  });
});

// ---------------------------------------------------------------------------
// Error vs empty (B-18 vs B-20)
// ---------------------------------------------------------------------------

describe('useReferenceData — error is distinct from empty', () => {
  it('surfaces an RPC error (not a silent empty list) in list mode', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('connection refused'),
    });

    const { result } = renderReferenceData();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/connection refused/);
    expect(result.current.items).toHaveLength(0);
  });

  it('surfaces a search endpoint failure as an error in search mode', async () => {
    navState.search = 'q=boom';
    mockFetchJson.mockRejectedValue(new Error('Reference search query failed'));

    const { result } = renderReferenceData();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/failed/i);
  });

  it('an empty default list is NOT an error (corpus-empty, B-18)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pagination (B-19): offset advances by page; short page ends pagination
// ---------------------------------------------------------------------------

describe('useReferenceData — pagination', () => {
  it('exposes hasMore only when the first page is full (48 rows)', async () => {
    const fullPage = Array.from({ length: 48 }, () => makeRow());
    mockRpc.mockResolvedValue({ data: fullPage, error: null });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasMore).toBe(true);
  });

  it('does not offer more when the first page is short', async () => {
    mockRpc.mockResolvedValue({ data: [makeRow(), makeRow()], error: null });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasMore).toBe(false);
  });

  it('loadMore advances the offset to fetch the next page', async () => {
    const fullPage = Array.from({ length: 48 }, () => makeRow());
    mockRpc
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: [makeRow()], error: null });

    const { result } = renderReferenceData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(49));
    // The second call advances p_offset by the first page length.
    expect(mockRpc).toHaveBeenLastCalledWith(
      'reference_list',
      expect.objectContaining({ p_offset: 48 }),
    );
  });
});
