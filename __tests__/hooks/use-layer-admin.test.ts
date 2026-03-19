import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLayerAdmin, type AdminLayer, type UseLayerAdminParams } from '@/hooks/use-layer-admin';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const { mockToast, mockFetch } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  mockFetch: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

// Assign mock fetch to global
global.fetch = mockFetch;

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
// Helpers
// ---------------------------------------------------------------------------

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
  return renderHook(() => useLayerAdmin(params));
}

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

  it('loads layers on mount', async () => {
    const { result } = renderLayerAdmin();

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.layers).toEqual(SAMPLE_LAYERS);
    expect(mockFetch).toHaveBeenCalledWith('/api/layers');
  });

  it('shows error toast on fetch failure', async () => {
    mockFetch.mockResolvedValue(createMockResponse({ error: 'Server error' }, 500));

    const { result } = renderLayerAdmin();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockToast.error).toHaveBeenCalled();
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

    // Open add dialog
    act(() => {
      result.current.openAddLayer();
    });

    // Set form fields
    act(() => {
      result.current.setLayerLabel('Technical');
      result.current.setLayerKey('technical');
    });

    // Mock successful create
    mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'new-layer' }, 201));
    // Mock re-fetch after create
    mockFetch.mockResolvedValueOnce(createMockResponse(SAMPLE_LAYERS));

    // Submit
    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/layers', expect.objectContaining({
      method: 'POST',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Layer created');
    expect(mockRefresh).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  it('updates an existing layer on submit', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Open edit dialog
    act(() => {
      result.current.openEditLayer(SAMPLE_LAYERS[0]);
    });

    // Change label
    act(() => {
      result.current.setLayerLabel('Updated Brief');
    });

    // Mock successful update
    mockFetch.mockResolvedValueOnce(createMockResponse({ ...SAMPLE_LAYERS[0], label: 'Updated Brief' }));
    // Mock re-fetch
    mockFetch.mockResolvedValueOnce(createMockResponse(SAMPLE_LAYERS));

    // Submit
    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/layers/layer-1', expect.objectContaining({
      method: 'PATCH',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Layer updated');
  });

  it('does not submit when no changes on edit', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Open edit dialog with existing data
    act(() => {
      result.current.openEditLayer(SAMPLE_LAYERS[0]);
    });

    // Submit without changes
    const fetchCallsBefore = mockFetch.mock.calls.length;
    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    // Should close dialog without making additional fetch calls
    expect(result.current.dialogOpen).toBe(false);
    // Only the initial fetch should have happened
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
  });

  // -----------------------------------------------------------------------
  // Toggle active
  // -----------------------------------------------------------------------

  it('toggles layer active state', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValueOnce(createMockResponse({ ...SAMPLE_LAYERS[0], is_active: false }));
    mockFetch.mockResolvedValueOnce(createMockResponse(SAMPLE_LAYERS));

    await act(async () => {
      await result.current.handleToggleActive(SAMPLE_LAYERS[0]);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/layers/layer-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Layer deactivated');
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
    mockFetch.mockResolvedValueOnce(createMockResponse(SAMPLE_LAYERS));

    await act(async () => {
      await result.current.handleDelete(SAMPLE_LAYERS[0]);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/layers/layer-1', expect.objectContaining({
      method: 'DELETE',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Layer deleted');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows error toast when delete fails', async () => {
    const { result } = renderLayerAdmin();

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'In use' }, 409));

    await act(async () => {
      await result.current.handleDelete(SAMPLE_LAYERS[0]);
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Reorder
  // -----------------------------------------------------------------------

  it('handles move up with optimistic update', async () => {
    const mockRefresh = vi.fn();
    const { result } = renderLayerAdmin({ refresh: mockRefresh });

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValueOnce(createMockResponse({ success: true }));

    await act(async () => {
      await result.current.handleMove('layer-2', 'up');
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/layers/reorder', expect.objectContaining({
      method: 'PUT',
    }));
    expect(mockRefresh).toHaveBeenCalled();
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
});
