import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildQueueParams } from '@/hooks/review/use-review-queue-data';
import type { ReviewQueueResponse } from '@/types/review';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchJson = vi.hoisted(() => vi.fn());

vi.mock('@/lib/query/fetchers', () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

import { useReviewQueueData } from '@/hooks/review/use-review-queue-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  return {
    queryClient: qc,
    Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: qc }, children);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReviewQueueData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: successful but empty queue response
    mockFetchJson.mockResolvedValue({
      items: [],
      total: 0,
      verified_count: 0,
      flagged_count: 0,
      has_more: false,
    });
  });

  // =========================================================================
  // buildQueueParams (exported helper — pure function, no React needed)
  // =========================================================================

  describe('buildQueueParams', () => {
    it('sets limit to BATCH_SIZE (20) and offset', () => {
      const params = buildQueueParams({}, undefined, 0);
      expect(params.get('limit')).toBe('20');
      expect(params.get('offset')).toBe('0');
    });

    it('includes status filter when provided', () => {
      const params = buildQueueParams({ status: 'flagged' }, undefined, 0);
      expect(params.get('status')).toBe('flagged');
    });

    it('includes source_file filter when provided', () => {
      const params = buildQueueParams(
        { source_file: 'report.docx' },
        undefined,
        0,
      );
      expect(params.get('source_file')).toBe('report.docx');
    });

    it('includes source_document_id filter when provided', () => {
      const params = buildQueueParams(
        { source_document_id: 'doc-123' },
        undefined,
        0,
      );
      expect(params.get('source_document_id')).toBe('doc-123');
    });

    it('appends multiple domain values', () => {
      const params = buildQueueParams(
        { domain: ['Technical', 'Commercial'] },
        undefined,
        0,
      );
      expect(params.getAll('domain')).toEqual(['Technical', 'Commercial']);
    });

    it('appends multiple content_type values', () => {
      const params = buildQueueParams(
        { content_type: ['article', 'guidance'] },
        undefined,
        0,
      );
      expect(params.getAll('content_type')).toEqual(['article', 'guidance']);
    });

    it('includes sort when serverSort is provided', () => {
      const params = buildQueueParams({}, 'confidence_asc', 40);
      expect(params.get('sort')).toBe('confidence_asc');
      expect(params.get('offset')).toBe('40');
    });

    it('omits empty arrays and undefined filters', () => {
      const params = buildQueueParams(
        { domain: [], content_type: [] },
        undefined,
        0,
      );
      expect(params.has('domain')).toBe(false);
      expect(params.has('content_type')).toBe(false);
      expect(params.has('sort')).toBe(false);
      expect(params.has('status')).toBe(false);
    });

    it('includes assigned_to_me=true when filter is active', () => {
      const params = buildQueueParams(
        { assigned_to_me: true },
        undefined,
        0,
      );
      expect(params.get('assigned_to_me')).toBe('true');
    });

    it('omits assigned_to_me when filter is falsy', () => {
      const params = buildQueueParams(
        { assigned_to_me: undefined },
        undefined,
        0,
      );
      expect(params.has('assigned_to_me')).toBe(false);
    });

    it('composes assigned_to_me with other filters', () => {
      const params = buildQueueParams(
        {
          status: 'unverified',
          domain: ['Technical'],
          assigned_to_me: true,
        },
        'confidence_asc',
        20,
      );
      expect(params.get('assigned_to_me')).toBe('true');
      expect(params.get('status')).toBe('unverified');
      expect(params.getAll('domain')).toEqual(['Technical']);
      expect(params.get('sort')).toBe('confidence_asc');
      expect(params.get('offset')).toBe('20');
    });
  });

  // =========================================================================
  // Hook rendering — queue, stats, assignments
  // =========================================================================

  describe('hook return values', () => {
    it('returns empty queue and isLoading true initially', () => {
      // fetchJson never resolves quickly enough for initial render
      mockFetchJson.mockReturnValue(new Promise(() => {}));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      expect(result.current.queue).toEqual([]);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.hasMore).toBe(false);
    });

    it('flattens pages into a single queue array', async () => {
      const page1: ReviewQueueResponse = {
        items: [{ id: 'a' } as ReviewQueueResponse['items'][0]],
        total: 2,
        verified_count: 0,
        flagged_count: 0,
        has_more: true,
      };
      mockFetchJson.mockResolvedValueOnce(page1);

      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      // Wait for query to resolve — use RTL waitFor to wrap state updates in act()
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.queue).toHaveLength(1);
        expect(result.current.queue[0].id).toBe('a');
      });
    });

    it('stats defaults to null when API has not responded', () => {
      mockFetchJson.mockReturnValue(new Promise(() => {}));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      expect(result.current.stats).toBeNull();
    });

    it('activeAssignment defaults to null when no assignments exist', async () => {
      // Queue response
      mockFetchJson
        .mockResolvedValueOnce({
          items: [],
          total: 0,
          verified_count: 0,
          flagged_count: 0,
          has_more: false,
        })
        // Stats response
        .mockResolvedValueOnce({
          total: 0,
          verified: 0,
          flagged: 0,
          unverified: 0,
          draft: 0,
          by_domain: {},
          by_content_type: {},
          by_source_file: {},
          by_source_document: {},
        })
        // Assignments response — empty
        .mockResolvedValueOnce({ assignments: [] });

      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.activeAssignment).toBeNull();
      });
    });

    it('assignment select coerces null filter arrays to empty arrays', async () => {
      mockFetchJson
        .mockResolvedValueOnce({
          items: [],
          total: 0,
          verified_count: 0,
          flagged_count: 0,
          has_more: false,
        })
        .mockResolvedValueOnce({
          total: 10,
          verified: 5,
          flagged: 1,
          unverified: 4,
          draft: 0,
          by_domain: {},
          by_content_type: {},
          by_source_file: {},
          by_source_document: {},
        })
        .mockResolvedValueOnce({
          assignments: [
            {
              id: 'assign-1',
              notes: 'Urgent review',
              filter_domains: null,
              filter_content_types: null,
              filter_freshness: null,
              filter_date_from: '2026-01-01',
              filter_date_to: null,
              item_count: 42,
              due_date: '2026-04-01',
            },
          ],
        });

      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.activeAssignment).not.toBeNull();
        expect(result.current.activeAssignment!.filter_domains).toEqual([]);
        expect(result.current.activeAssignment!.filter_content_types).toEqual([]);
        expect(result.current.activeAssignment!.filter_freshness).toEqual([]);
        expect(result.current.activeAssignment!.id).toBe('assign-1');
      });
    });

    it('hasMore is true when API returns has_more: true', async () => {
      mockFetchJson.mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `item-${i}`,
        })),
        total: 50,
        verified_count: 0,
        flagged_count: 0,
        has_more: true,
      });

      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.hasMore).toBe(true);
      });
    });

    it('hasMore is false when API returns has_more: false', async () => {
      mockFetchJson.mockResolvedValueOnce({
        items: [{ id: 'only-one' }],
        total: 1,
        verified_count: 0,
        flagged_count: 0,
        has_more: false,
      });

      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.hasMore).toBe(false);
      });
    });

    it('exposes queryClient from provider', () => {
      const { Wrapper, queryClient } = createWrapper();
      const { result } = renderHook(
        () => useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      expect(result.current.queryClient).toBe(queryClient);
    });

    it('queueFiltersKey includes filters and sort for cache keying', () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () =>
          useReviewQueueData(
            { status: 'flagged', domain: ['Technical'] },
            'confidence_asc',
          ),
        { wrapper: Wrapper },
      );

      expect(result.current.queueFiltersKey).toEqual(
        expect.objectContaining({
          status: 'flagged',
          domain: ['Technical'],
          sort: 'confidence_asc',
        }),
      );
    });

    it('queueFiltersKey includes assigned_to_me when set', () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () =>
          useReviewQueueData(
            { status: 'unverified', assigned_to_me: true },
            undefined,
          ),
        { wrapper: Wrapper },
      );

      expect(result.current.queueFiltersKey).toEqual(
        expect.objectContaining({
          status: 'unverified',
          assigned_to_me: true,
        }),
      );
    });

    it('sends assigned_to_me=true in the fetch URL when filter is active', async () => {
      mockFetchJson.mockResolvedValueOnce({
        items: [],
        total: 0,
        verified_count: 0,
        flagged_count: 0,
        has_more: false,
      });

      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () =>
          useReviewQueueData(
            { status: 'unverified', assigned_to_me: true },
            undefined,
          ),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify the queue fetch URL includes assigned_to_me
      const queueCall = mockFetchJson.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes('/api/review/queue'),
      );
      expect(queueCall).toBeDefined();
      expect(queueCall![0]).toContain('assigned_to_me=true');
    });

    it('does not send assigned_to_me in the fetch URL when filter is off', async () => {
      mockFetchJson.mockResolvedValueOnce({
        items: [],
        total: 0,
        verified_count: 0,
        flagged_count: 0,
        has_more: false,
      });

      const { Wrapper } = createWrapper();
      const { result } = renderHook(
        () =>
          useReviewQueueData({ status: 'unverified' }, undefined),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const queueCall = mockFetchJson.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes('/api/review/queue'),
      );
      expect(queueCall).toBeDefined();
      expect(queueCall![0]).not.toContain('assigned_to_me');
    });
  });
});
