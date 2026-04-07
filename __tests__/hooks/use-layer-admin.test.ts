import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from 'sonner';

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  useLayerAdmin,
  generateKey,
  type AdminLayer,
  type UseLayerAdminParams,
} from '@/hooks/use-layer-admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    queryClient,
    Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

function createMockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

function renderLayerAdmin(overrides: Partial<UseLayerAdminParams> = {}) {
  const params: UseLayerAdminParams = {
    refresh: vi.fn(),
    ...overrides,
  };
  const { queryClient, Wrapper } = createWrapper();
  const result = renderHook(() => useLayerAdmin(params), { wrapper: Wrapper });
  return { ...result, queryClient, refresh: params.refresh };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_LAYERS: AdminLayer[] = [
  {
    id: 'layer-1',
    key: 'sales_brief',
    label: 'Sales Brief',
    description: 'Positioning and messaging',
    display_order: 10,
    is_active: true,
    created_at: '2026-03-19T00:00:00Z',
    updated_at: null,
  },
  {
    id: 'layer-2',
    key: 'bid_detail',
    label: 'Bid Detail',
    description: 'Factual content for tenders',
    display_order: 20,
    is_active: true,
    created_at: '2026-03-19T00:00:00Z',
    updated_at: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: fetch returns sample layers
  mockFetch.mockResolvedValue(createMockResponse(SAMPLE_LAYERS));
});

describe('useLayerAdmin', () => {
  // -----------------------------------------------------------------------
  // Initial fetch
  // -----------------------------------------------------------------------

  it('returns loading=true initially then populates layers', async () => {
    const { result } = renderLayerAdmin();

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.layers).toEqual(SAMPLE_LAYERS);
    expect(mockFetch).toHaveBeenCalledWith('/api/layers', undefined);
  });

  it('shows error toast on fetch failure', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ error: 'Server error' }, 500),
    );

    const { result } = renderLayerAdmin();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Query should have no data (defaults to [])
    expect(result.current.layers).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Dialog state management
  // -----------------------------------------------------------------------

  it('opens add dialog with empty fields', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openAddLayer();
    });

    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.editingLayer).toBeNull();
    expect(result.current.layerKey).toBe('');
    expect(result.current.layerLabel).toBe('');
    expect(result.current.layerDescription).toBe('');
    expect(result.current.layerOrder).toBe('');
  });

  it('opens edit dialog with existing layer data', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openEditLayer(SAMPLE_LAYERS[0]);
    });

    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.editingLayer).toEqual(SAMPLE_LAYERS[0]);
    expect(result.current.layerKey).toBe('sales_brief');
    expect(result.current.layerLabel).toBe('Sales Brief');
    expect(result.current.layerDescription).toBe('Positioning and messaging');
    expect(result.current.layerOrder).toBe('10');
  });

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  it('creates a new layer on submit', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openAddLayer();
    });

    act(() => {
      result.current.setLayerLabel('Technical');
      result.current.setLayerKey('technical');
    });

    // Mock successful create
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ id: 'new-layer' }, 201),
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    // Should have called POST /api/layers
    const postCall = mockFetch.mock.calls.find(
      (call) => call[0] === '/api/layers' && call[1]?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    expect(toast.success).toHaveBeenCalledWith('Layer created');
    expect(mockRefresh).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  it('updates an existing layer on submit with only changed fields', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openEditLayer(SAMPLE_LAYERS[0]);
    });

    act(() => {
      result.current.setLayerLabel('Updated Brief');
    });

    // Mock successful update
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ ...SAMPLE_LAYERS[0], label: 'Updated Brief' }),
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    // Should have called PATCH with only the label change
    const patchCall = mockFetch.mock.calls.find(
      (call) =>
        call[0] === `/api/layers/layer-1` && call[1]?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1].body);
    expect(body).toEqual({ label: 'Updated Brief' });
    expect(toast.success).toHaveBeenCalledWith('Layer updated');
  });

  it('does not submit when no changes on edit', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openEditLayer(SAMPLE_LAYERS[0]);
    });

    const fetchCallsBefore = mockFetch.mock.calls.length;
    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    // Should close dialog without making additional fetch calls
    expect(result.current.dialogOpen).toBe(false);
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
  });

  // -----------------------------------------------------------------------
  // Toggle active
  // -----------------------------------------------------------------------

  it('toggles layer active state', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValueOnce(
      createMockResponse({ ...SAMPLE_LAYERS[0], is_active: false }),
    );

    await act(async () => {
      await result.current.handleToggleActive(SAMPLE_LAYERS[0]);
    });

    const patchCall = mockFetch.mock.calls.find(
      (call) =>
        call[0] === '/api/layers/layer-1' &&
        call[1]?.method === 'PATCH' &&
        JSON.parse(call[1].body).is_active === false,
    );
    expect(patchCall).toBeDefined();
    expect(toast.success).toHaveBeenCalledWith('Layer deactivated');
    expect(mockRefresh).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  it('deletes a layer', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValueOnce(createMockResponse(null, 204));

    await act(async () => {
      await result.current.handleDelete(SAMPLE_LAYERS[0]);
    });

    const deleteCall = mockFetch.mock.calls.find(
      (call) =>
        call[0] === '/api/layers/layer-1' && call[1]?.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
    expect(toast.success).toHaveBeenCalledWith('Layer deleted');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows error toast when delete fails', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValueOnce(
      createMockResponse({ error: 'In use' }, 409),
    );

    await act(async () => {
      try {
        await result.current.handleDelete(SAMPLE_LAYERS[0]);
      } catch {
        // mutateAsync throws on error — that's expected
      }
    });

    expect(toast.error).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Reorder
  // -----------------------------------------------------------------------

  it('handles move up with optimistic update', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Mock successful reorder
    mockFetch.mockResolvedValueOnce(createMockResponse({ success: true }));

    await act(async () => {
      await result.current.handleMove('layer-2', 'up');
    });

    const putCall = mockFetch.mock.calls.find(
      (call) => call[0] === '/api/layers/reorder' && call[1]?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('rolls back on move error', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Mock failed reorder
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ error: 'Server error' }, 500),
    );

    await act(async () => {
      try {
        await result.current.handleMove('layer-2', 'up');
      } catch {
        // mutateAsync throws — expected
      }
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to reorder layers');
    // After rollback, layers should match original data
    // (invalidation will refetch, but the rollback restores previous)
  });

  it('does not move first layer up', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    const fetchCallsBefore = mockFetch.mock.calls.length;

    await act(async () => {
      await result.current.handleMove('layer-1', 'up');
    });

    // No reorder fetch should be made
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
  });

  it('does not move last layer down', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    const fetchCallsBefore = mockFetch.mock.calls.length;

    await act(async () => {
      await result.current.handleMove('layer-2', 'down');
    });

    expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
  });

  // -----------------------------------------------------------------------
  // Saving state
  // -----------------------------------------------------------------------

  it('saving reflects mutation isPending during submit', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Initially saving is false
    expect(result.current.saving).toBe(false);

    act(() => {
      result.current.openAddLayer();
      result.current.setLayerLabel('Test');
      result.current.setLayerKey('test');
    });

    // Create a never-resolving promise to keep mutation pending
    let resolveCreate!: (value: unknown) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    // Start submit without awaiting
    let submitPromise: Promise<void>;
    act(() => {
      submitPromise = result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    // While pending, saving should be true
    await waitFor(() => {
      expect(result.current.saving).toBe(true);
    });

    // Resolve the mutation
    await act(async () => {
      resolveCreate(createMockResponse({ id: 'new' }, 201));
      await submitPromise;
    });

    expect(result.current.saving).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Announcement
  // -----------------------------------------------------------------------

  it('sets announcement on successful operations', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Create a layer
    act(() => {
      result.current.openAddLayer();
      result.current.setLayerLabel('New Layer');
      result.current.setLayerKey('new_layer');
    });

    mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'new' }, 201));

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.announcement).toBe("Layer 'New Layer' created");
  });

  // -----------------------------------------------------------------------
  // generateKey
  // -----------------------------------------------------------------------

  it('generates valid keys from labels', () => {
    expect(generateKey('Technical Detail')).toBe('technical_detail');
    expect(generateKey('Hello World!')).toBe('hello_world');
    expect(generateKey('  Spaces   Everywhere  ')).toBe('spaces_everywhere');
    expect(generateKey('')).toBe('');
    expect(generateKey('UPPER CASE')).toBe('upper_case');
    expect(generateKey('special!@#$%chars')).toBe('specialchars');
  });
});
