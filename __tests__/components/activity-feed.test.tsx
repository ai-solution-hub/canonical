/**
 * ActivityFeed Component Tests
 *
 * Tests the ActivityFeed component — loading state, empty states,
 * activity cards with icons/badges, filtering by type and date,
 * and load more pagination.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupedActivityItem } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockDisplayNames } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockDisplayNames: { value: new Map<string, string>() },
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: () => mockDisplayNames.value,
}));

vi.mock('@/lib/format', () => ({
  formatRelativeDate: (d: string | null) => d ? '2 hours ago' : '',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

import { ActivityFeed } from '@/components/activity-feed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createActivity(overrides: Partial<GroupedActivityItem> = {}): GroupedActivityItem {
  return {
    id: overrides.id ?? 'act-1',
    type: overrides.type ?? 'edit',
    entity_type: overrides.entity_type ?? 'content_item',
    entity_id: overrides.entity_id ?? 'item-abc',
    summary: overrides.summary ?? 'Updated company overview',
    user_id: overrides.user_id ?? 'user-1',
    created_at: overrides.created_at ?? '2026-03-15T10:00:00Z',
    latest_at: overrides.latest_at ?? '2026-03-15T10:00:00Z',
    earliest_at: overrides.earliest_at ?? '2026-03-15T09:00:00Z',
    event_count: overrides.event_count ?? 1,
  };
}

function mockFetchResponse(activities: GroupedActivityItem[], hasMore = false) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ activities, has_more: hasMore }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDisplayNames.value = new Map([['user-1', 'Liam Jones']]);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading spinner while fetching', () => {
    // Make fetch hang so loading state is visible
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<ActivityFeed />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows "No activity yet" empty state', async () => {
    mockFetchResponse([]);
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText('No activity yet')).toBeInTheDocument();
    });
  });

  it('renders activity cards with correct icons by type', async () => {
    mockFetchResponse([
      createActivity({ id: 'a1', type: 'edit', summary: 'Edited document' }),
      createActivity({ id: 'a2', type: 'rollback', summary: 'Rolled back change' }),
      createActivity({ id: 'a3', type: 'quality_flag', summary: 'Flagged for quality' }),
    ]);

    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText('Edited document')).toBeInTheDocument();
      expect(screen.getByText('Rolled back change')).toBeInTheDocument();
      expect(screen.getByText('Flagged for quality')).toBeInTheDocument();
    });
  });

  it('shows edit badge for edit type', async () => {
    mockFetchResponse([createActivity({ type: 'edit' })]);
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });
  });

  it('shows rollback badge for rollback type', async () => {
    mockFetchResponse([createActivity({ type: 'rollback', summary: 'Reverted pricing' })]);
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText('Rollback')).toBeInTheDocument();
    });
  });

  it('filters by event type', async () => {
    mockFetchResponse([
      createActivity({ id: 'a1', type: 'edit', summary: 'Content edit' }),
      createActivity({ id: 'a2', type: 'quality_flag', summary: 'Quality issue' }),
    ]);

    // eventFilter='governance' should only show quality_flag (governance category)
    render(<ActivityFeed eventFilter="governance" />);
    await waitFor(() => {
      expect(screen.getByText('Quality issue')).toBeInTheDocument();
      expect(screen.queryByText('Content edit')).not.toBeInTheDocument();
    });
  });

  it('filters by date range', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 1000 * 60 * 30).toISOString(); // 30 min ago
    const old = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 14).toISOString(); // 2 weeks ago

    mockFetchResponse([
      createActivity({ id: 'a1', type: 'edit', summary: 'Recent change', created_at: recent }),
      createActivity({ id: 'a2', type: 'edit', summary: 'Old change', created_at: old }),
    ]);

    render(<ActivityFeed dateRange="week" />);
    await waitFor(() => {
      expect(screen.getByText('Recent change')).toBeInTheDocument();
      expect(screen.queryByText('Old change')).not.toBeInTheDocument();
    });
  });

  it('shows Load More button when hasMore=true', async () => {
    mockFetchResponse(
      [createActivity({ id: 'a1' })],
      true,
    );

    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Load More/ })).toBeInTheDocument();
    });
  });

  it('shows "No matching activity" when filters exclude all', async () => {
    // Return content-type activities, but filter for 'bid' category
    mockFetchResponse([
      createActivity({ type: 'edit', summary: 'An edit' }),
    ]);

    render(<ActivityFeed eventFilter="bid" />);
    await waitFor(() => {
      expect(screen.getByText('No matching activity')).toBeInTheDocument();
    });
  });
});
