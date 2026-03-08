/**
 * Component tests for ReorientSection — the personal briefing panel.
 *
 * Tests rendering of the greeting, urgent items, team changes, recent work,
 * empty state, dismiss behaviour, links, and accessibility attributes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReorientData, UrgentItem, TeamChange, RecentWorkItem } from '@/types/reorient';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock next/link to render a plain anchor
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

// Mock useDisplayNames — return a stable map
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

// Mock formatRelativeDate
vi.mock('@/lib/format', () => ({
  formatRelativeDate: (date: string | null) => {
    if (!date) return '';
    return '2 hours ago';
  },
}));

// Stub sessionStorage
const sessionStorageMap = new Map<string, string>();
const mockSessionStorage = {
  getItem: vi.fn((key: string) => sessionStorageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => sessionStorageMap.set(key, value)),
  removeItem: vi.fn((key: string) => sessionStorageMap.delete(key)),
  clear: vi.fn(() => sessionStorageMap.clear()),
  get length() { return sessionStorageMap.size; },
  key: vi.fn(() => null),
};

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
  writable: true,
});

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { ReorientSection } from '@/components/dashboard/reorient-section';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeUrgentItem(overrides: Partial<UrgentItem> = {}): UrgentItem {
  return {
    type: 'bid_deadline',
    priority: 1,
    title: 'Urgent Bid — deadline passed',
    detail: 'Deadline was 2 hours ago',
    href: '/bid/bid-1',
    entity_id: 'bid-1',
    ...overrides,
  };
}

function makeTeamChange(overrides: Partial<TeamChange> = {}): TeamChange {
  return {
    user_id: 'user-a',
    user_name: null,
    action: 'updated',
    entity_type: 'content_item',
    entity_id: 'item-1',
    entity_title: 'Updated Policy',
    domain: 'Corporate',
    created_at: '2026-03-08T09:00:00Z',
    ...overrides,
  };
}

function makeRecentWork(overrides: Partial<RecentWorkItem> = {}): RecentWorkItem {
  return {
    entity_type: 'content_item',
    entity_id: 'item-10',
    entity_title: 'My Article',
    action: 'edited',
    href: '/item/item-10',
    created_at: '2026-03-08T09:30:00Z',
    ...overrides,
  };
}

function makeReorientData(overrides: Partial<ReorientData> = {}): ReorientData {
  return {
    last_active_at: '2026-03-08T08:00:00Z',
    last_active_relative: '2 hours ago',
    urgent: [],
    team_changes: [],
    my_recent_work: [],
    bid_summary: [],
    counts: {
      unread_notifications: 0,
      pending_reviews: 0,
      stale_or_expired: 0,
      quality_flags: 0,
    },
    generated_at: '2026-03-08T10:00:00.000Z',
    user_display_name: 'Liam',
    errors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  sessionStorageMap.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReorientSection', () => {
  it('has aria-label="Personal briefing"', () => {
    render(<ReorientSection data={makeReorientData()} />);
    expect(screen.getByRole('region', { name: /personal briefing/i })).toBeInTheDocument();
  });

  it('renders welcome greeting with user name', () => {
    render(<ReorientSection data={makeReorientData({ user_display_name: 'Liam' })} />);
    // The greeting includes the name
    const statusEl = screen.getByRole('status');
    expect(statusEl.textContent).toContain('Liam');
  });

  it('renders greeting without name when user_display_name is null', () => {
    render(<ReorientSection data={makeReorientData({ user_display_name: null })} />);
    const statusEl = screen.getByRole('status');
    // Should have the greeting but not ", null"
    expect(statusEl.textContent).not.toContain('null');
    expect(statusEl.textContent).toMatch(/Good (morning|afternoon|evening)/);
  });

  it('includes last active time in greeting', () => {
    render(<ReorientSection data={makeReorientData({ last_active_relative: '3 hours ago' })} />);
    const statusEl = screen.getByRole('status');
    expect(statusEl.textContent).toContain('3 hours ago');
  });

  // ── Urgent items ──

  it('renders urgent items', () => {
    const data = makeReorientData({
      urgent: [
        makeUrgentItem({ title: 'Bid A — deadline passed', priority: 1 }),
        makeUrgentItem({
          type: 'content_expired',
          title: '5 content items need refreshing',
          priority: 2,
          href: '/browse?freshness=stale,expired',
          entity_id: 'freshness',
        }),
      ],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText('Needs your attention')).toBeInTheDocument();
    expect(screen.getByText('Bid A — deadline passed')).toBeInTheDocument();
    expect(screen.getByText('5 content items need refreshing')).toBeInTheDocument();
  });

  it('renders urgent items in priority order (as provided by data)', () => {
    const data = makeReorientData({
      urgent: [
        makeUrgentItem({ title: 'Priority 1 Item', priority: 1, entity_id: 'e1' }),
        makeUrgentItem({
          type: 'content_expired',
          title: 'Priority 2 Item',
          priority: 2,
          entity_id: 'e2',
        }),
        makeUrgentItem({
          type: 'review_pending',
          title: 'Priority 3 Item',
          priority: 3,
          entity_id: 'e3',
        }),
      ],
    });

    render(<ReorientSection data={data} />);

    const items = screen.getAllByRole('link').filter(
      (link) => link.getAttribute('aria-label')?.includes('Priority'),
    );
    expect(items).toHaveLength(3);
    // Order should match input (which is already sorted by priority)
    expect(items[0].textContent).toContain('Priority 1');
    expect(items[1].textContent).toContain('Priority 2');
    expect(items[2].textContent).toContain('Priority 3');
  });

  it('urgent items link to correct hrefs', () => {
    const data = makeReorientData({
      urgent: [
        makeUrgentItem({ href: '/bid/bid-42', entity_id: 'bid-42' }),
        makeUrgentItem({
          type: 'content_expired',
          href: '/browse?freshness=stale,expired',
          entity_id: 'freshness',
          title: 'Stale content',
        }),
      ],
    });

    render(<ReorientSection data={data} />);

    const links = screen.getAllByRole('link');
    const bidLink = links.find((l) => l.getAttribute('href') === '/bid/bid-42');
    const browseLink = links.find(
      (l) => l.getAttribute('href') === '/browse?freshness=stale,expired',
    );

    expect(bidLink).toBeDefined();
    expect(browseLink).toBeDefined();
  });

  // ── Team changes ──

  it('renders team changes block when changes exist', () => {
    const data = makeReorientData({
      team_changes: [
        makeTeamChange({ user_id: 'user-a', action: 'updated', domain: 'Corporate' }),
      ],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText('Since you were away')).toBeInTheDocument();
    // Should show the display name from the mock
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('hides team changes block when empty', () => {
    const data = makeReorientData({ team_changes: [] });

    render(<ReorientSection data={data} />);
    expect(screen.queryByText('Since you were away')).not.toBeInTheDocument();
  });

  // ── Recent work ──

  it('renders recent work block when items exist', () => {
    const data = makeReorientData({
      my_recent_work: [
        makeRecentWork({ entity_title: 'My Draft Article', href: '/item/item-20' }),
      ],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText('Pick up where you left off')).toBeInTheDocument();
    expect(screen.getByText('My Draft Article')).toBeInTheDocument();
  });

  it('hides recent work block when empty', () => {
    const data = makeReorientData({ my_recent_work: [] });

    render(<ReorientSection data={data} />);
    expect(screen.queryByText('Pick up where you left off')).not.toBeInTheDocument();
  });

  it('recent work items link to correct hrefs', () => {
    const data = makeReorientData({
      my_recent_work: [
        makeRecentWork({ entity_title: 'Linked Article', href: '/item/item-55' }),
      ],
    });

    render(<ReorientSection data={data} />);
    const link = screen.getByRole('link', { name: /Linked Article/i });
    expect(link).toHaveAttribute('href', '/item/item-55');
  });

  // ── Notification urgent items ──

  it('renders notification urgent items', () => {
    const data = makeReorientData({
      urgent: [
        makeUrgentItem({
          type: 'notification',
          title: '8 unread notifications',
          detail: 'You have unread notifications that may need attention',
          href: '/settings?tab=notifications',
          entity_id: 'notifications',
          priority: 3,
        }),
      ],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText('8 unread notifications')).toBeInTheDocument();
  });

  // ── Empty state ──

  it('shows empty state when all blocks are empty', () => {
    const data = makeReorientData({
      urgent: [],
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    expect(
      screen.getByText(/everything looks good/i),
    ).toBeInTheDocument();
  });

  it('does not show empty state when urgent items exist', () => {
    const data = makeReorientData({
      urgent: [makeUrgentItem()],
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    expect(screen.queryByText(/everything looks good/i)).not.toBeInTheDocument();
  });

  // ── First-login empty state ──

  it('shows welcome message for first-login users', () => {
    const data = makeReorientData({
      last_active_at: null,
      last_active_relative: '',
      urgent: [],
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    expect(
      screen.getByText(/welcome to knowledge hub/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/everything looks good/i),
    ).not.toBeInTheDocument();
  });

  it('shows standard empty state for returning users with no changes', () => {
    const data = makeReorientData({
      last_active_at: '2026-03-08T08:00:00Z',
      urgent: [],
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    expect(
      screen.getByText(/everything looks good/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/welcome to knowledge hub/i),
    ).not.toBeInTheDocument();
  });

  // ── Dismiss ──

  it('dismiss button hides section', async () => {
    const user = userEvent.setup();

    const data = makeReorientData({
      urgent: [makeUrgentItem()],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByRole('region', { name: /personal briefing/i })).toBeInTheDocument();

    const dismissBtn = screen.getByRole('button', { name: /dismiss briefing/i });
    await user.click(dismissBtn);

    // Section should no longer be in the document
    expect(screen.queryByRole('region', { name: /personal briefing/i })).not.toBeInTheDocument();

    // sessionStorage should be updated
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      'reorient-dismissed',
      expect.any(String),
    );
  });

  it('does not render when session was already dismissed', () => {
    sessionStorageMap.set('reorient-dismissed', '2026-03-08T10:00:00.000Z');

    render(<ReorientSection data={makeReorientData()} />);
    expect(screen.queryByRole('region', { name: /personal briefing/i })).not.toBeInTheDocument();
  });
});
