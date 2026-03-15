import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockToast, mockIsFeatureEnabled, mockWorkspaceResult, mockRelatedResult } =
  vi.hoisted(() => ({
    mockToast: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
    mockIsFeatureEnabled: vi.fn(() => false),
    mockWorkspaceResult: { data: null as unknown, error: null as unknown },
    mockRelatedResult: { data: null as unknown, error: null as unknown },
  }));

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('@/lib/validation/layer-schemas', () => ({
  getLayerLabel: (key: string) => key === 'strategic' ? 'Strategic' : key,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    /**
     * Return a chainable Supabase-like client. Every method returns the chain.
     * The chain is a PromiseLike (has .then) that resolves based on which
     * table was queried.
     */
    let tableName = '';

    const makeChain = (): Record<string, unknown> => {
      const chain: Record<string, unknown> = {};
      const chainMethods = ['select', 'eq', 'neq', 'order', 'limit'];
      for (const m of chainMethods) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.then = (onFulfilled?: (v: unknown) => unknown) => {
        if (tableName === 'content_item_workspaces') {
          return Promise.resolve(mockWorkspaceResult).then(onFulfilled);
        }
        if (tableName === 'content_items') {
          return Promise.resolve(mockRelatedResult).then(onFulfilled);
        }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled);
      };
      return chain;
    };

    return {
      from: vi.fn((table: string) => {
        tableName = table;
        return makeChain();
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  },
}));

import { useQAProvenance } from '@/hooks/use-qa-provenance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;

const DEFAULT_PARAMS = {
  itemId: 'item-1',
  isQAPair: true,
  metadata: { source_file: 'answers.docx' } as Record<string, unknown> | null,
  onMetadataUpdate: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useQAProvenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(false);

    // Default workspace query result
    mockWorkspaceResult.data = [
      {
        workspace_id: 'ws-1',
        workspaces: { id: 'ws-1', name: 'Bid Alpha', type: 'bid' },
      },
    ];
    mockWorkspaceResult.error = null;

    // Default related Q&A result
    mockRelatedResult.data = [
      { id: 'related-1', title: 'Related Question 1' },
      { id: 'related-2', title: 'Related Question 2' },
    ];
    mockRelatedResult.error = null;

    // Default fetch mock for layers API
    mockFetch = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/layers')) {
        return {
          ok: true,
          json: async () => ({
            layers: [
              { id: 'l-1', title: 'Layer Item', layer: 'strategic', content_type: 'article' },
            ],
          }),
        };
      }
      if (typeof url === 'string' && url.includes('/metadata')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Workspace fetch
  // -----------------------------------------------------------------------

  it('fetches workspaces for Q&A pair items', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(result.current.usedInWorkspaces).toHaveLength(1);
    });

    expect(result.current.usedInWorkspaces[0].name).toBe('Bid Alpha');
    expect(result.current.usedInWorkspaces[0].type).toBe('bid');
  });

  it('does not fetch workspaces when isQAPair is false', async () => {
    const { result } = renderHook(() =>
      useQAProvenance({ ...DEFAULT_PARAMS, isQAPair: false }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.usedInWorkspaces).toEqual([]);
  });

  it('filters out non-bid workspaces and null entries', async () => {
    mockWorkspaceResult.data = [
      {
        workspace_id: 'ws-1',
        workspaces: { id: 'ws-1', name: 'Bid Alpha', type: 'bid' },
      },
      {
        workspace_id: 'ws-2',
        workspaces: { id: 'ws-2', name: 'Project X', type: 'project' },
      },
      {
        workspace_id: 'ws-3',
        workspaces: null,
      },
    ];

    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(result.current.usedInWorkspaces).toHaveLength(1);
    });

    expect(result.current.usedInWorkspaces[0].name).toBe('Bid Alpha');
  });

  // -----------------------------------------------------------------------
  // Related Q&A
  // -----------------------------------------------------------------------

  it('fetches related Q&A pairs from the same source file', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(result.current.relatedQA).toHaveLength(2);
    });

    expect(result.current.relatedQA[0].title).toBe('Related Question 1');
  });

  it('does not fetch related Q&A when metadata has no source_file', async () => {
    const { result } = renderHook(() =>
      useQAProvenance({ ...DEFAULT_PARAMS, metadata: {} }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.relatedQA).toEqual([]);
  });

  it('does not fetch related Q&A when isQAPair is false', async () => {
    const { result } = renderHook(() =>
      useQAProvenance({ ...DEFAULT_PARAMS, isQAPair: false }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.relatedQA).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Topic layers (feature-gated)
  // -----------------------------------------------------------------------

  it('does not fetch layers when content_layers feature is disabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(false);

    renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await new Promise((r) => setTimeout(r, 50));
    // fetch should not have been called with /layers URL
    const layerCalls = mockFetch.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/layers'),
    );
    expect(layerCalls).toHaveLength(0);
  });

  it('fetches layers when content_layers feature is enabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);

    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(result.current.topicLayers).toHaveLength(1);
    });

    expect(result.current.topicLayers[0].layer).toBe('strategic');
    expect(mockFetch).toHaveBeenCalledWith('/api/items/item-1/layers');
  });

  it('handles layer fetch failure silently', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/layers')) {
        return { ok: false };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.topicLayers).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Inline layer editing — optimistic update + rollback
  // -----------------------------------------------------------------------

  it('performs optimistic update when changing layer', async () => {
    const onMetadataUpdate = vi.fn();
    const { result } = renderHook(() =>
      useQAProvenance({ ...DEFAULT_PARAMS, onMetadataUpdate }),
    );

    await act(async () => {
      await result.current.handleLayerChange('strategic');
    });

    // Should have called onMetadataUpdate with the optimistic value
    expect(onMetadataUpdate).toHaveBeenCalledWith(expect.any(Function));

    // Verify the updater function sets the layer
    const updater = onMetadataUpdate.mock.calls[0][0];
    const updated = updater({ existingKey: 'value' });
    expect(updated).toEqual({ existingKey: 'value', layer: 'strategic' });
  });

  it('removes layer key from metadata when setting to null', async () => {
    const onMetadataUpdate = vi.fn();
    const { result } = renderHook(() =>
      useQAProvenance({ ...DEFAULT_PARAMS, onMetadataUpdate }),
    );

    await act(async () => {
      await result.current.handleLayerChange(null);
    });

    const updater = onMetadataUpdate.mock.calls[0][0];
    const updated = updater({ existingKey: 'value', layer: 'old' });
    expect(updated).not.toHaveProperty('layer');
  });

  it('shows success toast after successful layer update', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await act(async () => {
      await result.current.handleLayerChange('strategic');
    });

    expect(mockToast.success).toHaveBeenCalledWith('Layer set to Strategic');
  });

  it('shows "Layer cleared" toast when setting layer to null', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await act(async () => {
      await result.current.handleLayerChange(null);
    });

    expect(mockToast.success).toHaveBeenCalledWith('Layer cleared');
  });

  it('rolls back on failed layer update and shows error toast', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onMetadataUpdate = vi.fn();
    const originalMetadata = { source_file: 'test.docx', layer: 'original' };

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/metadata')) {
        return { ok: false };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { result } = renderHook(() =>
      useQAProvenance({
        ...DEFAULT_PARAMS,
        metadata: originalMetadata,
        onMetadataUpdate,
      }),
    );

    await act(async () => {
      await result.current.handleLayerChange('strategic');
    });

    // Should have been called twice: once for optimistic, once for rollback
    expect(onMetadataUpdate).toHaveBeenCalledTimes(2);
    expect(mockToast.error).toHaveBeenCalledWith('Failed to update layer');

    consoleSpy.mockRestore();
  });

  it('sends PATCH request to metadata API', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS));

    await act(async () => {
      await result.current.handleLayerChange('strategic');
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/items/item-1/metadata', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'strategic' }),
    });
  });
});
