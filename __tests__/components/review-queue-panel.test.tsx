/**
 * ReviewQueuePanel Component Tests
 *
 * Tests item rendering and position indicator behaviour.
 * Sort picker has been removed (P1-8 / D-2) — panel is a read-only
 * position indicator; sort is handled exclusively via the filter popover.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { ReviewQueuePanel } from '@/components/review/review-queue-panel';
import type { ReviewQueueItem } from '@/types/review';

// ---------------------------------------------------------------------------
// jsdom polyfills
// ---------------------------------------------------------------------------

Element.prototype.scrollIntoView = vi.fn();

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    domains: [],
    subtopics: {},
    isLoading: false,
    getDomainLabel: (d: string) => d,
    getSubtopicLabel: (_d: string, s: string) => s,
    getDomainColourKey: (d: string) => d.toLowerCase().replace(/\s+/g, '-'),
    formatDomainName: (d: string) => d,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  id: string,
  overrides: Partial<ReviewQueueItem> = {},
): ReviewQueueItem {
  return {
    id,
    title: `Item ${id}`,
    suggested_title: null,
    summary: null,
    primary_domain: 'Technology',
    primary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: null,
    ai_keywords: [],
    classification_confidence: 0.9,
    priority: null,
    freshness: null,
    user_tags: [],
    governance_review_status: null,
    metadata: null,
    content: null,
    source_url: null,
    verified_at: null,
    verified_by: null,
    secondary_domain: null,
    secondary_subtopic: null,
    quality_score: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewQueuePanel', () => {
  it('renders without a sort picker', () => {
    render(
      <ReviewQueuePanel
        items={[makeItem('1')]}
        currentIndex={0}
        onSelectItem={vi.fn()}
      />,
    );

    // No combobox (sort picker) should be present
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows the correct number of items in the footer', () => {
    const items = [makeItem('1'), makeItem('2'), makeItem('3')];

    render(
      <ReviewQueuePanel
        items={items}
        currentIndex={0}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.getByText('3 items loaded')).toBeInTheDocument();
  });

  it('shows singular "item" when only 1 item', () => {
    render(
      <ReviewQueuePanel
        items={[makeItem('1')]}
        currentIndex={0}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.getByText('1 item loaded')).toBeInTheDocument();
  });

  it('renders item titles in the queue list', () => {
    const items = [
      makeItem('a', { title: 'First Item' }),
      makeItem('b', { title: 'Second Item' }),
    ];

    render(
      <ReviewQueuePanel
        items={items}
        currentIndex={0}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.getByText('First Item')).toBeInTheDocument();
    expect(screen.getByText('Second Item')).toBeInTheDocument();
  });

  it('highlights the current item with aria-current', () => {
    const items = [
      makeItem('a', { title: 'Current' }),
      makeItem('b', { title: 'Other' }),
    ];

    render(
      <ReviewQueuePanel
        items={items}
        currentIndex={0}
        onSelectItem={vi.fn()}
      />,
    );

    const currentButton = screen.getByRole('button', { name: 'Current' });
    expect(currentButton).toHaveAttribute('aria-current', 'true');

    const otherButton = screen.getByRole('button', { name: 'Other' });
    expect(otherButton).not.toHaveAttribute('aria-current');
  });

  it('calls onSelectItem when an item button is clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSelectItem = vi.fn();

    const items = [
      makeItem('a', { title: 'First' }),
      makeItem('b', { title: 'Second' }),
    ];

    render(
      <ReviewQueuePanel
        items={items}
        currentIndex={0}
        onSelectItem={onSelectItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Second' }));
    expect(onSelectItem).toHaveBeenCalledWith(1);
  });
});
