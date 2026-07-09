/**
 * Surface B detail hooks tests (ID-135 {135.13}).
 *
 * Behaviour-first (test-philosophy.md): drives the REAL hooks, mocking only
 * the I/O seam — `@/lib/query/fetchers` `fetchJson`. All three routes
 * consumed here are VERIFIED SHIPPED on this branch (not mocked-against-target):
 *   - GET /api/source-documents/[id]/versions (get_document_version_chain RPC, id-117)
 *   - GET /api/source-documents/[id]/citations ({135.12})
 *   - GET /api/source-documents/[id] (derived_pairs, id-131 Path β / BND-1)
 *
 * The load-bearing behaviour under test is BI-30 (TECH §3): the three hooks
 * are INDEPENDENT TanStack queries under three distinct `sourceDocuments`
 * query keys — one section erroring must not abort the others.
 *
 * Spec: TECH §3 BI-25/BI-27/BI-28/BI-30, §4 (hooks).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { queryKeys } from '@/lib/query/query-keys';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetchJson } = vi.hoisted(() => ({
  mockFetchJson: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return { ...actual, fetchJson: mockFetchJson };
});

import {
  useDocumentVersions,
  useDocumentCitations,
  useDerivedPairs,
} from '@/hooks/source-document-detail/use-source-document-detail';

const DOC_ID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// Fixtures — shaped as the verified route responses (raw wire shape).
// ---------------------------------------------------------------------------

function makeVersionsResponse() {
  return {
    document_id: DOC_ID,
    total_versions: 2,
    versions: [
      {
        id: DOC_ID,
        filename: 'policy-v2.pdf',
        original_filename: 'policy.pdf',
        mime_type: 'application/pdf',
        file_size: 2048,
        content_hash: 'abc123',
        version: 2,
        parent_id: 'parent-doc-id',
        storage_path: 'docs/policy-v2.pdf',
        status: 'active',
        uploaded_by: 'user-1',
        created_at: '2026-06-01T00:00:00.000Z',
        content_item_count: 3,
      },
    ],
  };
}

function makeCitationsResponse() {
  return {
    document_id: DOC_ID,
    citations: {
      q_a_pair: [
        {
          id: 'cite-1',
          cited_kind: 'q_a_pair',
          citing_kind: 'form_response',
          citation_type: 'reference',
          cited_text: 'per policy section 4',
          cited_q_a_pair_id: 'qa-1',
          cited_reference_item_id: null,
          cited_source_document_id: null,
          cited_concept_path: null,
          created_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      reference_item: [],
      source_document: [],
      concept: [],
    },
  };
}

function makeDetailResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    filename: 'policy-v2.pdf',
    derived_pairs: [
      {
        id: 'qa-1',
        question_text: 'What is the policy?',
        answer_standard: 'The policy is X.',
        publication_status: 'published',
        created_at: '2026-06-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function renderDocumentVersions(id: string = DOC_ID) {
  const { Wrapper, queryClient } = createQueryWrapper();
  const rendered = renderHook(() => useDocumentVersions(id), {
    wrapper: Wrapper,
  });
  return { ...rendered, queryClient };
}

function renderDocumentCitations(id: string = DOC_ID) {
  const { Wrapper, queryClient } = createQueryWrapper();
  const rendered = renderHook(() => useDocumentCitations(id), {
    wrapper: Wrapper,
  });
  return { ...rendered, queryClient };
}

function renderDerivedPairs(id: string = DOC_ID) {
  const { Wrapper, queryClient } = createQueryWrapper();
  const rendered = renderHook(() => useDerivedPairs(id), { wrapper: Wrapper });
  return { ...rendered, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useDocumentVersions (BI-25)
// ---------------------------------------------------------------------------

describe('useDocumentVersions', () => {
  it('fetches the shipped versions route under the sourceDocuments.versions key', async () => {
    mockFetchJson.mockResolvedValue(makeVersionsResponse());

    const { result } = renderDocumentVersions();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetchJson).toHaveBeenCalledWith(
      `/api/source-documents/${DOC_ID}/versions`,
    );
    expect(result.current.data?.versions).toHaveLength(1);
    expect(result.current.data?.versions[0].version).toBe(2);
  });

  it('registers its query under the sourceDocuments.versions cache key', async () => {
    mockFetchJson.mockResolvedValue(makeVersionsResponse());

    const { result, queryClient } = renderDocumentVersions();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const state = queryClient.getQueryState(
      queryKeys.sourceDocuments.versions(DOC_ID),
    );
    expect(state?.data).toBeDefined();
  });

  it('surfaces an error without throwing when the versions fetch fails', async () => {
    mockFetchJson.mockRejectedValue(new Error('versions fetch failed'));

    const { result } = renderDocumentVersions();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('versions fetch failed');
  });
});

// ---------------------------------------------------------------------------
// useDocumentCitations (BI-27)
// ---------------------------------------------------------------------------

describe('useDocumentCitations', () => {
  it('fetches the {135.12} citations route under the sourceDocuments.citations key', async () => {
    mockFetchJson.mockResolvedValue(makeCitationsResponse());

    const { result } = renderDocumentCitations();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetchJson).toHaveBeenCalledWith(
      `/api/source-documents/${DOC_ID}/citations`,
    );
  });

  it('returns the grouped-by-kind envelope with all 4 buckets present', async () => {
    mockFetchJson.mockResolvedValue(makeCitationsResponse());

    const { result } = renderDocumentCitations();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.citations.q_a_pair).toHaveLength(1);
    expect(result.current.data?.citations.reference_item).toEqual([]);
    expect(result.current.data?.citations.source_document).toEqual([]);
    expect(result.current.data?.citations.concept).toEqual([]);
  });

  it('surfaces the clear-empty-state shape when no citations exist yet', async () => {
    mockFetchJson.mockResolvedValue({
      document_id: DOC_ID,
      citations: {
        q_a_pair: [],
        reference_item: [],
        source_document: [],
        concept: [],
      },
    });

    const { result } = renderDocumentCitations();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.citations).toEqual({
      q_a_pair: [],
      reference_item: [],
      source_document: [],
      concept: [],
    });
  });
});

// ---------------------------------------------------------------------------
// useDerivedPairs (BI-28)
// ---------------------------------------------------------------------------

describe('useDerivedPairs', () => {
  it('fetches the [id] route and surfaces its derived_pairs field', async () => {
    mockFetchJson.mockResolvedValue(makeDetailResponse());

    const { result } = renderDerivedPairs();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetchJson).toHaveBeenCalledWith(
      `/api/source-documents/${DOC_ID}`,
    );
    expect(result.current.data).toEqual([
      {
        id: 'qa-1',
        question_text: 'What is the policy?',
        answer_standard: 'The policy is X.',
        publication_status: 'published',
        created_at: '2026-06-01T00:00:00.000Z',
      },
    ]);
  });

  it('surfaces only published pairs as returned by the route (BI-28)', async () => {
    mockFetchJson.mockResolvedValue(
      makeDetailResponse({
        derived_pairs: [
          {
            id: 'qa-published',
            question_text: 'Published question',
            answer_standard: 'Published answer',
            publication_status: 'published',
            created_at: '2026-06-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const { result } = renderDerivedPairs();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].publication_status).toBe('published');
  });

  it('returns an empty array when the route has no derived_pairs field', async () => {
    mockFetchJson.mockResolvedValue({ id: DOC_ID, filename: 'x.pdf' });

    const { result } = renderDerivedPairs();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BI-30 — partial-failure isolation (load-bearing)
// ---------------------------------------------------------------------------

describe('BI-30 partial-failure isolation', () => {
  it('one hook erroring does not abort the other two independent queries', async () => {
    mockFetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/citations')) {
        return Promise.reject(new Error('citations fetch failed'));
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(makeVersionsResponse());
      }
      return Promise.resolve(makeDetailResponse());
    });

    const { Wrapper } = createQueryWrapper();
    const versions = renderHook(() => useDocumentVersions(DOC_ID), {
      wrapper: Wrapper,
    });
    const citations = renderHook(() => useDocumentCitations(DOC_ID), {
      wrapper: Wrapper,
    });
    const derivedPairs = renderHook(() => useDerivedPairs(DOC_ID), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(citations.result.current.isError).toBe(true));
    await waitFor(() => expect(versions.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(derivedPairs.result.current.isSuccess).toBe(true),
    );

    expect(versions.result.current.data?.versions).toHaveLength(1);
    expect(derivedPairs.result.current.data).toHaveLength(1);
    expect(citations.result.current.data).toBeUndefined();
    expect(citations.result.current.error?.message).toBe(
      'citations fetch failed',
    );
  });

  it('issues each hook under its own distinct sourceDocuments query key', async () => {
    mockFetchJson.mockResolvedValue(makeVersionsResponse());

    const { Wrapper, queryClient } = createQueryWrapper();
    renderHook(() => useDocumentVersions(DOC_ID), { wrapper: Wrapper });
    renderHook(() => useDocumentCitations(DOC_ID), { wrapper: Wrapper });
    renderHook(() => useDerivedPairs(DOC_ID), { wrapper: Wrapper });

    await waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(3));

    const cachedKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);

    expect(cachedKeys).toContainEqual(
      queryKeys.sourceDocuments.versions(DOC_ID),
    );
    expect(cachedKeys).toContainEqual(
      queryKeys.sourceDocuments.citations(DOC_ID),
    );
    expect(cachedKeys).toContainEqual(
      queryKeys.sourceDocuments.derivedPairs(DOC_ID),
    );
    // Not a single combined/dependent query — three distinct cache entries.
    expect(new Set(cachedKeys.map((k) => JSON.stringify(k))).size).toBe(3);
  });
});
