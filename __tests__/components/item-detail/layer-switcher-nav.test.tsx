/**
 * LayerSwitcherNav Component Tests
 *
 * Tests the horizontal navigation showing linked items sharing the same topic_id —
 * feature flag gating, minimum layer count, current/other layer badges.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(() => false),
}));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@/lib/validation/layer-schemas', () => ({
  getLayerLabel: (key: string) => {
    const labels: Record<string, string> = {
      sales_brief: 'Sales Brief',
      bid_detail: 'Bid Detail',
      company_reference: 'Company Reference',
    };
    return labels[key] ?? key;
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [
      { key: 'sales_brief', label: 'Sales Brief', description: '', display_order: 1, is_active: true, id: 'l-1' },
      { key: 'bid_detail', label: 'Bid Detail', description: '', display_order: 2, is_active: true, id: 'l-2' },
      { key: 'company_reference', label: 'Company Reference', description: '', display_order: 3, is_active: true, id: 'l-3' },
    ],
    loading: false,
    error: null,
    getLayerKeys: () => ['sales_brief', 'bid_detail', 'company_reference'],
    getLayerLabel: (key: string) => {
      const labels: Record<string, string> = {
        sales_brief: 'Sales Brief',
        bid_detail: 'Bid Detail',
        company_reference: 'Company Reference',
      };
      return labels[key] ?? key;
    },
    getLayerDescription: () => '',
    refresh: vi.fn(),
  }),
}));

import { LayerSwitcherNav } from '@/components/item-detail/layer-switcher-nav';
import type { TopicLayerItem } from '@/components/item-detail/layer-switcher-nav';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLayers(count: number): TopicLayerItem[] {
  const keys = ['sales_brief', 'bid_detail', 'company_reference', 'research'];
  return Array.from({ length: count }, (_, i) => ({
    id: `layer-${i}`,
    title: `Layer ${i}`,
    layer: keys[i] ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LayerSwitcherNav', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns null when content_layers feature is disabled', () => {
    mockIsFeatureEnabled.mockReturnValue(false);
    const { container } = render(
      <LayerSwitcherNav currentItemId="layer-0" topicLayers={createLayers(3)} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when topicLayers has only one item', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const { container } = render(
      <LayerSwitcherNav currentItemId="layer-0" topicLayers={createLayers(1)} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows current layer as default Badge (not a link)', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    render(
      <LayerSwitcherNav currentItemId="layer-0" topicLayers={createLayers(2)} />,
    );
    const currentBadge = screen.getByText('Sales Brief');
    // Current layer badge should not be wrapped in a link
    expect(currentBadge.closest('a')).toBeNull();
  });

  it('shows other layers as outline Badge links', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    render(
      <LayerSwitcherNav currentItemId="layer-0" topicLayers={createLayers(3)} />,
    );
    const bidDetail = screen.getByText('Bid Detail');
    expect(bidDetail.closest('a')).toHaveAttribute('href', '/item/layer-1');

    const compRef = screen.getByText('Company Reference');
    expect(compRef.closest('a')).toHaveAttribute('href', '/item/layer-2');
  });

  it('has nav with aria-label="Content layers"', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    render(
      <LayerSwitcherNav currentItemId="layer-0" topicLayers={createLayers(2)} />,
    );
    expect(screen.getByLabelText('Content layers')).toBeInTheDocument();
  });

  it('deduplicates items with the same layer key', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    // Simulate the old RPC bug: multiple items sharing the same layer
    const duplicated: TopicLayerItem[] = [
      { id: 'item-1', title: 'First sales brief', layer: 'sales_brief' },
      { id: 'item-2', title: 'Second sales brief', layer: 'sales_brief' },
      { id: 'item-3', title: 'Bid detail', layer: 'bid_detail' },
      { id: 'item-4', title: 'Another bid detail', layer: 'bid_detail' },
      { id: 'item-5', title: 'Company ref', layer: 'company_reference' },
    ];
    render(
      <LayerSwitcherNav currentItemId="item-1" topicLayers={duplicated} />,
    );
    // Should show exactly 3 badges (one per unique layer), not 5
    const badges = screen.getAllByText(/Sales Brief|Bid Detail|Company Reference/);
    expect(badges).toHaveLength(3);
  });

  it('filters out items with null layer during dedup', () => {
    mockIsFeatureEnabled.mockReturnValue(true);
    const withNulls: TopicLayerItem[] = [
      { id: 'item-1', title: 'Sales brief', layer: 'sales_brief' },
      { id: 'item-2', title: 'No layer', layer: null },
      { id: 'item-3', title: 'Bid detail', layer: 'bid_detail' },
    ];
    render(
      <LayerSwitcherNav currentItemId="item-1" topicLayers={withNulls} />,
    );
    // Only 2 unique layers (null excluded)
    const badges = screen.getAllByText(/Sales Brief|Bid Detail/);
    expect(badges).toHaveLength(2);
  });
});
