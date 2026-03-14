import { describe, it, expect } from 'vitest';
import { groupLayerContent, type LayerItem } from '@/hooks/use-topic-layer-content';

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
        title: 'SCP Bid',
        brief: 'Bid version',
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
    expect(grouped.bid_detail.title).toBe('SCP Bid');
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
