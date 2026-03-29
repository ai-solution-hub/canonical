import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiffReviewEntry } from '@/components/source-document/source-document-diff-review';

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

import { useDiffReview } from '@/hooks/use-diff-review';

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

const DOC_ID = 'doc-123';

function makeEntry(overrides: Partial<DiffReviewEntry> = {}): DiffReviewEntry {
  return {
    id: overrides.id ?? 'entry-1',
    diff_type: 'modified',
    old_content: 'old text',
    new_content: 'new text',
    status: 'pending_review',
    ...overrides,
  };
}

const MOCK_ENTRIES: DiffReviewEntry[] = [
  makeEntry({ id: 'e1', diff_type: 'added', status: 'pending_review' }),
  makeEntry({
    id: 'e2',
    diff_type: 'modified',
    status: 'pending_review',
    affected_item: { id: 'item-a', title: 'Affected Item A' },
  }),
  makeEntry({ id: 'e3', diff_type: 'removed', status: 'applied' }),
  makeEntry({ id: 'e4', diff_type: 'unchanged', status: 'pending_review' }),
];

// ─── Tests ───────────────────────────────────────────────────────────────

describe('useDiffReview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: { pending_review: 1, applied: 2, dismissed: 1 },
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Initial state ───

  it('initialises entries and summary from props', () => {
    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    expect(result.current.entries).toEqual(MOCK_ENTRIES);
    expect(result.current.localSummary).toEqual({
      pending_review: 3,
      applied: 1,
      dismissed: 0,
    });
    expect(result.current.isAnyLoading).toBe(false);
    expect(result.current.updateError).toBeNull();
  });

  // ─── Task 1: useEffect sync when initialEntries changes ───

  it('syncs local state when initialEntries changes (Task 1 bug fix)', () => {
    const { result, rerender } = renderHook(
      ({ entries }) => useDiffReview(DOC_ID, entries),
      {
        wrapper: createWrapper(),
        initialProps: { entries: MOCK_ENTRIES },
      },
    );

    expect(result.current.entries).toHaveLength(4);

    const updatedEntries = [
      makeEntry({ id: 'e1', diff_type: 'added', status: 'applied' }),
    ];

    rerender({ entries: updatedEntries });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].status).toBe('applied');
    expect(result.current.localSummary).toEqual({
      pending_review: 0,
      applied: 1,
      dismissed: 0,
    });
  });

  // ─── P4: Memoised affectedItemIds ───

  it('computes affectedItemIds from entries with affected_item', () => {
    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    // Only e2 has an affected_item and is not unchanged
    expect(result.current.affectedItemIds).toEqual(['item-a']);
    expect(result.current.hasAffectedItems).toBe(true);
  });

  it('returns empty affectedItemIds when no entries have affected items', () => {
    const entries = [
      makeEntry({ id: 'e1', diff_type: 'added' }),
      makeEntry({ id: 'e2', diff_type: 'modified' }),
    ];

    const { result } = renderHook(
      () => useDiffReview(DOC_ID, entries),
      { wrapper: createWrapper() },
    );

    expect(result.current.affectedItemIds).toEqual([]);
    expect(result.current.hasAffectedItems).toBe(false);
  });

  // ─── Status change (single) ───

  it('optimistically updates entry status on handleStatusChange', async () => {
    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleStatusChange('e1', 'applied');
    });

    // Optimistic update should be applied immediately
    const e1 = result.current.entries.find((e) => e.id === 'e1');
    expect(e1?.status).toBe('applied');

    // Should call the API
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/source-documents/${DOC_ID}/diff`,
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  // ─── Bulk status change ───

  it('handles bulk status change', async () => {
    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleBulkStatusChange(['e1', 'e2'], 'dismissed');
    });

    const e1 = result.current.entries.find((e) => e.id === 'e1');
    const e2 = result.current.entries.find((e) => e.id === 'e2');
    expect(e1?.status).toBe('dismissed');
    expect(e2?.status).toBe('dismissed');
  });

  it('skips bulk change when ids array is empty', () => {
    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    // Clear any calls made by previous tests
    mockFetch.mockClear();

    act(() => {
      result.current.handleBulkStatusChange([], 'applied');
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── Rollback on error ───

  it('rolls back on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleStatusChange('e1', 'applied');
    });

    await waitFor(() => {
      expect(result.current.updateError).toBe(
        'Failed to update review status. Please try again.',
      );
    });

    // Should have rolled back
    const e1 = result.current.entries.find((e) => e.id === 'e1');
    expect(e1?.status).toBe('pending_review');
  });

  // ─── Note handling ───

  it('tracks pending notes via handleNoteChange', () => {
    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleNoteChange('e1', 'This is a note');
    });

    expect(result.current.pendingNotes).toEqual({
      e1: 'This is a note',
    });
  });

  // ─── Task 2: Send-to-review error surfacing ───

  it('stores send-to-review error instead of swallowing (Task 2 bug fix)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('send-to-review')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Review service unavailable' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          summary: { pending_review: 3, applied: 1, dismissed: 0 },
        }),
      });
    });

    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleSendToReview();
    });

    await waitFor(() => {
      expect(result.current.sendToReviewState).toBe('error');
    });

    expect(result.current.sendToReviewError).toBe(
      'Review service unavailable',
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Failed to send items to review queue',
    );
  });

  it('sends affected items to review successfully', async () => {
    const reviewResult = {
      sent: 1,
      already_pending: 0,
      skipped_draft: 0,
      review_url: '/review',
    };

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('send-to-review')) {
        return Promise.resolve({
          ok: true,
          json: async () => reviewResult,
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          summary: { pending_review: 3, applied: 1, dismissed: 0 },
        }),
      });
    });

    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleSendToReview();
    });

    await waitFor(() => {
      expect(result.current.sendToReviewState).toBe('success');
    });

    expect(result.current.sendToReviewResult).toEqual(reviewResult);
    expect(result.current.sendToReviewError).toBeNull();
  });

  // ─── dismissError ───

  it('clears update error via dismissError', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'fail' }),
    });

    const { result } = renderHook(
      () => useDiffReview(DOC_ID, MOCK_ENTRIES),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleStatusChange('e1', 'applied');
    });

    await waitFor(() => {
      expect(result.current.updateError).not.toBeNull();
    });

    act(() => {
      result.current.dismissError();
    });

    expect(result.current.updateError).toBeNull();
  });
});
