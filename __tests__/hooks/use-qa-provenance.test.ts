import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockToast, mockIsFeatureEnabled, mockRelatedResult, mockFromCalls } =
  vi.hoisted(() => ({
    mockToast: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
    mockIsFeatureEnabled: vi.fn(() => false),
    mockRelatedResult: { data: null as unknown, error: null as unknown },
    // Tracks every `.from(<table>)` call across ALL createClient() instances —
    // ID-131 {131.21} asserts the related-Q&A query never reads content_items;
    // ID-131.19 asserts the workspace query never reads
    // content_item_workspaces (dropped at M6 — see hooks/use-qa-provenance.ts
    // Query 1, stubbed to an always-empty result, {135.22} rebind owner).
    mockFromCalls: [] as string[],
  }));

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: (...args: unknown[]) =>
    (mockIsFeatureEnabled as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('@/lib/validation/layer-schemas', () => ({
  getLayerLabel: (key: string) => (key === 'strategic' ? 'Strategic' : key),
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
        // ID-131 {131.21}: the related-Q&A query is re-pointed off
        // content_items onto q_a_pairs.
        if (tableName === 'q_a_pairs') {
          return Promise.resolve(mockRelatedResult).then(onFulfilled);
        }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled);
      };
      return chain;
    };

    return {
      from: vi.fn((table: string) => {
        tableName = table;
        mockFromCalls.push(table);
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
  sourceFile: 'answers.docx',
  metadata: { source_file: 'answers.docx' } as Record<string, unknown> | null,
  onMetadataUpdate: vi.fn(),
};

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useQAProvenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromCalls.length = 0;
    mockIsFeatureEnabled.mockReturnValue(false);

    // Default related Q&A result — q_a_pairs row shape (ID-131 {131.21}):
    // the hook maps question_text -> the returned `title` field.
    mockRelatedResult.data = [
      { id: 'related-1', question_text: 'Related Question 1' },
      { id: 'related-2', question_text: 'Related Question 2' },
    ];
    mockRelatedResult.error = null;

    // Default fetch mock for layers API
    mockFetch = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/layers')) {
        return {
          ok: true,
          json: async () => ({
            layers: [
              {
                id: 'l-1',
                title: 'Layer Item',
                layer: 'strategic',
                content_type: 'article',
              },
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
  // Workspace fetch — ID-131.19 (M6, S450 GO tail): content_item_workspaces
  // dropped; Query 1 is stubbed to an always-empty result ({135.22} rebind
  // owner) rather than rebuilt, since this hook has no production caller.
  // -----------------------------------------------------------------------

  it('always returns an empty usedInWorkspaces (content_item_workspaces retired)', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.relatedQA.length).toBeGreaterThan(0);
    });
    expect(result.current.usedInWorkspaces).toEqual([]);
  });

  it('never queries content_item_workspaces (ID-131.19 trim)', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.relatedQA.length).toBeGreaterThan(0);
    });
    expect(mockFromCalls).not.toContain('content_item_workspaces');
  });

  it('does not fetch workspaces when isQAPair is false', async () => {
    const { result } = renderHook(
      () => useQAProvenance({ ...DEFAULT_PARAMS, isQAPair: false }),
      { wrapper: createWrapper() },
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.usedInWorkspaces).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Related Q&A
  // -----------------------------------------------------------------------

  it('fetches related Q&A pairs from the same source file', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.relatedQA).toHaveLength(2);
    });

    expect(result.current.relatedQA[0].title).toBe('Related Question 1');
  });

  it('queries q_a_pairs for related Q&A, never content_items (ID-131 {131.21})', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.relatedQA).toHaveLength(2);
    });

    expect(mockFromCalls).toContain('q_a_pairs');
    expect(mockFromCalls).not.toContain('content_items');
  });

  it('does not fetch related Q&A when no source_file available', async () => {
    const { result } = renderHook(
      () =>
        useQAProvenance({ ...DEFAULT_PARAMS, sourceFile: null, metadata: {} }),
      { wrapper: createWrapper() },
    );

    // waitFor drains the TanStack Query enable-check + any setState so the
    // asserted state lands inside an act boundary, not after teardown.
    await waitFor(() => {
      expect(result.current.relatedQA).toEqual([]);
    });
  });

  it('does not fetch related Q&A when isQAPair is false', async () => {
    const { result } = renderHook(
      () => useQAProvenance({ ...DEFAULT_PARAMS, isQAPair: false }),
      { wrapper: createWrapper() },
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.relatedQA).toEqual([]);
  });

  it('falls back to metadata.source_file when sourceFile prop is null', async () => {
    const { result } = renderHook(
      () =>
        useQAProvenance({
          ...DEFAULT_PARAMS,
          sourceFile: null,
          metadata: { source_file: 'fallback.docx' },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.relatedQA).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Topic layers (feature-gated)
  // -----------------------------------------------------------------------

  it('does not fetch layers when content_layers feature is disabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(false);

    renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

    // waitFor drains the TanStack Query enable-check + any setState so the
    // asserted state lands inside an act boundary, not after teardown.
    await waitFor(() => {
      // fetch should not have been called with /layers URL
      const layerCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).includes('/layers'),
      );
      expect(layerCalls).toHaveLength(0);
    });
  });

  it('fetches layers when content_layers feature is enabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(true);

    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

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

    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

    // waitFor drains the TanStack Query enable-check + any setState so the
    // asserted state lands inside an act boundary, not after teardown.
    await waitFor(() => {
      expect(result.current.topicLayers).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Inline layer editing -- optimistic update + rollback
  // -----------------------------------------------------------------------

  it('performs optimistic update when changing layer', async () => {
    const onMetadataUpdate = vi.fn();
    const { result } = renderHook(
      () => useQAProvenance({ ...DEFAULT_PARAMS, onMetadataUpdate }),
      { wrapper: createWrapper() },
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
    const { result } = renderHook(
      () => useQAProvenance({ ...DEFAULT_PARAMS, onMetadataUpdate }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.handleLayerChange(null);
    });

    const updater = onMetadataUpdate.mock.calls[0][0];
    const updated = updater({ existingKey: 'value', layer: 'old' });
    expect(updated).not.toHaveProperty('layer');
  });

  it('shows success toast after successful layer update', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.handleLayerChange('strategic');
    });

    expect(mockToast.success).toHaveBeenCalledWith('Layer set to Strategic');
  });

  it('shows "Layer cleared" toast when setting layer to null', async () => {
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

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

    const { result } = renderHook(
      () =>
        useQAProvenance({
          ...DEFAULT_PARAMS,
          metadata: originalMetadata,
          onMetadataUpdate,
        }),
      { wrapper: createWrapper() },
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
    const { result } = renderHook(() => useQAProvenance(DEFAULT_PARAMS), {
      wrapper: createWrapper(),
    });

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
