/**
 * ContentList Component Tests
 *
 * Tests the ContentList component — virtualised list rendering,
 * ARIA roles, multi-select mode, and read/quality state passthrough.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockVirtualizer } = vi.hoisted(() => ({
  mockVirtualizer: {
    getTotalSize: vi.fn(() => 640),
    getVirtualItems: vi.fn(
      () =>
        [] as Array<{
          index: number;
          start: number;
          size: number;
          key: string;
          end: number;
          lane: number;
        }>,
    ),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    options: { scrollMargin: 0 },
  },
}));

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: () => mockVirtualizer,
}));

vi.mock('@/components/content/content-row', () => ({
  ContentRow: ({
    item,
    isRead,
    hasQualityFlag,
  }: {
    item: ContentListItem;
    isRead?: boolean;
    hasQualityFlag?: boolean;
  }) => (
    <div
      data-testid={`row-${item.id}`}
      data-is-read={isRead}
      data-quality-flag={hasQualityFlag}
    >
      {item.title}
    </div>
  ),
}));

import { ContentList } from '@/components/content/content-list';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: overrides.id ?? 'item-1',
    title: overrides.title ?? 'Test Item',
    suggested_title: null,
    summary: null,
    primary_domain: 'Corporate',
    primary_subtopic: 'unclassified',
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
    publication_status: null,
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

describe('ContentList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when items array is empty', () => {
    const { container } = render(<ContentList items={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders with role="feed"', () => {
    const items = createItems(3);
    // Virtualizer must return items for them to render
    mockVirtualizer.getVirtualItems.mockReturnValue(
      items.map((_, i) => ({
        index: i,
        start: i * 64,
        size: 64,
        key: String(i),
        end: (i + 1) * 64,
        lane: 0,
      })),
    );
    render(<ContentList items={items} />);
    const feed = screen.getByRole('feed');
    expect(feed).toHaveAttribute('aria-label', 'Content items');
  });

  it('shows multi-select buttons when enabled', () => {
    const items = createItems(2);
    mockVirtualizer.getVirtualItems.mockReturnValue(
      items.map((_, i) => ({
        index: i,
        start: i * 64,
        size: 64,
        key: String(i),
        end: (i + 1) * 64,
        lane: 0,
      })),
    );
    render(
      <ContentList
        items={items}
        multiSelectMode={true}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
      />,
    );
    const selectButtons = screen.getAllByRole('checkbox', { name: 'Select' });
    expect(selectButtons).toHaveLength(2);
  });

  it('renders each item with role="article"', () => {
    const items = createItems(3);
    mockVirtualizer.getVirtualItems.mockReturnValue(
      items.map((_, i) => ({
        index: i,
        start: i * 64,
        size: 64,
        key: String(i),
        end: (i + 1) * 64,
        lane: 0,
      })),
    );
    render(<ContentList items={items} />);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveAttribute('aria-setsize', '3');
    expect(articles[0]).toHaveAttribute('aria-posinset', '1');
  });

  it('passes through read state and quality flags', () => {
    const items = createItems(2);
    mockVirtualizer.getVirtualItems.mockReturnValue(
      items.map((_, i) => ({
        index: i,
        start: i * 64,
        size: 64,
        key: String(i),
        end: (i + 1) * 64,
        lane: 0,
      })),
    );
    render(
      <ContentList
        items={items}
        readItemIds={new Set(['item-0'])}
        qualityFlaggedIds={new Set(['item-1'])}
      />,
    );
    expect(screen.getByTestId('row-item-0')).toHaveAttribute(
      'data-is-read',
      'true',
    );
    expect(screen.getByTestId('row-item-1')).toHaveAttribute(
      'data-quality-flag',
      'true',
    );
  });
});
