import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRouter, mockSearchParamsStore } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  },
  mockSearchParamsStore: { current: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParamsStore.current,
  usePathname: () => '/qa-library',
}));

import { useLibraryFilters } from '@/hooks/browse/use-library-filters';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLibraryFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsStore.current = new URLSearchParams();
  });

  // -------------------------------------------------------------------------
  // Parse from URL
  // -------------------------------------------------------------------------

  it('returns empty filters when URL has no params', () => {
    const { result } = renderHook(() => useLibraryFilters());

    expect(result.current.filters.domain).toBeUndefined();
    expect(result.current.filters.source_file).toBeUndefined();
    expect(result.current.filters.variant).toBeUndefined();
    expect(result.current.filters.search).toBeUndefined();
    expect(result.current.filters.freshness).toBeUndefined();
    expect(result.current.filters.verified).toBeUndefined();
    expect(result.current.activeCount).toBe(0);
  });

  it('parses filters from URL search params', () => {
    mockSearchParamsStore.current = new URLSearchParams(
      'domain=security&source=file.docx&variant=both&q=test&freshness=stale&verified=verified',
    );

    const { result } = renderHook(() => useLibraryFilters());

    expect(result.current.filters.domain).toBe('security');
    expect(result.current.filters.source_file).toBe('file.docx');
    expect(result.current.filters.variant).toBe('both');
    expect(result.current.filters.search).toBe('test');
    expect(result.current.filters.freshness).toBe('stale');
    expect(result.current.filters.verified).toBe('verified');
    expect(result.current.activeCount).toBe(6);
  });

  // -------------------------------------------------------------------------
  // setFilters
  // -------------------------------------------------------------------------

  it('sets filters and updates URL params', () => {
    const { result } = renderHook(() => useLibraryFilters());

    act(() => {
      result.current.setFilters({ domain: 'governance', search: 'policy' });
    });

    expect(mockRouter.replace).toHaveBeenCalledWith(
      '/qa-library?domain=governance&q=policy',
      { scroll: false },
    );
  });

  it('maps source_file to "source" param and search to "q" param', () => {
    const { result } = renderHook(() => useLibraryFilters());

    act(() => {
      result.current.setFilters({
        source_file: 'tender.docx',
        search: 'approach',
      });
    });

    const url = mockRouter.replace.mock.calls[0][0] as string;
    expect(url).toContain('source=tender.docx');
    expect(url).toContain('q=approach');
    expect(url).not.toContain('source_file');
    expect(url).not.toContain('search=');
  });

  it('removes params when value is falsy', () => {
    mockSearchParamsStore.current = new URLSearchParams(
      'domain=security&q=test',
    );
    const { result } = renderHook(() => useLibraryFilters());

    act(() => {
      result.current.setFilters({ domain: undefined });
    });

    const url = mockRouter.replace.mock.calls[0][0] as string;
    expect(url).not.toContain('domain');
    expect(url).toContain('q=test');
  });

  // -------------------------------------------------------------------------
  // clearFilters
  // -------------------------------------------------------------------------

  it('clears all filters', () => {
    mockSearchParamsStore.current = new URLSearchParams(
      'domain=security&q=test',
    );
    const { result } = renderHook(() => useLibraryFilters());

    act(() => {
      result.current.clearFilters();
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/qa-library', {
      scroll: false,
    });
  });

  // -------------------------------------------------------------------------
  // groupBy
  // -------------------------------------------------------------------------

  it('defaults groupBy to "none"', () => {
    const { result } = renderHook(() => useLibraryFilters());
    expect(result.current.groupBy).toBe('none');
  });

  it('reads groupBy from URL params', () => {
    mockSearchParamsStore.current = new URLSearchParams('group=source');
    const { result } = renderHook(() => useLibraryFilters());
    expect(result.current.groupBy).toBe('source');
  });

  it('setGroupBy updates URL and removes param for "none"', () => {
    mockSearchParamsStore.current = new URLSearchParams('group=domain');
    const { result } = renderHook(() => useLibraryFilters());

    act(() => {
      result.current.setGroupBy('none');
    });

    const url = mockRouter.replace.mock.calls[0][0] as string;
    expect(url).not.toContain('group');
  });
});
