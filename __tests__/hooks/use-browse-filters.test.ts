import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { renderHook, act } from '@testing-library/react';

const mockPush = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/browse',
}));

import { useBrowseFilters } from '@/hooks/browse/use-browse-filters';

describe('useBrowseFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
  });

  // --- Reading filters ---

  it('returns default sort and order when no params', () => {
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.sort).toBe('captured_date');
    expect(result.current.filters.order).toBe('desc');
  });

  it('parses domain filter from comma-separated URL param', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate,Technical');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.domain).toEqual(['Corporate', 'Technical']);
  });

  it('parses content_type from "type" URL param', () => {
    currentSearchParams = new URLSearchParams('type=article,q_a_pair');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.content_type).toEqual(['article', 'q_a_pair']);
  });

  it('parses author from pipe-separated URL param', () => {
    currentSearchParams = new URLSearchParams('author=Alice|Bob');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.author).toEqual(['Alice', 'Bob']);
  });

  it('parses boolean starred filter', () => {
    currentSearchParams = new URLSearchParams('starred=true');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.starred).toBe(true);
  });

  it('parses date range filters', () => {
    currentSearchParams = new URLSearchParams('from=2026-01-01&to=2026-03-01');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.date_from).toBe('2026-01-01');
    expect(result.current.filters.date_to).toBe('2026-03-01');
  });

  it('parses freshness filter', () => {
    currentSearchParams = new URLSearchParams('freshness=stale,expired');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.freshness).toEqual(['stale', 'expired']);
  });

  // --- Active filter count ---

  it('counts zero active filters when no params', () => {
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('counts each domain value individually', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate,Technical');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.activeFilterCount).toBe(2);
  });

  it('counts mixed filters correctly', () => {
    currentSearchParams = new URLSearchParams(
      'domain=Corporate&type=article,q_a_pair&starred=true',
    );
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.activeFilterCount).toBe(4);
  });

  // --- Setting filters ---

  it('sets domain filter in URL', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.setFilters({ domain: ['Corporate'] }); });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('domain=Corporate'));
  });

  it('sets content_type as "type" URL param', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.setFilters({ content_type: ['article'] }); });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('type=article'));
  });

  it('removes cursor param on filter change', () => {
    currentSearchParams = new URLSearchParams('cursor=abc123&domain=Corporate');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.setFilters({ domain: ['Technical'] }); });
    const pushArg = mockPush.mock.calls[0][0] as string;
    expect(pushArg).not.toContain('cursor=');
  });

  it('clears subtopic when domain is cleared', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate&subtopic=history');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.setFilters({ domain: undefined }); });
    const pushArg = mockPush.mock.calls[0][0] as string;
    expect(pushArg).not.toContain('domain=');
    expect(pushArg).not.toContain('subtopic=');
  });

  // --- Clear and remove ---

  it('clearFilters navigates to bare pathname', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate&type=article');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.clearFilters(); });
    expect(mockPush).toHaveBeenCalledWith('/browse');
  });

  it('removeFilter clears a specific filter', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate&type=article');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.removeFilter('domain'); });
    const pushArg = mockPush.mock.calls[0][0] as string;
    expect(pushArg).not.toContain('domain=');
    expect(pushArg).toContain('type=article');
  });

  it('removeFilterValue removes a single value from array filter', () => {
    currentSearchParams = new URLSearchParams('domain=Corporate,Technical');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.removeFilterValue('domain', 'Corporate'); });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('domain=Technical'));
  });

  // --- Quality issues + include_qa auto-derivation ---

  it('auto-sets include_qa to true when quality_issues is active and include_qa is absent', () => {
    currentSearchParams = new URLSearchParams('quality_issues=true');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.quality_issues).toBe(true);
    expect(result.current.filters.include_qa).toBe(true);
  });

  it('respects explicit include_qa=false when quality_issues is active', () => {
    currentSearchParams = new URLSearchParams('quality_issues=true&include_qa=false');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.quality_issues).toBe(true);
    expect(result.current.filters.include_qa).toBeUndefined();
  });

  it('does not auto-set include_qa when quality_issues is absent', () => {
    currentSearchParams = new URLSearchParams();
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.filters.include_qa).toBeUndefined();
  });

  it('counts both quality_issues and auto-derived include_qa in active filter count', () => {
    currentSearchParams = new URLSearchParams('quality_issues=true');
    const { result } = renderHook(() => useBrowseFilters());
    // quality_issues = 1, include_qa (auto-derived) = 1
    expect(result.current.activeFilterCount).toBe(2);
  });

  // --- Search query (?q=) ---

  it('reads searchQuery from URL ?q= parameter', () => {
    currentSearchParams = new URLSearchParams('q=test+search');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.searchQuery).toBe('test search');
  });

  it('returns undefined searchQuery when ?q= is absent', () => {
    currentSearchParams = new URLSearchParams();
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.searchQuery).toBeUndefined();
  });

  it('counts search query in activeFilterCount', () => {
    currentSearchParams = new URLSearchParams('q=test');
    const { result } = renderHook(() => useBrowseFilters());
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('counts search query alongside other filters', () => {
    currentSearchParams = new URLSearchParams('q=test&domain=Corporate');
    const { result } = renderHook(() => useBrowseFilters());
    // 1 for search query + 1 for domain
    expect(result.current.activeFilterCount).toBe(2);
  });

  it('setSearchQuery sets ?q= in URL', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.setSearchQuery('semantic search'); });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('q=semantic+search'));
  });

  it('setSearchQuery clears ?q= when undefined', () => {
    currentSearchParams = new URLSearchParams('q=test');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.setSearchQuery(undefined); });
    const pushArg = mockPush.mock.calls[0][0] as string;
    expect(pushArg).not.toContain('q=');
  });

  it('clearSearchQuery removes ?q= from URL', () => {
    currentSearchParams = new URLSearchParams('q=test&domain=Corporate');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.clearSearchQuery(); });
    const pushArg = mockPush.mock.calls[0][0] as string;
    expect(pushArg).not.toContain('q=');
    expect(pushArg).toContain('domain=Corporate');
  });

  it('setSearchQuery removes cursor param', () => {
    currentSearchParams = new URLSearchParams('cursor=abc123');
    const { result } = renderHook(() => useBrowseFilters());
    act(() => { result.current.setSearchQuery('test'); });
    const pushArg = mockPush.mock.calls[0][0] as string;
    expect(pushArg).not.toContain('cursor=');
  });
});
