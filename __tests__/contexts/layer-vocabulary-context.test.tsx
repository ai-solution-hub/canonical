import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockFrom = vi.fn();

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/client-config', () => ({
  FALLBACK_LAYERS: [
    { key: 'sales_brief', label: 'Sales Brief', description: 'Positioning', order: 1 },
    { key: 'bid_detail', label: 'Bid Detail', description: 'Factual content', order: 2 },
    { key: 'company_reference', label: 'Company Reference', description: 'Corporate docs', order: 3 },
    { key: 'research', label: 'Research', description: 'Background material', order: 4 },
  ],
}));

// Import AFTER mocks
import {
  LayerVocabularyProvider,
  useLayerVocabulary,
} from '@/contexts/layer-vocabulary-context';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const DB_LAYERS = [
  {
    id: 'layer-1',
    key: 'sales_brief',
    label: 'Sales Brief',
    description: 'Positioning and messaging',
    display_order: 10,
    is_active: true,
  },
  {
    id: 'layer-2',
    key: 'bid_detail',
    label: 'Bid Detail',
    description: 'Factual content for tenders',
    display_order: 20,
    is_active: true,
  },
  {
    id: 'layer-3',
    key: 'company_reference',
    label: 'Company Reference',
    description: 'Controlled corporate documents',
    display_order: 30,
    is_active: true,
  },
  {
    id: 'layer-4',
    key: 'research',
    label: 'Research',
    description: 'Background material and market intelligence',
    display_order: 40,
    is_active: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMockSupabase(data: unknown[] | null = DB_LAYERS, error: unknown = null) {
  mockOrder.mockReturnValue(
    Promise.resolve({ data, error }),
  );
  mockEq.mockReturnValue({ order: mockOrder });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
  mockCreateClient.mockReturnValue({ from: mockFrom });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <LayerVocabularyProvider>{children}</LayerVocabularyProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setupMockSupabase();
});

describe('LayerVocabularyProvider', () => {
  it('fetches layers from DB and provides them via context', async () => {
    const { result } = renderHook(() => useLayerVocabulary(), { wrapper });

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.layers).toEqual(DB_LAYERS);
    expect(result.current.error).toBeNull();
  });

  it('provides getLayerKeys helper', async () => {
    const { result } = renderHook(() => useLayerVocabulary(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const keys = result.current.getLayerKeys();
    expect(keys).toEqual(['sales_brief', 'bid_detail', 'company_reference', 'research']);
  });

  it('provides getLayerLabel helper', async () => {
    const { result } = renderHook(() => useLayerVocabulary(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getLayerLabel('sales_brief')).toBe('Sales Brief');
    expect(result.current.getLayerLabel('bid_detail')).toBe('Bid Detail');
    expect(result.current.getLayerLabel('unknown_key')).toBe('unknown_key');
  });

  it('provides getLayerDescription helper', async () => {
    const { result } = renderHook(() => useLayerVocabulary(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getLayerDescription('sales_brief')).toBe('Positioning and messaging');
    expect(result.current.getLayerDescription('unknown_key')).toBeNull();
  });

  it('falls back to static layers on DB error', async () => {
    setupMockSupabase(null, { message: 'permission denied' });

    const { result } = renderHook(() => useLayerVocabulary(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should use fallback layers
    expect(result.current.layers.length).toBe(4);
    expect(result.current.layers[0].key).toBe('sales_brief');
    // Fallback layers get synthetic IDs
    expect(result.current.layers[0].id).toMatch(/^fallback-/);
    // Error should be null (silent fallback)
    expect(result.current.error).toBeNull();
  });

  it('falls back to static layers on fetch exception', async () => {
    mockOrder.mockRejectedValue(new Error('Network error'));
    mockEq.mockReturnValue({ order: mockOrder });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
    mockCreateClient.mockReturnValue({ from: mockFrom });

    const { result } = renderHook(() => useLayerVocabulary(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.layers.length).toBe(4);
    expect(result.current.error).toBeNull();
  });
});

describe('useLayerVocabulary', () => {
  it('throws when used outside provider', () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useLayerVocabulary());
    }).toThrow('useLayerVocabulary must be used within LayerVocabularyProvider');

    spy.mockRestore();
  });
});
