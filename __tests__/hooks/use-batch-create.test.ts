/**
 * useBatchCreate Hook Tests
 *
 * Tests successful batch submission, error handling, progress tracking,
 * and duplicate detection. Migrated to use QueryClientProvider wrapper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSelect, mockLimit } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockIlike = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockSelect = vi.fn().mockReturnValue({ ilike: mockIlike });

  return { mockIlike, mockSelect, mockLimit };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: mockSelect,
    }),
  }),
}));

import { useBatchCreate, type BatchQAPair } from '@/hooks/use-batch-create';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
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

function createMockFetchResponse(data: unknown, ok = true, status = 201) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBatchCreate', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('submit', () => {
    it('returns initial state', () => {
      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isCheckingDuplicates).toBe(false);
      expect(result.current.progress).toEqual({ current: 0, total: 0 });
      expect(result.current.results).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('successfully submits batch Q&A pairs', async () => {
      const mockResponse = {
        created: 2,
        failed: 0,
        items: [
          { id: 'item-1', title: 'What is X?', status: 'created' },
          { id: 'item-2', title: 'How does Y work?', status: 'created' },
        ],
        pipeline_run_id: 'run-1',
        batch_id: 'batch-1',
      };

      global.fetch = vi.fn().mockImplementation(() =>
        createMockFetchResponse(mockResponse),
      );

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      const pairs: BatchQAPair[] = [
        { question: 'What is X?', answer: 'X is a thing' },
        { question: 'How does Y work?', answer: 'Y works by doing Z' },
      ];

      let submitResult: unknown;
      await act(async () => {
        submitResult = await result.current.submit(pairs);
      });

      // Verify fetch was called correctly
      expect(global.fetch).toHaveBeenCalledWith('/api/items/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      });

      // Verify the body format
      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toEqual({
        title: 'What is X?',
        content: 'Q: What is X?\n\nA: X is a thing',
        contentType: 'q_a_pair',
      });

      // Verify result
      expect(submitResult).toEqual(mockResponse);
      expect(result.current.results).toEqual(mockResponse);
      expect(result.current.error).toBeNull();
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.progress).toEqual({ current: 2, total: 2 });
    });

    it('handles API errors gracefully', async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        createMockFetchResponse(
          { error: 'Batch creation failed' },
          false,
          500,
        ),
      );

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      const pairs: BatchQAPair[] = [
        { question: 'What is X?', answer: 'X is a thing' },
      ];

      let submitResult: unknown;
      await act(async () => {
        submitResult = await result.current.submit(pairs);
      });

      expect(submitResult).toBeNull();
      expect(result.current.error).toBe('Batch creation failed');
      expect(result.current.results).toBeNull();
      expect(result.current.isSubmitting).toBe(false);
    });

    it('handles network errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      const pairs: BatchQAPair[] = [
        { question: 'What is X?', answer: 'X is a thing' },
      ];

      let submitResult: unknown;
      await act(async () => {
        submitResult = await result.current.submit(pairs);
      });

      expect(submitResult).toBeNull();
      expect(result.current.error).toBe('Network error');
      expect(result.current.isSubmitting).toBe(false);
    });

    it('sets progress to total on successful completion', async () => {
      const mockResponse = {
        created: 3,
        failed: 0,
        items: [
          { id: 'item-1', title: 'Q1', status: 'created' },
          { id: 'item-2', title: 'Q2', status: 'created' },
          { id: 'item-3', title: 'Q3', status: 'created' },
        ],
        pipeline_run_id: 'run-1',
        batch_id: 'batch-1',
      };

      global.fetch = vi.fn().mockImplementation(() =>
        createMockFetchResponse(mockResponse),
      );

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      const pairs: BatchQAPair[] = [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2' },
        { question: 'Q3', answer: 'A3' },
      ];

      await act(async () => {
        await result.current.submit(pairs);
      });

      expect(result.current.progress).toEqual({ current: 3, total: 3 });
    });

    it('passes source_document_id when sourceDocumentLink is a UUID', async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        createMockFetchResponse({
          created: 1,
          failed: 0,
          items: [{ id: 'item-1', title: 'Q1', status: 'created' }],
          pipeline_run_id: 'run-1',
          batch_id: 'batch-1',
        }),
      );

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.submit(
          [{ question: 'Q1', answer: 'A1' }],
          { sourceDocumentLink: '550e8400-e29b-41d4-a716-446655440000' },
        );
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.source_document_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('does not pass source_document_id when sourceDocumentLink is not a UUID', async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        createMockFetchResponse({
          created: 1,
          failed: 0,
          items: [{ id: 'item-1', title: 'Q1', status: 'created' }],
          pipeline_run_id: 'run-1',
          batch_id: 'batch-1',
        }),
      );

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.submit(
          [{ question: 'Q1', answer: 'A1' }],
          { sourceDocumentLink: 'https://example.com/doc' },
        );
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.source_document_id).toBeUndefined();
    });

    it('resets error and results on new submission', async () => {
      // First call fails
      global.fetch = vi.fn().mockImplementation(() =>
        createMockFetchResponse({ error: 'Failed' }, false, 500),
      );

      const wrapper = createWrapper();

      const { result } = renderHook(() => useBatchCreate(), { wrapper });

      await act(async () => {
        await result.current.submit([{ question: 'Q1', answer: 'A1' }]);
      });

      expect(result.current.error).toBe('Failed');

      // Second call succeeds
      global.fetch = vi.fn().mockImplementation(() =>
        createMockFetchResponse({
          created: 1,
          failed: 0,
          items: [{ id: 'item-1', title: 'Q1', status: 'created' }],
          pipeline_run_id: 'run-1',
          batch_id: 'batch-1',
        }),
      );

      await act(async () => {
        await result.current.submit([{ question: 'Q1', answer: 'A1' }]);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.results).not.toBeNull();
    });
  });

  describe('checkDuplicates', () => {
    it('returns empty array when no duplicates found', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      let matches: unknown;
      await act(async () => {
        matches = await result.current.checkDuplicates([
          { question: 'Unique question?', answer: 'Answer' },
        ]);
      });

      expect(matches).toEqual([]);
      expect(result.current.isCheckingDuplicates).toBe(false);
    });

    it('returns matches when duplicates found', async () => {
      mockLimit.mockResolvedValue({
        data: [{ id: 'existing-1', title: 'What is X?' }],
        error: null,
      });

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      let matches: unknown;
      await act(async () => {
        matches = await result.current.checkDuplicates([
          { question: 'What is X?', answer: 'Answer' },
        ]);
      });

      expect(matches).toEqual([
        { id: 'existing-1', title: 'What is X?', question: 'What is X?' },
      ]);
    });

    it('deduplicates matches by ID', async () => {
      // Same item matched by multiple queries
      mockLimit.mockResolvedValue({
        data: [{ id: 'existing-1', title: 'What is X?' }],
        error: null,
      });

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      let matches: unknown;
      await act(async () => {
        matches = await result.current.checkDuplicates([
          { question: 'What is X?', answer: 'A1' },
          { question: 'What is X?', answer: 'A2' },
        ]);
      });

      // Should only have one match despite two queries matching the same item
      expect(matches).toEqual([
        { id: 'existing-1', title: 'What is X?', question: 'What is X?' },
      ]);
    });

    it('handles errors gracefully by returning empty array', async () => {
      mockLimit.mockRejectedValue(new Error('DB error'));

      const { result } = renderHook(() => useBatchCreate(), {
        wrapper: createWrapper(),
      });

      let matches: unknown;
      await act(async () => {
        matches = await result.current.checkDuplicates([
          { question: 'What is X?', answer: 'Answer' },
        ]);
      });

      expect(matches).toEqual([]);
      expect(result.current.isCheckingDuplicates).toBe(false);
    });
  });
});
