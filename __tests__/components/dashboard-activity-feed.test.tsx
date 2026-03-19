/**
 * Tests for DashboardActivityFeed — the activity feed component.
 *
 * Covers:
 * - `isPreGrouped` detection (pre-grouped data from RPC vs raw items)
 * - Mapping GroupedActivityItem to GroupedActivity format
 * - Fallback to client-side grouping when data is not pre-grouped
 * - Empty state rendering
 * - Time group bucketing (Today, Yesterday, This week, Earlier)
 * - Quality flag summary cleaning
 * - Count display for grouped items
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ActivityItem, GroupedActivityItem } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Freeze time for deterministic time group tests
// ---------------------------------------------------------------------------

const FROZEN_NOW = new Date('2026-03-08T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: (userIds: string[]) => {
    const map = new Map<string, string>();
    for (const id of userIds) {
      if (id === 'user-a') map.set(id, 'Alice');
      if (id === 'user-b') map.set(id, 'Bob');
    }
    return map;
  },
}));

vi.mock('@/lib/format', () => ({
  formatRelativeDate: (date: string | null) => {
    if (!date) return '';
    return '2 hours ago';
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { DashboardActivityFeed } from '@/components/dashboard/dashboard-activity-feed';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeActivityItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    type: 'edit',
    entity_type: 'content_item',
    entity_id: 'item-1',
    summary: 'Updated policy document',
    user_id: 'user-a',
    created_at: '2026-03-08T09:00:00Z', // Today
    ...overrides,
  };
}

function makeGroupedActivityItem(
  overrides: Partial<GroupedActivityItem> = {},
): GroupedActivityItem {
  return {
    id: 'grp-1',
    type: 'edit',
    entity_type: 'content_item',
    entity_id: 'item-1',
    summary: 'Updated policy document',
    user_id: 'user-a',
    created_at: '2026-03-08T09:00:00Z',
    latest_at: '2026-03-08T09:30:00Z',
    earliest_at: '2026-03-08T08:00:00Z',
    event_count: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardActivityFeed', () => {
  // =========================================================================
  // Empty state
  // =========================================================================

  describe('empty state', () => {
    it('renders empty state when no activities', () => {
      render(<DashboardActivityFeed activities={[]} />);
      expect(screen.getByText('No recent activity')).toBeInTheDocument();
      expect(
        screen.getByText('Changes to the knowledge base will appear here'),
      ).toBeInTheDocument();
    });
  });

  // =========================================================================
  // isPreGrouped detection
  // =========================================================================

  describe('isPreGrouped detection', () => {
    it('detects pre-grouped data via event_count field', () => {
      const preGrouped: GroupedActivityItem[] = [
        makeGroupedActivityItem({ event_count: 5, summary: 'Pre-grouped edit' }),
      ];

      render(<DashboardActivityFeed activities={preGrouped} />);
      // Pre-grouped items show their event_count as the multiplier
      expect(screen.getByText(/5/)).toBeInTheDocument();
      expect(screen.getByText('Pre-grouped edit')).toBeInTheDocument();
    });

    it('falls back to client-side grouping for raw ActivityItem[]', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({ id: 'a1', summary: 'Same change' }),
        makeActivityItem({ id: 'a2', summary: 'Same change' }),
        makeActivityItem({ id: 'a3', summary: 'Same change' }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      // Client-side grouping should collapse 3 identical items into 1 with count 3
      expect(screen.getByText(/3/)).toBeInTheDocument();
      expect(screen.getByText('Same change')).toBeInTheDocument();
    });

    it('does not merge different types when client-side grouping', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({ id: 'a1', type: 'edit', summary: 'Updated content' }),
        makeActivityItem({
          id: 'a2',
          type: 'quality_flag',
          summary: 'warning: low quality',
          entity_id: 'item-2',
        }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      // Should render both items separately
      expect(screen.getByText('Updated content')).toBeInTheDocument();
      expect(screen.getByText('Low quality')).toBeInTheDocument(); // Cleaned summary
    });
  });

  // =========================================================================
  // Mapping to GroupedActivity format
  // =========================================================================

  describe('pre-grouped data mapping', () => {
    it('uses latest_at for timestamp display', () => {
      const preGrouped: GroupedActivityItem[] = [
        makeGroupedActivityItem({
          latest_at: '2026-03-08T09:30:00Z',
          earliest_at: '2026-03-08T08:00:00Z',
        }),
      ];

      render(<DashboardActivityFeed activities={preGrouped} />);
      // The formatRelativeDate mock returns '2 hours ago' for any date
      expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
    });

    it('falls back to created_at when latest_at is null', () => {
      const preGrouped: GroupedActivityItem[] = [
        makeGroupedActivityItem({
          latest_at: null,
          created_at: '2026-03-08T09:00:00Z',
        }),
      ];

      render(<DashboardActivityFeed activities={preGrouped} />);
      // Should still render without error
      expect(screen.getByText('Updated policy document')).toBeInTheDocument();
    });

    it('preserves event_count from pre-grouped data', () => {
      const preGrouped: GroupedActivityItem[] = [
        makeGroupedActivityItem({ event_count: 7, summary: 'Bulk update' }),
      ];

      render(<DashboardActivityFeed activities={preGrouped} />);
      // 7x should appear as the count prefix
      expect(screen.getByText(/7/)).toBeInTheDocument();
    });

    it('does not show count prefix when event_count is 1', () => {
      const preGrouped: GroupedActivityItem[] = [
        makeGroupedActivityItem({ event_count: 1, summary: 'Single edit' }),
      ];

      render(<DashboardActivityFeed activities={preGrouped} />);
      // The \u00d7 (multiplication sign) should NOT appear
      const items = screen.getAllByRole('article');
      expect(items).toHaveLength(1);
      // Should show the user name for single items (text is split across nodes)
      const article = items[0];
      expect(article.textContent).toContain('Alice');
    });
  });

  // =========================================================================
  // Client-side grouping fallback
  // =========================================================================

  describe('client-side grouping fallback', () => {
    it('groups identical type+summary pairs', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({ id: 'a1', summary: 'Classification updated', type: 'edit' }),
        makeActivityItem({ id: 'a2', summary: 'Classification updated', type: 'edit' }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      // Should collapse into one row with count 2 (displayed as "2×")
      const articles = screen.getAllByRole('article');
      expect(articles).toHaveLength(1);
      expect(articles[0].textContent).toContain('2\u00d7');
      expect(screen.getByText('Classification updated')).toBeInTheDocument();
    });

    it('keeps different summaries separate', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({ id: 'a1', summary: 'Updated title' }),
        makeActivityItem({ id: 'a2', summary: 'Updated content', entity_id: 'item-2' }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      expect(screen.getByText('Updated title')).toBeInTheDocument();
      expect(screen.getByText('Updated content')).toBeInTheDocument();
    });

    it('tracks time range across grouped items', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({
          id: 'a1',
          summary: 'Batch import',
          created_at: '2026-03-08T08:00:00Z',
        }),
        makeActivityItem({
          id: 'a2',
          summary: 'Batch import',
          created_at: '2026-03-08T09:30:00Z',
        }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      // Should show 2x Batch import (collapsed)
      const articles = screen.getAllByRole('article');
      expect(articles).toHaveLength(1);
      expect(articles[0].textContent).toContain('2\u00d7');
      expect(screen.getByText('Batch import')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Quality flag summary cleaning
  // =========================================================================

  describe('quality flag summary cleaning', () => {
    it('strips severity prefix from quality_flag summaries', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({
          id: 'qf1',
          type: 'quality_flag',
          summary: 'info: classification low confidence',
        }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      expect(
        screen.getByText('Classification low confidence'),
      ).toBeInTheDocument();
    });

    it('capitalises first letter after stripping prefix', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({
          id: 'qf2',
          type: 'quality_flag',
          summary: 'warning: duplicate detected',
        }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      expect(screen.getByText('Duplicate detected')).toBeInTheDocument();
    });

    it('handles quality_flag without severity prefix gracefully', () => {
      const rawItems: ActivityItem[] = [
        makeActivityItem({
          id: 'qf3',
          type: 'quality_flag',
          summary: 'needs review',
        }),
      ];

      render(<DashboardActivityFeed activities={rawItems} />);
      expect(screen.getByText('Needs review')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Time grouping
  // =========================================================================

  describe('time grouping', () => {
    it('places today items under "Today" heading', () => {
      const items: ActivityItem[] = [
        makeActivityItem({ created_at: '2026-03-08T09:00:00Z' }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      expect(screen.getByText('Today')).toBeInTheDocument();
    });

    it('places yesterday items under "Yesterday" heading', () => {
      const items: ActivityItem[] = [
        makeActivityItem({
          id: 'yesterday-1',
          created_at: '2026-03-07T15:00:00Z',
        }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      expect(screen.getByText('Yesterday')).toBeInTheDocument();
    });

    it('places same-week items under "This week" heading', () => {
      // 2026-03-08 is a Sunday. Week starts Monday 2026-03-02.
      const items: ActivityItem[] = [
        makeActivityItem({
          id: 'week-1',
          created_at: '2026-03-04T10:00:00Z', // Wednesday
        }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      expect(screen.getByText('This week')).toBeInTheDocument();
    });

    it('places older items under "Earlier" heading', () => {
      const items: ActivityItem[] = [
        makeActivityItem({
          id: 'old-1',
          created_at: '2026-02-20T10:00:00Z',
        }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      expect(screen.getByText('Earlier')).toBeInTheDocument();
    });

    it('groups items across multiple time sections', () => {
      const items: ActivityItem[] = [
        makeActivityItem({
          id: 'today-1',
          summary: 'Today edit',
          created_at: '2026-03-08T09:00:00Z',
        }),
        makeActivityItem({
          id: 'old-1',
          summary: 'Old edit',
          created_at: '2026-02-01T10:00:00Z',
          entity_id: 'item-2',
        }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('Earlier')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Icon selection
  // =========================================================================

  describe('icon selection', () => {
    it('renders without error for each activity type', () => {
      const types = ['edit', 'rollback', 'quality_flag', 'create'];

      for (const type of types) {
        const { unmount } = render(
          <DashboardActivityFeed
            activities={[makeActivityItem({ id: `icon-${type}`, type, summary: `${type} action` })]}
          />,
        );
        expect(screen.getByRole('feed')).toBeInTheDocument();
        unmount();
      }
    });
  });

  // =========================================================================
  // User display
  // =========================================================================

  describe('user display', () => {
    it('shows user name for single-count items', () => {
      const items: ActivityItem[] = [
        makeActivityItem({ user_id: 'user-a', summary: 'Single item edit' }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      // User name is rendered inside the article text content
      const article = screen.getByRole('article');
      expect(article.textContent).toContain('Alice');
    });

    it('shows "System" when user_id is null', () => {
      const items: ActivityItem[] = [
        makeActivityItem({ user_id: null, summary: 'Automated action' }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      const article = screen.getByRole('article');
      expect(article.textContent).toContain('System');
    });

    it('shows "Unknown user" when user_id is not in displayNames map', () => {
      const items: ActivityItem[] = [
        makeActivityItem({ user_id: 'user-unknown', summary: 'Unknown person edit' }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      const article = screen.getByRole('article');
      expect(article.textContent).toContain('Unknown user');
    });
  });

  // =========================================================================
  // Accessibility
  // =========================================================================

  describe('accessibility', () => {
    it('has role="feed" on the container', () => {
      const items: ActivityItem[] = [makeActivityItem()];
      render(<DashboardActivityFeed activities={items} />);
      expect(screen.getByRole('feed')).toBeInTheDocument();
    });

    it('items have role="article"', () => {
      const items: ActivityItem[] = [makeActivityItem()];
      render(<DashboardActivityFeed activities={items} />);
      expect(screen.getAllByRole('article')).toHaveLength(1);
    });

    it('icons have aria-hidden="true"', () => {
      const items: ActivityItem[] = [makeActivityItem()];
      const { container } = render(
        <DashboardActivityFeed activities={items} />,
      );
      const svgs = container.querySelectorAll('svg');
      for (const svg of svgs) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
    });
  });

  // =========================================================================
  // Links
  // =========================================================================

  describe('links', () => {
    it('links to /item/:entity_id', () => {
      const items: ActivityItem[] = [
        makeActivityItem({ entity_id: 'item-42' }),
      ];

      render(<DashboardActivityFeed activities={items} />);
      const link = screen.getByRole('article').closest('a');
      expect(link).toHaveAttribute('href', '/item/item-42');
    });
  });
});
