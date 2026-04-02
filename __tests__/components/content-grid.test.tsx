/**
 * ContentGrid Component Tests
 *
 * Tests the ContentGrid component — virtualised/simple grid rendering,
 * ARIA roles, multi-select mode, active index highlighting, and read/quality state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockVirtualizer } = vi.hoisted(() => ({
  mockVirtualizer: {
    getTotalSize: vi.fn(() => 800),
    getVirtualItems: vi.fn(() => [
      { index: 0, start: 0, size: 380, key: '0', end: 380, lane: 0 },
    ]),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    options: { scrollMargin: 0 },
  },
}));

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: () => mockVirtualizer,
}));

vi.mock('@/components/content/content-card', () => ({
  ContentCard: ({
    item,
    isRead,
    hasQualityFlag,
  }: {
    item: ContentListItem;
    isRead?: boolean;
    hasQualityFlag?: boolean;
  }) => (
    <div
      data-testid={`card-${item.id}`}
      data-is-read={isRead}
      data-quality-flag={hasQualityFlag}
    >
      {item.title}
    </div>
  ),
}));

import { ContentGrid } from '@/components/content/content-grid';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: overrides.id ?? 'item-1',
    title: overrides.title ?? 'Test Item',
    suggested_title: null,
    ai_summary: null,
    primary_domain: 'Corporate',
    primary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: [],
    classification_confidence: null,
    priority: null,
    freshness: null,
    user_tags: [],
    governance_review_status: null,
    metadata: null,
    ...overrides,
  };
}

function createItems(count: number): ContentListItem[] {
  return Array.from({ length: count }, (_, i) =>
    createItem({ id: `item-${i}`, title: `Item ${i}` }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Polyfill ResizeObserver for jsdom
    // Must use function keyword (not arrow) so `new ResizeObserver(...)` works
    global.ResizeObserver = vi.fn().mockImplementation(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }) as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when items array is empty', () => {
    const { container } = render(<ContentGrid items={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders simple CSS grid when items.length <= 24', () => {
    const items = createItems(5);
    render(<ContentGrid items={items} />);
    // Simple grid renders items directly — each should appear
    expect(screen.getByText('Item 0')).toBeInTheDocument();
    expect(screen.getByText('Item 4')).toBeInTheDocument();
  });

  it('renders with role="feed" and aria-label', () => {
    const items = createItems(3);
    render(<ContentGrid items={items} />);
    const feed = screen.getByRole('feed');
    expect(feed).toHaveAttribute('aria-label', 'Content items');
  });

  it('renders each item with role="article" and correct aria-setsize/aria-posinset', () => {
    const items = createItems(3);
    render(<ContentGrid items={items} />);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveAttribute('aria-setsize', '3');
    expect(articles[0]).toHaveAttribute('aria-posinset', '1');
    expect(articles[2]).toHaveAttribute('aria-posinset', '3');
  });

  it('applies ring highlight when activeIndex matches', () => {
    const items = createItems(3);
    render(<ContentGrid items={items} activeIndex={1} />);
    const articles = screen.getAllByRole('article');
    expect(articles[1].className).toContain('ring-2');
    expect(articles[0].className).not.toContain('ring-2');
  });

  it('shows multi-select buttons when multiSelectMode is true', () => {
    const items = createItems(2);
    render(
      <ContentGrid
        items={items}
        multiSelectMode={true}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
      />,
    );
    const selectButtons = screen.getAllByRole('checkbox', { name: 'Select' });
    expect(selectButtons).toHaveLength(2);
  });

  it('calls onToggleSelect when select button is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const items = createItems(2);
    render(
      <ContentGrid
        items={items}
        multiSelectMode={true}
        selectedIds={new Set()}
        onToggleSelect={onToggle}
      />,
    );
    const selectButtons = screen.getAllByRole('checkbox', { name: 'Select' });
    await user.click(selectButtons[0]);
    expect(onToggle).toHaveBeenCalledWith('item-0');
  });

  it('shows checked state for items in selectedIds', () => {
    const items = createItems(2);
    render(
      <ContentGrid
        items={items}
        multiSelectMode={true}
        selectedIds={new Set(['item-0'])}
        onToggleSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'Deselect' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select' }),
    ).toBeInTheDocument();
  });

  it('passes isRead prop from readItemIds Set', () => {
    const items = createItems(2);
    render(<ContentGrid items={items} readItemIds={new Set(['item-0'])} />);
    expect(screen.getByTestId('card-item-0')).toHaveAttribute(
      'data-is-read',
      'true',
    );
    expect(screen.getByTestId('card-item-1')).toHaveAttribute(
      'data-is-read',
      'false',
    );
  });

  it('passes hasQualityFlag from qualityFlaggedIds Set', () => {
    const items = createItems(2);
    render(
      <ContentGrid items={items} qualityFlaggedIds={new Set(['item-1'])} />,
    );
    expect(screen.getByTestId('card-item-0')).toHaveAttribute(
      'data-quality-flag',
      'false',
    );
    expect(screen.getByTestId('card-item-1')).toHaveAttribute(
      'data-quality-flag',
      'true',
    );
  });
});
