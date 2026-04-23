/**
 * useBrowseFilters — from_bid URL parameter persistence tests (P1-30)
 *
 * Tests that ?from_bid=<workspaceId> survives all in-/browse state
 * changes: clearFilters, setSearchQuery(undefined), sort change,
 * domain filter toggle. Only cleared on navigating away from /browse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockSearchParams = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams.current,
  usePathname: () => '/browse',
}));

import { useBrowseFilters } from '@/hooks/browse/use-browse-filters';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBrowseFilters — from_bid persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.current = new URLSearchParams();
  });

  // -------------------------------------------------------------------------
  // clearFilters
  // -------------------------------------------------------------------------
  describe('clearFilters()', () => {
    it('preserves from_bid when present', () => {
      mockSearchParams.current = new URLSearchParams(
        'from_bid=ws-123&domain=security&q=test',
      );
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.clearFilters();
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-123');
      // All other filter params should be gone
      expect(pushedUrl).not.toContain('domain=');
      expect(pushedUrl).not.toContain('q=');
    });

    it('does not add from_bid when absent', () => {
      mockSearchParams.current = new URLSearchParams('domain=security&q=test');
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.clearFilters();
      });

      expect(mockPush).toHaveBeenCalledWith('/browse');
    });
  });

  // -------------------------------------------------------------------------
  // setSearchQuery
  // -------------------------------------------------------------------------
  describe('setSearchQuery()', () => {
    it('preserves from_bid when setting a new query', () => {
      mockSearchParams.current = new URLSearchParams('from_bid=ws-456');
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.setSearchQuery('risk assessment');
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-456');
      expect(pushedUrl).toContain('q=risk+assessment');
    });

    it('preserves from_bid when clearing query (undefined)', () => {
      mockSearchParams.current = new URLSearchParams(
        'from_bid=ws-456&q=old+query',
      );
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.setSearchQuery(undefined);
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-456');
      expect(pushedUrl).not.toContain('q=');
    });
  });

  // -------------------------------------------------------------------------
  // setFilters (sort change)
  // -------------------------------------------------------------------------
  describe('setFilters() — sort change', () => {
    it('preserves from_bid when changing sort', () => {
      mockSearchParams.current = new URLSearchParams(
        'from_bid=ws-789&sort=captured_date',
      );
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.setFilters({ sort: 'title', order: 'asc' });
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-789');
      expect(pushedUrl).toContain('sort=title');
    });
  });

  // -------------------------------------------------------------------------
  // setFilters (domain filter toggle)
  // -------------------------------------------------------------------------
  describe('setFilters() — domain filter toggle', () => {
    it('preserves from_bid when toggling domain filter on', () => {
      mockSearchParams.current = new URLSearchParams('from_bid=ws-abc');
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.setFilters({ domain: ['security', 'hr'] });
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-abc');
      expect(pushedUrl).toContain('domain=security%2Chr');
    });

    it('preserves from_bid when toggling domain filter off', () => {
      mockSearchParams.current = new URLSearchParams(
        'from_bid=ws-abc&domain=security',
      );
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.setFilters({ domain: undefined });
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-abc');
      expect(pushedUrl).not.toContain('domain=');
    });
  });

  // -------------------------------------------------------------------------
  // Negative case: no from_bid
  // -------------------------------------------------------------------------
  describe('without from_bid', () => {
    it('clearFilters navigates to bare pathname', () => {
      mockSearchParams.current = new URLSearchParams(
        'domain=security&q=test',
      );
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.clearFilters();
      });

      expect(mockPush).toHaveBeenCalledWith('/browse');
    });

    it('setSearchQuery(undefined) navigates to bare pathname when no other params', () => {
      mockSearchParams.current = new URLSearchParams('q=old+query');
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.setSearchQuery(undefined);
      });

      expect(mockPush).toHaveBeenCalledWith('/browse');
    });
  });

  // -------------------------------------------------------------------------
  // Combination: from_bid + multiple mutations
  // -------------------------------------------------------------------------
  describe('combined mutations', () => {
    it('from_bid survives clearSearchQuery', () => {
      mockSearchParams.current = new URLSearchParams(
        'from_bid=ws-combo&q=hello',
      );
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.clearSearchQuery();
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-combo');
      expect(pushedUrl).not.toContain('q=');
    });

    it('from_bid survives removeFilter', () => {
      mockSearchParams.current = new URLSearchParams(
        'from_bid=ws-combo&domain=security',
      );
      const { result } = renderHook(() => useBrowseFilters());

      act(() => {
        result.current.removeFilter('domain');
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('from_bid=ws-combo');
      expect(pushedUrl).not.toContain('domain=');
    });
  });
});
