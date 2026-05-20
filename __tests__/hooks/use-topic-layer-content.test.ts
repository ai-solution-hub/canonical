import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import {
  groupLayerContent,
  type LayerItem,
} from '@/hooks/use-topic-layer-content';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockSupabase: MockSupabaseClient;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}));

import { useTopicLayerContent } from '@/hooks/use-topic-layer-content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
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
// Pure function tests (groupLayerContent)
// ---------------------------------------------------------------------------

describe('groupLayerContent', () => {
  it('groups items by layer key', () => {
    const items: LayerItem[] = [
      {
        id: '1',
        layer: 'sales_brief',
        title: 'SCP Sales',
        brief: 'Sales version',
        detail: null,
        content: 'Full sales content',
        content_type: 'article',
        metadata: { layer: 'sales_brief' },
      },
      {
        id: '2',
        layer: 'bid_detail',
        title: 'SCP Procurement',
        brief: 'Procurement version',
        detail: 'Detailed bid content',
        content: 'Full bid content',
        content_type: 'article',
        metadata: { layer: 'bid_detail' },
      },
    ];
    const grouped = groupLayerContent(items);
    expect(grouped).toHaveProperty('sales_brief');
    expect(grouped).toHaveProperty('bid_detail');
    expect(grouped.sales_brief.title).toBe('SCP Sales');
    expect(grouped.bid_detail.title).toBe('SCP Procurement');
  });

  it('handles single item', () => {
    const items: LayerItem[] = [
      {
        id: '1',
        layer: 'sales_brief',
        title: 'Only Sales',
        brief: 'Just one',
        detail: null,
        content: null,
        content_type: 'article',
        metadata: null,
      },
    ];
    const grouped = groupLayerContent(items);
    expect(Object.keys(grouped)).toHaveLength(1);
    expect(grouped.sales_brief.id).toBe('1');
  });

  it('skips items without a layer', () => {
    const items: LayerItem[] = [
      {
        id: '1',
        layer: '',
        title: 'No Layer',
        brief: null,
        detail: null,
        content: null,
        content_type: 'article',
        metadata: null,
      },
      {
        id: '2',
        layer: 'bid_detail',
        title: 'Has Layer',
        brief: null,
        detail: null,
        content: null,
        content_type: 'article',
        metadata: null,
      },
    ];
    const grouped = groupLayerContent(items);
    expect(Object.keys(grouped)).toHaveLength(1);
    expect(grouped).toHaveProperty('bid_detail');
    expect('' in grouped).toBe(false);
  });

  it('returns empty map for empty input', () => {
    const grouped = groupLayerContent([]);
    expect(Object.keys(grouped)).toHaveLength(0);
  });

  it('last item wins when duplicate layers exist', () => {
    const items: LayerItem[] = [
      {
        id: '1',
        layer: 'sales_brief',
        title: 'First',
        brief: null,
        detail: null,
        content: null,
        content_type: 'article',
        metadata: null,
      },
      {
        id: '2',
        layer: 'sales_brief',
        title: 'Second',
        brief: null,
        detail: null,
        content: null,
        content_type: 'article',
        metadata: null,
      },
    ];
    const grouped = groupLayerContent(items);
    expect(Object.keys(grouped)).toHaveLength(1);
    expect(grouped.sales_brief.title).toBe('Second');
  });
});

// ---------------------------------------------------------------------------
// Hook tests (useTopicLayerContent)
// ---------------------------------------------------------------------------

describe('useTopicLayerContent', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
  });

  it('returns empty content and not loading when only one topic layer', () => {
    const { result } = renderHook(
      () =>
        useTopicLayerContent(
          [
            {
              id: 'item-1',
              title: 'Current',
              layer: 'base',
              content_type: 'article',
            },
          ],
          'item-1',
        ),
      { wrapper: createWrapper() },
    );

    expect(result.current.layerContent).toEqual({});
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches sibling layer content when multiple layers exist', async () => {
    const mockData = [
      {
        id: 'sibling-1',
        title: 'Sales Layer',
        brief: 'Sales brief',
        detail: null,
        content: 'Sales content',
        content_type: 'article',
        metadata: null,
        layer: 'sales_brief',
      },
    ];

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: mockData, error: null }),
    );

    const topicLayers = [
      {
        id: 'item-1',
        title: 'Current',
        layer: 'base',
        content_type: 'article',
      },
      {
        id: 'sibling-1',
        title: 'Sales',
        layer: 'sales_brief',
        content_type: 'article',
      },
    ];

    const { result } = renderHook(
      () => useTopicLayerContent(topicLayers, 'item-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.layerContent).toHaveProperty('sales_brief');
    expect(result.current.layerContent.sales_brief.title).toBe('Sales Layer');
  });

  it('does not fetch when all topic layers are the current item', () => {
    const topicLayers = [
      {
        id: 'item-1',
        title: 'Current',
        layer: 'base',
        content_type: 'article',
      },
      {
        id: 'item-1',
        title: 'Current dupe',
        layer: 'sales',
        content_type: 'article',
      },
    ];

    const { result } = renderHook(
      () => useTopicLayerContent(topicLayers, 'item-1'),
      { wrapper: createWrapper() },
    );

    // Should not call Supabase since there are no siblings
    expect(result.current.layerContent).toEqual({});
  });
});
