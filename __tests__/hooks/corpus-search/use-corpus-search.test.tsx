/**
 * useCorpusSearch — polymorphic multi-grain search hook tests (ID-135 {135.6},
 * read-boundary rewrite ID-144 {144.7}).
 *
 * Behaviour-first (test-philosophy.md): drives the REAL hook, mocking only the
 * I/O + routing seams: `@/lib/query/fetchers` `fetchJson` (the {131.11}
 * `/api/search` endpoint — MOCKED per the {135.6} brief; the live typed
 * response is a Task-level dependency on {131.11}/{131.19}, never hit here)
 * and `next/navigation` (URL <-> state). The mapping layer (read boundary),
 * the limit-raising pagination (AAT-1 fallback), and the URL writers all run
 * unmocked. The kind-narrow is no longer client-filtered as of id-144 — the
 * server (`hybrid_search` `filter_kind`) narrows authoritatively (TECH §2.3/2.4).
 *
 * `makeRow` fixtures conform to the verified `hybrid_search` RPC row shape
 * (`supabase/migrations/20260710221255_id144_hybrid_search_projection_filters.sql`,
 * 24 columns) — the closest available fixture for "the ACTUAL /api/search
 * emit" per AAT-2.
 *
 * Spec: TECH §3 BI-9/BI-10/BI-11/BI-15/BI-17/BI-20, §5; PRODUCT.md BI-9…BI-20;
 * id-144 TECH §2.3 (owner_kind routing + scope_tag/source_url mapping).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetchJson, mockPush, navState } = vi.hoisted(() => ({
  mockFetchJson: vi.fn(),
  mockPush: vi.fn(),
  navState: { search: '' },
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
  usePathname: () => '/search',
}));

import { useCorpusSearch } from '@/hooks/corpus-search/use-corpus-search';

// ---------------------------------------------------------------------------
// Factories — shaped as the verified hybrid_search RPC row (raw wire shape).
// ---------------------------------------------------------------------------

let idCounter = 0;
function makeRow(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `1111111${idCounter}-1111-4111-8111-111111111111`,
    title: `Result ${idCounter}`,
    suggested_title: null,
    summary: 'A short summary or answer preview.',
    primary_domain: 'procurement',
    primary_subtopic: 'tendering',
    content_type: 'q_a_pair',
    similarity: 0.87,
    // id-144 {144.7}: owner_kind is now the routing key (resolveCorpusKind
    // reads this, never content_type) — default matches the default
    // content_type above so callers that only vary other fields keep the
    // same grain. scope_tag/source_url default to the real RPC NULL for the
    // q_a_pair/document arms; tests that need a populated value override it.
    owner_kind: 'q_a_pair',
    scope_tag: null,
    source_url: null,
    ...overrides,
  };
}

function requestBody(callIndex = 0): Record<string, unknown> {
  const call = mockFetchJson.mock.calls[callIndex];
  return JSON.parse((call[1] as RequestInit).body as string);
}

function renderCorpusSearch() {
  const { Wrapper } = createQueryWrapper();
  return renderHook(() => useCorpusSearch(), { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  navState.search = '';
  idCounter = 0;
  mockFetchJson.mockResolvedValue({ results: [] });
});

// ---------------------------------------------------------------------------
// No-query gate (BI-8 is the caller's concern; the hook simply doesn't fetch)
// ---------------------------------------------------------------------------

describe('useCorpusSearch — no query', () => {
  it('does not call /api/search when ?q is absent', () => {
    const { result } = renderCorpusSearch();

    expect(mockFetchJson).not.toHaveBeenCalled();
    expect(result.current.hasQuery).toBe(false);
    expect(result.current.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Default ALL-grain search + the mapping layer (BI-10, BI-3, BI-14, AAT-2)
// ---------------------------------------------------------------------------

describe('useCorpusSearch — default ALL-grain search', () => {
  it('POSTs /api/search with no kind narrow by default', async () => {
    navState.search = 'q=procurement+reform';
    mockFetchJson.mockResolvedValue({ results: [makeRow()] });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchJson).toHaveBeenCalledWith(
      '/api/search',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody().query).toBe('procurement reform');
    expect(requestBody().kind).toBeUndefined();
  });

  it('maps a q_a_pair row to the answer variant (no score field, BI-3)', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          content_type: 'q_a_pair',
          owner_kind: 'q_a_pair',
          title: 'What is the VAT threshold?',
          summary: 'The VAT threshold is £90,000.',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    const item = result.current.items[0];
    expect(item.kind).toBe('answer');
    expect(item.title).toBe('What is the VAT threshold?');
    if (item.kind === 'answer') {
      expect(item.answerSnippet).toBe('The VAT threshold is £90,000.');
      expect(item.scopeTags).toEqual([]);
    }
    expect(item).not.toHaveProperty('similarity');
    expect(item).not.toHaveProperty('score');
  });

  it('surfaces a populated scope_tag onto the answer variant (id-144, no longer defaulted to [])', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          content_type: 'q_a_pair',
          owner_kind: 'q_a_pair',
          scope_tag: ['england', 'wales'],
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = result.current.items[0];
    expect(item.kind).toBe('answer');
    if (item.kind === 'answer') {
      expect(item.scopeTags).toEqual(['england', 'wales']);
    }
  });

  it('maps a reference_item row to the reference variant', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          content_type: 'reference_item',
          owner_kind: 'reference_item',
          title: 'GOV.UK guidance',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items[0].kind).toBe('reference');
    expect(result.current.items[0].title).toBe('GOV.UK guidance');
  });

  it('surfaces a populated source_url onto the reference variant (id-144, no longer defaulted to null)', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          content_type: 'reference_item',
          owner_kind: 'reference_item',
          source_url: 'https://www.gov.uk/guidance/procurement',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = result.current.items[0];
    expect(item.kind).toBe('reference');
    if (item.kind === 'reference') {
      expect(item.sourceUrl).toBe('https://www.gov.uk/guidance/procurement');
    }
  });

  it("maps a source_document owner_kind row to document, preferring suggested_title (content_type carries the SD's own taxonomy value)", async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          content_type: 'guidance', // sd.content_type taxonomy value — decorative only, NOT read for routing
          owner_kind: 'source_document',
          title: 'raw-filename.pdf',
          suggested_title: 'Procurement Guidance 2026',
          summary: 'Guidance summary text.',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = result.current.items[0];
    expect(item.kind).toBe('document');
    expect(item.title).toBe('Procurement Guidance 2026');
    if (item.kind === 'document') {
      expect(item.summary).toBe('Guidance summary text.');
    }
  });

  it('maps a content_chunk owner_kind row (collapsed grain) to document, never its own kind (BI-12)', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({ content_type: 'content_chunk', owner_kind: 'content_chunk' }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items[0].kind).toBe('document');
  });

  it('routes on owner_kind rather than content_type (id-144 §2.3 — owner_kind is now the honest routing key)', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          // Decoy: content_type looks like a reference_item hit, but
          // owner_kind (the real routing column since id-144) says
          // source_document — the mapping MUST follow owner_kind.
          content_type: 'reference_item',
          owner_kind: 'source_document',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items[0].kind).toBe('document');
  });

  it('preserves server-returned order (no client-side ranking, BI-11)', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          content_type: 'reference_item',
          owner_kind: 'reference_item',
          title: 'Third',
        }),
        makeRow({
          content_type: 'q_a_pair',
          owner_kind: 'q_a_pair',
          title: 'First',
        }),
        makeRow({
          content_type: 'guidance',
          owner_kind: 'source_document',
          title: 'Second',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((i) => i.title)).toEqual([
      'Third',
      'First',
      'Second',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Kind narrow (BI-15) — narrows only, never widens; clearing returns to ALL.
// ---------------------------------------------------------------------------

describe('useCorpusSearch — kind narrow', () => {
  it('changing the kind narrow issues a new request under a distinct cache key', async () => {
    navState.search = 'q=foo&kind=answer';
    mockFetchJson.mockResolvedValue({
      results: [makeRow({ content_type: 'q_a_pair', owner_kind: 'q_a_pair' })],
    });

    const { result, rerender } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.kind).toBe('answer');
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(requestBody(0).kind).toBe('answer');

    // Change ONLY the kind narrow (q + filters unchanged). A distinct query
    // key must cache-MISS and fire a second request — proves the
    // changed-params side of BI-9/BI-15, not just that ?kind is read once.
    navState.search = 'q=foo&kind=document';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({ content_type: 'guidance', owner_kind: 'source_document' }),
      ],
    });
    rerender();

    await waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(2));
    expect(result.current.kind).toBe('document');
    expect(requestBody(1).kind).toBe('document');
    expect(requestBody(1)).not.toEqual(requestBody(0));
  });

  it('does not filter mismatched-kind rows client-side (id-144: server narrows authoritatively via filter_kind)', async () => {
    navState.search = 'q=foo&kind=answer';
    // Pre-narrowed-by-server shape would only ever return matching rows, but
    // this mock deliberately returns a mixed batch to prove the hook itself
    // performs NO client-side narrowing any more — the removed :257 `.filter`
    // is what previously caused the OBS-4 pagination corruption.
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({
          content_type: 'q_a_pair',
          owner_kind: 'q_a_pair',
          title: 'Answer hit',
        }),
        makeRow({
          content_type: 'reference_item',
          owner_kind: 'reference_item',
          title: 'Reference hit',
        }),
        makeRow({
          content_type: 'guidance',
          owner_kind: 'source_document',
          title: 'Document hit',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(3);
    expect(result.current.items.map((i) => i.title)).toEqual([
      'Answer hit',
      'Reference hit',
      'Document hit',
    ]);
  });

  it('ignores an invalid ?kind value (falls back to ALL grains)', async () => {
    navState.search = 'q=foo&kind=bogus';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({ content_type: 'q_a_pair', owner_kind: 'q_a_pair' }),
        makeRow({
          content_type: 'reference_item',
          owner_kind: 'reference_item',
        }),
      ],
    });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.kind).toBeUndefined();
    expect(result.current.items).toHaveLength(2);
  });

  it('setKind writes ?kind to the URL', async () => {
    navState.search = 'q=foo';
    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setKind('document');
    });

    expect(mockPush).toHaveBeenCalledWith('/search?q=foo&kind=document');
  });

  it('clearing the kind narrow returns to ALL grains (drops ?kind)', async () => {
    navState.search = 'q=foo&kind=document';
    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setKind(undefined);
    });

    expect(mockPush).toHaveBeenCalledWith('/search?q=foo');
  });
});

// ---------------------------------------------------------------------------
// Metadata filters (BI-16) — pushed to request params + URL.
// ---------------------------------------------------------------------------

describe('useCorpusSearch — filters', () => {
  it('pushes domain/subtopic/date filters into the request body', async () => {
    navState.search =
      'q=foo&domain=procurement&subtopic=tendering&from=2026-01-01&to=2026-02-01';
    mockFetchJson.mockResolvedValue({ results: [] });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(requestBody()).toMatchObject({
      domain: 'procurement',
      subtopic: 'tendering',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
    });
    expect(result.current.filters).toEqual({
      domain: 'procurement',
      subtopic: 'tendering',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
    });
  });

  it('writes a filter change to the URL', async () => {
    navState.search = 'q=foo';
    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setFilters({ domain: 'legal' });
    });

    expect(mockPush).toHaveBeenCalledWith('/search?q=foo&domain=legal');
  });

  it('clears the dependent subtopic when the domain filter is cleared', async () => {
    navState.search = 'q=foo&domain=procurement&subtopic=tendering';
    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setFilters({ domain: undefined });
    });

    expect(mockPush).toHaveBeenCalledWith('/search?q=foo');
  });
});

// ---------------------------------------------------------------------------
// URL-driven query submission (BI-9) + cache-hit on re-submission
// ---------------------------------------------------------------------------

describe('useCorpusSearch — query submission + URL state', () => {
  it('setSearchQuery writes ?q to the URL', async () => {
    const { result } = renderCorpusSearch();

    act(() => {
      result.current.setSearchQuery('vat thresholds');
    });

    expect(mockPush).toHaveBeenCalledWith('/search?q=vat+thresholds');
  });

  it('clearing the search query drops ?q (bare pathname)', async () => {
    navState.search = 'q=foo';
    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSearchQuery(undefined);
    });

    expect(mockPush).toHaveBeenCalledWith('/search');
  });

  it('re-submitting an unchanged query+kind+filter set hits the cache (no duplicate fetch)', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({
      results: [makeRow({ content_type: 'q_a_pair' })],
    });
    // gcTime override so the cache entry survives the unmount below — the
    // hook's own per-query staleTime (30s) already governs freshness.
    const { Wrapper } = createQueryWrapper({ gcTime: 60_000 });

    const first = renderHook(() => useCorpusSearch(), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    first.unmount();

    // Simulates navigating back to (or reloading) the identical shareable URL.
    const second = renderHook(() => useCorpusSearch(), { wrapper: Wrapper });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));

    expect(mockFetchJson).toHaveBeenCalledTimes(1); // still 1 — cache hit
    expect(second.result.current.items).toHaveLength(1);
  });

  it('the in-flight search request carries an abort signal (BI-17 supersession)', async () => {
    navState.search = 'q=foo';
    mockFetchJson.mockResolvedValue({ results: [] });

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const init = mockFetchJson.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// Error state (BI-19)
// ---------------------------------------------------------------------------

describe('useCorpusSearch — error state', () => {
  it('surfaces a search request failure as an error', async () => {
    navState.search = 'q=boom';
    mockFetchJson.mockRejectedValue(new Error('Search query failed'));

    const { result } = renderCorpusSearch();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/failed/i);
  });
});

// ---------------------------------------------------------------------------
// Pagination — limit-raising load-more (BI-20, AAT-1 fallback)
// ---------------------------------------------------------------------------

describe('useCorpusSearch — pagination (AAT-1 limit-raising fallback)', () => {
  function mockPagedPool(total: number) {
    const pool = Array.from({ length: total }, () =>
      makeRow({ content_type: 'q_a_pair' }),
    );
    mockFetchJson.mockImplementation(
      async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { limit: number };
        return { results: pool.slice(0, body.limit) };
      },
    );
    return pool;
  }

  it('requests the first page at PAGE_SIZE (48) and exposes hasMore when the pool is larger', async () => {
    mockPagedPool(100);
    navState.search = 'q=foo';

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(requestBody().limit).toBe(48);
    expect(result.current.items).toHaveLength(48);
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore raises the cumulative limit and grows the result set with no duplicate ids', async () => {
    mockPagedPool(100);
    navState.search = 'q=foo';

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const firstPageIds = result.current.items.map((i) => i.id);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(96));
    expect(requestBody(1).limit).toBe(96);

    const ids = result.current.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(96); // no duplicates
    // Stable order — the first page's ids are an unchanged prefix.
    expect(ids.slice(0, 48)).toEqual(firstPageIds);
  });

  it('exposes an explicit end-of-results once the pool is exhausted', async () => {
    mockPagedPool(100);
    navState.search = 'q=foo';

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.loadMore(); // -> 96
    });
    await waitFor(() => expect(result.current.items).toHaveLength(96));

    act(() => {
      result.current.loadMore(); // -> requests 144, pool only has 100
    });
    await waitFor(() => expect(result.current.items).toHaveLength(100));

    expect(result.current.hasMore).toBe(false);

    // A further loadMore() is a no-op (no fetch beyond the exhausted pool).
    const callsBefore = mockFetchJson.mock.calls.length;
    act(() => {
      result.current.loadMore();
    });
    expect(mockFetchJson.mock.calls.length).toBe(callsBefore);
  });

  it('does not offer more when the first page is already short', async () => {
    mockPagedPool(10);
    navState.search = 'q=foo';

    const { result } = renderCorpusSearch();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(10);
    expect(result.current.hasMore).toBe(false);
  });
});
