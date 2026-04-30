import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReviewSession } from '@/hooks/review/use-review-session';
import type { ReadonlyURLSearchParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReplaceState = vi.fn();
Object.defineProperty(window, 'history', {
  value: { replaceState: mockReplaceState },
  writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a ReadonlyURLSearchParams-compatible object from a URLSearchParams.
 * Next.js ReadonlyURLSearchParams is a subset of URLSearchParams.
 */
function makeSearchParams(
  init?: string | Record<string, string | string[]>,
): ReadonlyURLSearchParams {
  const params = new URLSearchParams();
  if (typeof init === 'string') {
    return new URLSearchParams(init) as unknown as ReadonlyURLSearchParams;
  }
  if (init) {
    for (const [key, value] of Object.entries(init)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          params.append(key, v);
        }
      } else {
        params.set(key, value);
      }
    }
  }
  return params as unknown as ReadonlyURLSearchParams;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReviewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplaceState.mockReset();
  });

  // =========================================================================
  // Default filter initialisation
  // =========================================================================

  describe('default filter initialisation', () => {
    it('defaults to unverified status when no URL params', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.status).toBe('unverified');
      expect(result.current.filters.domain).toBeUndefined();
      expect(result.current.filters.content_type).toBeUndefined();
      expect(result.current.filters.source_file).toBeUndefined();
      expect(result.current.filters.source_document_id).toBeUndefined();
    });

    it('reads status from URL search params', () => {
      const searchParams = makeSearchParams('status=flagged');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.status).toBe('flagged');
    });

    it('reads verified status from URL search params', () => {
      const searchParams = makeSearchParams('status=verified');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.status).toBe('verified');
    });

    it('reads draft status from URL search params', () => {
      const searchParams = makeSearchParams('status=draft');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.status).toBe('draft');
    });

    it('reads all status from URL search params', () => {
      const searchParams = makeSearchParams('status=all');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.status).toBe('all');
    });

    it('falls back to unverified for invalid status', () => {
      const searchParams = makeSearchParams('status=invalid_value');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.status).toBe('unverified');
    });

    it('reads domain array from URL search params', () => {
      const searchParams = makeSearchParams(
        'domain=Technical&domain=Commercial',
      );

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.domain).toEqual([
        'Technical',
        'Commercial',
      ]);
    });

    it('reads content_type array from URL search params', () => {
      const searchParams = makeSearchParams(
        'content_type=article&content_type=guide',
      );

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.content_type).toEqual(['article', 'guide']);
    });

    it('reads source_file from URL search params', () => {
      const searchParams = makeSearchParams('source_file=data.docx');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.source_file).toBe('data.docx');
    });

    it('reads source_document_id from URL search params', () => {
      const searchParams = makeSearchParams('source_document_id=abc-123');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.source_document_id).toBe('abc-123');
    });

    it('reads assigned_to_me=true from URL search params', () => {
      const searchParams = makeSearchParams('assigned_to_me=true');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.assigned_to_me).toBe(true);
    });

    it('does not set assigned_to_me when URL param is absent', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.assigned_to_me).toBeUndefined();
    });

    it('does not set assigned_to_me when URL param is not "true"', () => {
      const searchParams = makeSearchParams('assigned_to_me=false');

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.filters.assigned_to_me).toBeUndefined();
    });
  });

  // =========================================================================
  // Filter-to-URL sync
  // =========================================================================

  describe('filter-to-URL sync', () => {
    // S215 W1: status is no longer written to URL by this hook —
    // the ReviewTabs parent owns the `?tab=` key, status is derived
    // from the active tab. Spec: docs/specs/review-page-tabs-refactor-spec.md §5.
    it('does NOT write status to URL (S215: tabs own status)', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({ status: 'flagged' });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).not.toContain('status=');
    });

    it('omits status from URL when it is the default (unverified)', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      // Set back to unverified (default)
      act(() => {
        result.current.setFilters({ status: 'unverified' });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).toBe('/review');
    });

    it('syncs domain filter to URL', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({
          status: 'unverified',
          domain: ['Technical', 'Commercial'],
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).toContain('domain=Technical');
      expect(urlArg).toContain('domain=Commercial');
    });

    it('syncs content_type filter to URL', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({
          status: 'unverified',
          content_type: ['article', 'guide'],
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).toContain('content_type=article');
      expect(urlArg).toContain('content_type=guide');
    });

    it('syncs source_file filter to URL', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({
          status: 'unverified',
          source_file: 'data.docx',
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).toContain('source_file=data.docx');
    });

    it('syncs source_document_id filter to URL', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({
          status: 'unverified',
          source_document_id: 'doc-456',
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).toContain('source_document_id=doc-456');
    });

    it('handleFiltersChange also triggers URL sync (status omitted post-S215)', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.handleFiltersChange({
          status: 'verified',
          domain: ['Technical'],
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      // status is NOT in the URL (tabs own it post-S215). Other filters do.
      expect(urlArg).not.toContain('status=');
      expect(urlArg).toContain('domain=Technical');
    });

    it('syncs assigned_to_me=true to URL', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({
          status: 'unverified',
          assigned_to_me: true,
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).toContain('assigned_to_me=true');
    });

    it('omits assigned_to_me from URL when filter is cleared', () => {
      const searchParams = makeSearchParams('assigned_to_me=true');

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({
          status: 'unverified',
          assigned_to_me: undefined,
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      expect(urlArg).not.toContain('assigned_to_me');
    });

    it('round-trips assigned_to_me with other filters (status omitted post-S215)', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setFilters({
          status: 'flagged',
          domain: ['Technical'],
          assigned_to_me: true,
        });
      });

      expect(mockReplaceState).toHaveBeenCalled();
      const lastCall =
        mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
      const urlArg = lastCall[2] as string;
      // status is NOT in the URL (tabs own it post-S215).
      expect(urlArg).not.toContain('status=');
      expect(urlArg).toContain('domain=Technical');
      expect(urlArg).toContain('assigned_to_me=true');
    });
  });

  // =========================================================================
  // Session progress tracking
  // =========================================================================

  describe('session progress tracking', () => {
    it('initialises progress with all zeros', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.progress).toEqual({
        verified: 0,
        flagged: 0,
        skipped: 0,
        total: 0,
        sessionReviewed: 0,
      });
    });

    it('setProgress updates progress state', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      act(() => {
        result.current.setProgress({
          verified: 10,
          flagged: 3,
          skipped: 1,
          total: 50,
          sessionReviewed: 14,
        });
      });

      expect(result.current.progress.verified).toBe(10);
      expect(result.current.progress.flagged).toBe(3);
      expect(result.current.progress.skipped).toBe(1);
      expect(result.current.progress.total).toBe(50);
      expect(result.current.progress.sessionReviewed).toBe(14);
    });

    it('setProgress accepts an updater function', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      // Set initial state
      act(() => {
        result.current.setProgress({
          verified: 5,
          flagged: 2,
          skipped: 0,
          total: 100,
          sessionReviewed: 7,
        });
      });

      // Increment via updater function
      act(() => {
        result.current.setProgress((prev) => ({
          ...prev,
          sessionReviewed: prev.sessionReviewed + 1,
          verified: prev.verified + 1,
        }));
      });

      expect(result.current.progress.sessionReviewed).toBe(8);
      expect(result.current.progress.verified).toBe(6);
    });
  });

  // =========================================================================
  // UI toggles
  // =========================================================================

  describe('UI toggles', () => {
    it('toggles queue panel visibility', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.showQueuePanel).toBe(false);

      act(() => {
        result.current.handleTogglePanel();
      });

      expect(result.current.showQueuePanel).toBe(true);

      act(() => {
        result.current.handleTogglePanel();
      });

      expect(result.current.showQueuePanel).toBe(false);
    });

    it('manages flag input visibility', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.showFlagInput).toBe(false);

      act(() => {
        result.current.setShowFlagInput(true);
      });

      expect(result.current.showFlagInput).toBe(true);
    });

    it('manages flag details text', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.flagDetails).toBe('');

      act(() => {
        result.current.setFlagDetails('Needs reclassification');
      });

      expect(result.current.flagDetails).toBe('Needs reclassification');
    });

    it('manages announcements', () => {
      const searchParams = makeSearchParams();

      const { result } = renderHook(() => useReviewSession(searchParams));

      expect(result.current.announcement).toBe('');

      act(() => {
        result.current.setAnnouncement('Verified. Item 2 of 100.');
      });

      expect(result.current.announcement).toBe('Verified. Item 2 of 100.');
    });
  });
});
