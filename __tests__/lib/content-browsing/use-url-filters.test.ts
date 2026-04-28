/**
 * useUrlFilters — generic URL-synced filter state hook tests.
 *
 * Covers: reading params, writing params, clearing, active count,
 * custom parsers/serialisers, and param mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlFilters } from '@/lib/content-browsing/use-url-filters';
import type { UrlFilterConfig } from '@/lib/content-browsing/types';

// ---------------------------------------------------------------------------
// Next.js navigation mocks
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockSearchParams = vi.hoisted(() => ({
  value: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams.value,
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => '/test',
}));

// ---------------------------------------------------------------------------
// Test types
// ---------------------------------------------------------------------------

interface SimpleFilters {
  search?: string;
  domain?: string;
  freshness?: string;
}

const simpleConfig: UrlFilterConfig<SimpleFilters> = {
  defaults: {
    search: undefined,
    domain: undefined,
    freshness: undefined,
  },
  paramMap: {
    search: 'q',
  },
};

describe('useUrlFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.value = new URLSearchParams();
  });

  // -----------------------------------------------------------------------
  // Reading params
  // -----------------------------------------------------------------------

  it('returns default values when URL has no params', () => {
    const { result } = renderHook(() => useUrlFilters(simpleConfig));
    expect(result.current.filters.search).toBeUndefined();
    expect(result.current.filters.domain).toBeUndefined();
    expect(result.current.filters.freshness).toBeUndefined();
  });

  it('reads values from URL search params', () => {
    mockSearchParams.value = new URLSearchParams('q=hello&domain=Education');
    const { result } = renderHook(() => useUrlFilters(simpleConfig));
    expect(result.current.filters.search).toBe('hello');
    expect(result.current.filters.domain).toBe('Education');
  });

  it('uses paramMap to map filter keys to URL param names', () => {
    mockSearchParams.value = new URLSearchParams('q=test');
    const { result } = renderHook(() => useUrlFilters(simpleConfig));
    // 'search' key maps to 'q' param
    expect(result.current.filters.search).toBe('test');
  });

  // -----------------------------------------------------------------------
  // Custom parsers
  // -----------------------------------------------------------------------

  it('applies custom parser to URL param values', () => {
    interface BoolFilter {
      starred?: boolean;
    }

    const config: UrlFilterConfig<BoolFilter> = {
      defaults: { starred: undefined },
      parsers: {
        starred: (raw) => raw === 'true',
      },
    };

    mockSearchParams.value = new URLSearchParams('starred=true');
    const { result } = renderHook(() => useUrlFilters(config));
    expect(result.current.filters.starred).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Writing params (setFilters)
  // -----------------------------------------------------------------------

  it('writes filter values to URL', () => {
    const { result } = renderHook(() => useUrlFilters(simpleConfig));

    act(() => result.current.setFilters({ domain: 'Health' }));

    expect(mockReplace).toHaveBeenCalledWith('/test?domain=Health', {
      scroll: false,
    });
  });

  it('uses paramMap when writing', () => {
    const { result } = renderHook(() => useUrlFilters(simpleConfig));

    act(() => result.current.setFilters({ search: 'keyword' }));

    expect(mockReplace).toHaveBeenCalledWith('/test?q=keyword', {
      scroll: false,
    });
  });

  it('deletes params when value is undefined', () => {
    mockSearchParams.value = new URLSearchParams('domain=Health');
    const { result } = renderHook(() => useUrlFilters(simpleConfig));

    act(() => result.current.setFilters({ domain: undefined }));

    expect(mockReplace).toHaveBeenCalledWith('/test', { scroll: false });
  });

  // -----------------------------------------------------------------------
  // Custom serialisers
  // -----------------------------------------------------------------------

  it('applies custom serialiser when writing', () => {
    interface ArrayFilter {
      tags?: string[];
    }

    const config: UrlFilterConfig<ArrayFilter> = {
      defaults: { tags: undefined },
      serialisers: {
        tags: (value) => {
          const arr = value as string[] | undefined;
          return arr?.length ? arr.join(',') : undefined;
        },
      },
    };

    const { result } = renderHook(() => useUrlFilters(config));

    act(() => result.current.setFilters({ tags: ['a', 'b'] }));

    expect(mockReplace).toHaveBeenCalledWith('/test?tags=a%2Cb', {
      scroll: false,
    });
  });

  // -----------------------------------------------------------------------
  // clearFilters
  // -----------------------------------------------------------------------

  it('clears all filters by navigating to bare pathname', () => {
    mockSearchParams.value = new URLSearchParams('q=test&domain=Health');
    const { result } = renderHook(() => useUrlFilters(simpleConfig));

    act(() => result.current.clearFilters());

    expect(mockReplace).toHaveBeenCalledWith('/test', { scroll: false });
  });

  // -----------------------------------------------------------------------
  // activeCount
  // -----------------------------------------------------------------------

  it('counts zero when no filters active', () => {
    const { result } = renderHook(() => useUrlFilters(simpleConfig));
    expect(result.current.activeCount).toBe(0);
  });

  it('counts active string filters', () => {
    mockSearchParams.value = new URLSearchParams(
      'q=hello&domain=Health&freshness=stale',
    );
    const { result } = renderHook(() => useUrlFilters(simpleConfig));
    expect(result.current.activeCount).toBe(3);
  });

  it('does not count empty string values', () => {
    mockSearchParams.value = new URLSearchParams('q=&domain=Health');
    const { result } = renderHook(() => useUrlFilters(simpleConfig));
    // 'q' is empty string => not counted; domain = Health => counted
    expect(result.current.activeCount).toBe(1);
  });

  it('counts boolean filters that differ from default', () => {
    interface BoolFilters {
      starred?: boolean;
      active?: boolean;
    }

    const config: UrlFilterConfig<BoolFilters> = {
      defaults: { starred: undefined, active: undefined },
      parsers: {
        starred: (raw) => raw === 'true',
        active: (raw) => raw === 'true',
      },
    };

    mockSearchParams.value = new URLSearchParams('starred=true');
    const { result } = renderHook(() => useUrlFilters(config));
    expect(result.current.activeCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('handles empty config defaults gracefully', () => {
    const { result } = renderHook(() => useUrlFilters({}));
    expect(result.current.filters).toEqual({});
    expect(result.current.activeCount).toBe(0);
  });

  it('preserves existing URL params when setting new filters', () => {
    mockSearchParams.value = new URLSearchParams('domain=Health');
    const { result } = renderHook(() => useUrlFilters(simpleConfig));

    act(() => result.current.setFilters({ search: 'test' }));

    // Should preserve domain=Health and add q=test
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('domain=Health'),
      { scroll: false },
    );
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('q=test'),
      { scroll: false },
    );
  });
});
