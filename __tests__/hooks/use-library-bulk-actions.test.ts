import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ContentListItem } from '@/types/content';

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
    ai_summary: null,
    primary_domain: 'Technical',
    primary_subtopic: null,
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
    ...overrides,
  };
}

function defaultParams(
  overrides: Partial<UseLibraryBulkActionsParams> = {},
): UseLibraryBulkActionsParams {
  return {
    items: [makeItem({ id: 'a1' }), makeItem({ id: 'a2' }), makeItem({ id: 'a3' })],
    filterDeps: [],
    onRefetch: vi.fn(),
    ...overrides,
  };
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
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.bulkOperating).toBe(false);
    expect(result.current.bulkProgress).toEqual({ current: 0, total: 0, label: '' });
    expect(result.current.tagDialogOpen).toBe(false);
    expect(result.current.assignDialogOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  it('toggleSelect adds and removes an item from selection', () => {
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.toggleSelect('a1'); });
    expect(result.current.selectedIds.has('a1')).toBe(true);
    expect(result.current.selectedIds.size).toBe(1);

    act(() => { result.current.toggleSelect('a1'); });
    expect(result.current.selectedIds.has('a1')).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('toggleSelectAll selects all items then deselects all', () => {
    const params = defaultParams();
    const { result } = renderHook(() => useLibraryBulkActions(params));

    act(() => { result.current.toggleSelectAll(); });
    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.selectedIds.has('a1')).toBe(true);
    expect(result.current.selectedIds.has('a2')).toBe(true);
    expect(result.current.selectedIds.has('a3')).toBe(true);

    act(() => { result.current.toggleSelectAll(); });
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('clearSelection empties the selection', () => {
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.toggleSelect('a2'); });
    expect(result.current.selectedIds.size).toBe(2);

    act(() => { result.current.clearSelection(); });
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('clears selection when filterDeps change', () => {
    let deps = ['domain=Technical'];
    const params = defaultParams({ filterDeps: deps });
    const { result, rerender } = renderHook(
      (props) => useLibraryBulkActions(props),
      { initialProps: params },
    );

    act(() => { result.current.toggleSelect('a1'); });
    expect(result.current.selectedIds.size).toBe(1);

    // Simulate filter change by re-rendering with new deps array
    deps = ['domain=Corporate'];
    rerender({ ...params, filterDeps: deps });
    expect(result.current.selectedIds.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Bulk delete
  // -------------------------------------------------------------------------

  it('handleBulkDelete calls DELETE for each selected item and shows success toast', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const onRefetch = vi.fn();
    const { result } = renderHook(() =>
      useLibraryBulkActions(defaultParams({ onRefetch })),
    );

    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.toggleSelect('a2'); });

    await act(async () => {
      await result.current.handleBulkDelete();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/items/a1', { method: 'DELETE' });
    expect(mockFetch).toHaveBeenCalledWith('/api/items/a2', { method: 'DELETE' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('Deleted 2 items');
    expect(onRefetch).toHaveBeenCalled();
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('handleBulkDelete shows error toast when some items fail', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.toggleSelect('a2'); });

    await act(async () => {
      await result.current.handleBulkDelete();
    });

    expect(toast.error).toHaveBeenCalledWith('1 item failed during deleting');
    // Success toast still fires with the count of successful items
    expect(toast.success).toHaveBeenCalledWith('Deleted 1 item');
  });

  // -------------------------------------------------------------------------
  // Bulk reclassify
  // -------------------------------------------------------------------------

  it('handleBulkReclassify posts to /api/items/:id/classify with force=true', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.toggleSelect('a1'); });

    await act(async () => {
      await result.current.handleBulkReclassify();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/items/a1/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    expect(toast.success).toHaveBeenCalledWith('Re-classified 1 item');
  });

  // -------------------------------------------------------------------------
  // Bulk tag
  // -------------------------------------------------------------------------

  it('handleBulkTagOpen resets tag input and opens dialog', () => {
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.setTagInput('leftover'); });
    act(() => { result.current.handleBulkTagOpen(); });

    expect(result.current.tagDialogOpen).toBe(true);
    expect(result.current.tagInput).toBe('');
  });

  it('handleBulkTagConfirm merges new tags with existing ones', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const items = [
      makeItem({ id: 'a1', user_tags: ['existing-tag'] }),
      makeItem({ id: 'a2', user_tags: null }),
    ];
    const { result } = renderHook(() =>
      useLibraryBulkActions(defaultParams({ items })),
    );

    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.toggleSelect('a2'); });
    act(() => { result.current.setTagInput('new-tag, another-tag'); });
    act(() => { result.current.handleBulkTagOpen(); });
    // Re-set tagInput since open resets it
    act(() => { result.current.setTagInput('new-tag, another-tag'); });

    await act(async () => {
      await result.current.handleBulkTagConfirm();
    });

    // Item a1 should merge existing + new
    const call1Body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(call1Body.field).toBe('user_tags');
    expect(call1Body.value).toEqual(
      expect.arrayContaining(['existing-tag', 'new-tag', 'another-tag']),
    );

    // Item a2 should get just the new tags
    const call2Body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(call2Body.value).toEqual(
      expect.arrayContaining(['new-tag', 'another-tag']),
    );

    expect(toast.success).toHaveBeenCalledWith(
      'Tagged 2 items with: new-tag, another-tag',
    );
  });

  it('handleBulkTagConfirm shows error when tags are empty', async () => {
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.setTagInput('   '); });

    await act(async () => {
      await result.current.handleBulkTagConfirm();
    });

    expect(toast.error).toHaveBeenCalledWith('Enter at least one tag');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Bulk assign (workspace)
  // -------------------------------------------------------------------------

  it('handleBulkAssignOpen fetches workspaces and opens dialog', async () => {
    const workspacesData = [
      { id: 'ws-1', name: 'KB Section A', type: 'kb_section' },
      { id: 'ws-2', name: 'Bid Workspace', type: 'bid' },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(workspacesData),
    });

    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    await act(async () => {
      await result.current.handleBulkAssignOpen();
    });

    expect(result.current.assignDialogOpen).toBe(true);
    expect(result.current.workspaces).toHaveLength(2);
    expect(result.current.workspaces[0]).toEqual({
      id: 'ws-1',
      name: 'KB Section A',
      type: 'kb_section',
    });
    expect(result.current.workspacesLoading).toBe(false);
  });

  it('handleBulkAssignConfirm shows error when no workspace is selected', async () => {
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    await act(async () => {
      await result.current.handleBulkAssignConfirm();
    });

    expect(toast.error).toHaveBeenCalledWith('Select a workspace');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handleBulkAssignConfirm posts to /api/items/:id/workspaces for each selected item', async () => {
    // First call: fetch workspaces for dialog open
    const workspacesData = [{ id: 'ws-1', name: 'Project X', type: 'project' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(workspacesData),
    });

    const onRefetch = vi.fn();
    const { result } = renderHook(() =>
      useLibraryBulkActions(defaultParams({ onRefetch })),
    );

    // Open assign dialog to load workspaces
    await act(async () => {
      await result.current.handleBulkAssignOpen();
    });

    // Select items and workspace
    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.setSelectedWorkspaceId('ws-1'); });

    // Now mock the assign API calls
    mockFetch.mockResolvedValue({ ok: true });

    await act(async () => {
      await result.current.handleBulkAssignConfirm();
    });

    // The assign call should be the second fetch call (first was workspaces)
    expect(mockFetch).toHaveBeenCalledWith('/api/items/a1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: 'ws-1', action: 'assign' }),
    });
    expect(toast.success).toHaveBeenCalledWith('Assigned 1 item to "Project X"');
    expect(onRefetch).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Bulk verify
  // -------------------------------------------------------------------------

  it('handleBulkVerify posts to /api/review/action for each selected item', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.toggleSelect('a3'); });

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
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    act(() => { result.current.toggleSelect('a1'); });
    act(() => { result.current.toggleSelect('a2'); });

    await act(async () => {
      await result.current.handleBulkDelete();
    });

    // 1 success + 1 error
    expect(toast.error).toHaveBeenCalledWith('1 item failed during deleting');
    expect(toast.success).toHaveBeenCalledWith('Deleted 1 item');
    // Selection is cleared after operation
    expect(result.current.selectedIds.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Workspace fetch error
  // -------------------------------------------------------------------------

  it('handleBulkAssignOpen shows error toast when workspace fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const { result } = renderHook(() => useLibraryBulkActions(defaultParams()));

    await act(async () => {
      await result.current.handleBulkAssignOpen();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to load workspaces');
    expect(result.current.workspacesLoading).toBe(false);
  });
});
