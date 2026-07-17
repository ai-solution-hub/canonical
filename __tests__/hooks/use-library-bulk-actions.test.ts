import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ContentListItem } from '@/types/content';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from 'sonner';
import {
  useLibraryBulkActions,
  type UseLibraryBulkActionsParams,
} from '@/hooks/use-library-bulk-actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: overrides.id ?? 'item-1',
    title: 'Test Item',
    suggested_title: null,
    summary: null,
    primary_domain: 'Technical',
    primary_subtopic: 'unclassified',
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: null,
    classification_confidence: 0.9,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    publication_status: null,
    ...overrides,
  };
}

function defaultParams(
  overrides: Partial<UseLibraryBulkActionsParams> = {},
): UseLibraryBulkActionsParams {
  return {
    items: [
      makeItem({ id: 'a1' }),
      makeItem({ id: 'a2' }),
      makeItem({ id: 'a3' }),
    ],
    filterDeps: [],
    ...overrides,
  };
}

/** Wrapper providing TanStack Query context for hook tests */
function hookWrapper() {
  const { Wrapper } = createQueryWrapper();
  return { wrapper: Wrapper };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLibraryBulkActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('returns empty selection and idle progress on mount', () => {
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.bulkOperating).toBe(false);
    expect(result.current.bulkProgress).toEqual({
      current: 0,
      total: 0,
      label: '',
    });
  });

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  it('toggleSelect adds and removes an item from selection', () => {
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    expect(result.current.selectedIds.has('a1')).toBe(true);
    expect(result.current.selectedIds.size).toBe(1);

    act(() => {
      result.current.toggleSelect('a1');
    });
    expect(result.current.selectedIds.has('a1')).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('toggleSelectAll selects all items then deselects all', () => {
    const params = defaultParams();
    const { result } = renderHook(
      () => useLibraryBulkActions(params),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelectAll();
    });
    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.selectedIds.has('a1')).toBe(true);
    expect(result.current.selectedIds.has('a2')).toBe(true);
    expect(result.current.selectedIds.has('a3')).toBe(true);

    act(() => {
      result.current.toggleSelectAll();
    });
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('clearSelection empties the selection', () => {
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    act(() => {
      result.current.toggleSelect('a2');
    });
    expect(result.current.selectedIds.size).toBe(2);

    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('clears selection when filterDeps change', () => {
    let deps = ['domain=Technical'];
    const params = defaultParams({ filterDeps: deps });
    const { wrapper } = hookWrapper();
    const { result, rerender } = renderHook(
      (props) => useLibraryBulkActions(props),
      { initialProps: params, wrapper },
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    expect(result.current.selectedIds.size).toBe(1);

    // Simulate filter change by re-rendering with new deps array
    deps = ['domain=Corporate'];
    rerender({ ...params, filterDeps: deps });
    expect(result.current.selectedIds.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Bulk verify
  // -------------------------------------------------------------------------

  it('handleBulkVerify posts to /api/review/action for each selected item', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    act(() => {
      result.current.toggleSelect('a3');
    });

    await act(async () => {
      await result.current.handleBulkVerify();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: 'a1', action: 'verify' }),
    });
    expect(mockFetch).toHaveBeenCalledWith('/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: 'a3', action: 'verify' }),
    });
    expect(toast.success).toHaveBeenCalledWith('Verified 2 items');
  });

  // -------------------------------------------------------------------------
  // Error handling: fetch throws
  // -------------------------------------------------------------------------

  it('handles fetch exceptions gracefully and reports errors', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    act(() => {
      result.current.toggleSelect('a2');
    });

    await act(async () => {
      await result.current.handleBulkVerify();
    });

    // 1 success + 1 error
    expect(toast.error).toHaveBeenCalledWith('1 item failed during verifying');
    expect(toast.success).toHaveBeenCalledWith('Verified 1 item');
    // Selection is cleared after operation
    expect(result.current.selectedIds.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Double-toast regression guard (ID-145 {145.35}): when EVERY operation in
  // the batch fails, only the runner's own error toast should fire — no
  // "Verified/Deleted 0 items" success toast alongside it.
  // -------------------------------------------------------------------------

  it('does not show a bogus success toast when every verify operation fails', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });

    await act(async () => {
      await result.current.handleBulkVerify();
    });

    expect(toast.error).toHaveBeenCalledWith('1 item failed during verifying');
    expect(toast.success).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Bulk assign-to-engagement-group (ID-145 {145.35} — BI-33 owner ruling,
  // S479: remodelled off the retired PATCH /api/q-a-pairs/[id]/workspace
  // route, which q_a_pairs.source_workspace_id being dropped system-wide
  // permanently 410s. Rebinds onto the group-side batch endpoint, POST
  // /api/engagement-groups/[id]/content — ONE call carrying every selected
  // id, not a per-id loop.)
  // -------------------------------------------------------------------------

  it('handleBulkAssignOpen fetches /api/engagement-groups and opens the assign dialog', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'eg-1', name: 'Alpha Tender' },
        { id: 'eg-2', name: 'Beta ITT' },
      ],
    });
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    await act(async () => {
      await result.current.handleBulkAssignOpen();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/engagement-groups');
    expect(result.current.assignDialogOpen).toBe(true);
    expect(result.current.engagementGroups).toEqual([
      { id: 'eg-1', name: 'Alpha Tender' },
      { id: 'eg-2', name: 'Beta ITT' },
    ]);
    expect(result.current.engagementGroupsLoading).toBe(false);
  });

  it('handleBulkAssignConfirm POSTs the whole selected batch to /api/engagement-groups/:id/content in ONE call', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    act(() => {
      result.current.toggleSelect('a2');
    });
    act(() => {
      result.current.setSelectedEngagementGroupId('eg-1');
    });

    await act(async () => {
      await result.current.handleBulkAssignConfirm();
    });

    // Group-side batch grain: exactly ONE POST carrying every selected id —
    // not one call per item (the old per-id PATCH loop).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/engagement-groups/eg-1/content',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q_a_pair_ids: ['a1', 'a2'] }),
      },
    );
    expect(result.current.assignDialogOpen).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(
      'Assigned 2 items to an engagement group',
    );
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('handleBulkAssignConfirm rejects with no engagement group selected', async () => {
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });

    await act(async () => {
      await result.current.handleBulkAssignConfirm();
    });

    expect(toast.error).toHaveBeenCalledWith('Select an engagement group');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not show a bogus success toast when the batch assign call fails outright (double-toast regression)', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    act(() => {
      result.current.setSelectedEngagementGroupId('eg-1');
    });

    await act(async () => {
      await result.current.handleBulkAssignConfirm();
    });

    expect(toast.error).toHaveBeenCalledWith('1 item failed during assigning');
    expect(toast.success).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Bulk delete (ID-135 {135.22} — hard DELETE against q_a_pairs, admin only
  // at the route; the route itself enforces the role gate)
  // -------------------------------------------------------------------------

  it('handleBulkDelete calls DELETE app/api/q-a-pairs/:id for each selected item', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    act(() => {
      result.current.toggleSelect('a1');
    });
    act(() => {
      result.current.toggleSelect('a2');
    });

    await act(async () => {
      await result.current.handleBulkDelete();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/q-a-pairs/a1', {
      method: 'DELETE',
    });
    expect(mockFetch).toHaveBeenCalledWith('/api/q-a-pairs/a2', {
      method: 'DELETE',
    });
    expect(toast.success).toHaveBeenCalledWith('Deleted 2 items');
  });

  // -------------------------------------------------------------------------
  // Retired affordances stay retired (ID-139 {139.9} / bl-405 precedent —
  // Reclassify/Tag have no valid backing model on q_a_pairs: no domain/
  // subtopic classification columns and no free-tag column exist; scope_tag/
  // anti_scope_tag are a distinct ontology-matching concern, not a
  // repurposable user-tag field)
  // -------------------------------------------------------------------------

  it('does not resurrect handleBulkReclassify or handleBulkTagConfirm', () => {
    const { result } = renderHook(
      () => useLibraryBulkActions(defaultParams()),
      hookWrapper(),
    );

    expect('handleBulkReclassify' in result.current).toBe(false);
    expect('handleBulkTagConfirm' in result.current).toBe(false);
  });
});
