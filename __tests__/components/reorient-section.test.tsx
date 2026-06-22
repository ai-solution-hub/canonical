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
import type {
  ReorientData,
  TeamChange,
  RecentWorkItem,
} from '@/types/reorient';

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

// Mock useTaxonomy — we only exercise getDomainColourKey here.
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    domains: [],
    subtopics: [],
    loading: false,
    error: null,
    getDomainNames: () => [],
    getSubtopics: () => [],
    getDomainColourKey: (_name: string) => 'corporate',
    formatSubtopic: (s: string) => s,
    formatDomainName: (s: string) => s,
    refresh: () => {},
  }),
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
  setItem: vi.fn((key: string, value: string) =>
    sessionStorageMap.set(key, value),
  ),
  removeItem: vi.fn((key: string) => sessionStorageMap.delete(key)),
  clear: vi.fn(() => sessionStorageMap.clear()),
  get length() {
    return sessionStorageMap.size;
  },
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

function makeRecentWork(
  overrides: Partial<RecentWorkItem> = {},
): RecentWorkItem {
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
    has_display_name: true,
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
    expect(
      screen.getByRole('region', { name: /personal briefing/i }),
    ).toBeInTheDocument();
  });

  it('renders welcome greeting with user name', () => {
    render(
      <ReorientSection
        data={makeReorientData({ user_display_name: 'Liam' })}
      />,
    );
    // The greeting includes the name
    const statusEl = screen.getByRole('status');
    expect(statusEl.textContent).toContain('Liam');
  });

  it('renders greeting without name when user_display_name is null', () => {
    render(
      <ReorientSection data={makeReorientData({ user_display_name: null })} />,
    );
    const statusEl = screen.getByRole('status');
    // Should have the greeting but not ", null"
    expect(statusEl.textContent).not.toContain('null');
    expect(statusEl.textContent).toMatch(/Good (morning|afternoon|evening)/);
  });

  it('includes last active time in greeting', () => {
    render(
      <ReorientSection
        data={makeReorientData({ last_active_relative: '3 hours ago' })}
      />,
    );
    const statusEl = screen.getByRole('status');
    expect(statusEl.textContent).toContain('3 hours ago');
  });

  // ── Team changes ──

  it('renders team changes block when changes exist', () => {
    const data = makeReorientData({
      team_changes: [
        makeTeamChange({
          user_id: 'user-a',
          action: 'updated',
          domain: 'Corporate',
        }),
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
        makeRecentWork({
          entity_title: 'My Draft Article',
          href: '/item/item-20',
        }),
      ],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText('Pick up where you left off')).toBeInTheDocument();
    expect(screen.getByText('My Draft Article')).toBeInTheDocument();
  });

  it('hides recent work block when empty', () => {
    const data = makeReorientData({ my_recent_work: [] });

    render(<ReorientSection data={data} />);
    expect(
      screen.queryByText('Pick up where you left off'),
    ).not.toBeInTheDocument();
  });

  it('recent work items link to correct hrefs', () => {
    const data = makeReorientData({
      my_recent_work: [
        makeRecentWork({
          entity_title: 'Linked Article',
          href: '/item/item-55',
        }),
      ],
    });

    render(<ReorientSection data={data} />);
    const link = screen.getByRole('link', { name: /Linked Article/i });
    expect(link).toHaveAttribute('href', '/item/item-55');
  });

  // ── Empty state ──

  it('shows empty state when all blocks are empty', () => {
    const data = makeReorientData({
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText(/everything looks good/i)).toBeInTheDocument();
  });

  // ── First-login empty state ──

  it('shows welcome message for first-login users', () => {
    const data = makeReorientData({
      last_active_at: null,
      last_active_relative: '',
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText(/welcome to canonical/i)).toBeInTheDocument();
    // Viewer copy updated per spec §4.8
    expect(
      screen.getByText(/search the knowledge base to find what you need/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/everything looks good/i),
    ).not.toBeInTheDocument();
  });

  it('shows standard empty state for returning users with no changes', () => {
    const data = makeReorientData({
      last_active_at: '2026-03-08T08:00:00Z',
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    expect(screen.getByText(/everything looks good/i)).toBeInTheDocument();
    expect(screen.queryByText(/welcome to canonical/i)).not.toBeInTheDocument();
  });

  // ── hideFirstLoginMessage prop (P0-4 spec §7.3) ──

  // Test 16: First-login message hidden when prop set
  it('suppresses first-login one-liner when hideFirstLoginMessage is true', () => {
    const data = makeReorientData({
      last_active_at: null,
      last_active_relative: '',
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} hideFirstLoginMessage />);
    // The section still renders (greeting/display-name nudge), but the welcome one-liner is gone
    expect(
      screen.getByRole('region', { name: /personal briefing/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/welcome to canonical/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/search the knowledge base/i),
    ).not.toBeInTheDocument();
  });

  // Test 17: Viewer copy updated
  it('shows updated viewer copy for first-login users', () => {
    const data = makeReorientData({
      last_active_at: null,
      last_active_relative: '',
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} />);
    // Updated copy per spec §4.8 — no longer mentions "creating your first bid"
    expect(
      screen.getByText(/search the knowledge base to find what you need/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/creating your first bid/i),
    ).not.toBeInTheDocument();
  });

  // Test 18: Existing non-first-login behaviour unchanged
  it('returns standard empty state for non-first-login users regardless of hideFirstLoginMessage', () => {
    const data = makeReorientData({
      last_active_at: '2026-03-08T08:00:00Z',
      team_changes: [],
      my_recent_work: [],
    });

    render(<ReorientSection data={data} hideFirstLoginMessage />);
    expect(screen.getByText(/everything looks good/i)).toBeInTheDocument();
  });

  // ── Dismiss ──

  it('dismiss button hides section', async () => {
    const user = userEvent.setup();

    const data = makeReorientData({
      team_changes: [makeTeamChange({ user_id: 'user-a', action: 'updated' })],
    });

    render(<ReorientSection data={data} />);
    expect(
      screen.getByRole('region', { name: /personal briefing/i }),
    ).toBeInTheDocument();

    const dismissBtn = screen.getByRole('button', {
      name: /dismiss briefing/i,
    });
    await user.click(dismissBtn);

    // Section should no longer be in the document
    expect(
      screen.queryByRole('region', { name: /personal briefing/i }),
    ).not.toBeInTheDocument();

    // sessionStorage should be updated
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      'reorient-dismissed',
      expect.any(String),
    );
  });

  it('does not render when session was already dismissed', () => {
    sessionStorageMap.set('reorient-dismissed', '2026-03-08T10:00:00.000Z');

    render(<ReorientSection data={makeReorientData()} />);
    expect(
      screen.queryByRole('region', { name: /personal briefing/i }),
    ).not.toBeInTheDocument();
  });
});
