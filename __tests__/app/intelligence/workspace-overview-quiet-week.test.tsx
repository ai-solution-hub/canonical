/**
 * Workspace overview — quiet-week collapse behaviour (P1-14).
 *
 * Asserts:
 * - Quiet week (zero flags, zero passed, sources healthy) renders a collapsed
 *   <details> summary and hides detail sections behind the toggle.
 * - Active week (any flag or any passed article) renders the full layout with
 *   all sections visible.
 * - Unhealthy sources with zero activity still shows HealthPanel; quiet-week
 *   collapse does NOT apply when sources have errors.
 * - HealthPanel is always rendered regardless of quiet state.
 * - Quick Actions are always visible regardless of quiet state.
 * - deriveIsQuietWeek returns false when metrics are undefined (loading).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockUseUserRole,
  mockUseParams,
  mockUseIntelligenceMetrics,
  mockUseIntelligenceWorkspace,
  mockUseFeedArticles,
  mockUseTriggerPoll,
} = vi.hoisted(() => {
  const mockMutate = vi.fn();
  return {
    mockUseUserRole: vi.fn(),
    mockUseParams: vi.fn(),
    mockUseIntelligenceMetrics: vi.fn(),
    mockUseIntelligenceWorkspace: vi.fn(),
    mockUseFeedArticles: vi.fn(),
    mockUseTriggerPoll: vi.fn().mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    }),
  };
});

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('@/hooks/intelligence/use-intelligence-metrics', () => ({
  useIntelligenceMetrics: (...args: unknown[]) =>
    mockUseIntelligenceMetrics(...args),
}));

vi.mock('@/hooks/intelligence/use-intelligence-workspaces', () => ({
  useIntelligenceWorkspace: (...args: unknown[]) =>
    mockUseIntelligenceWorkspace(...args),
}));

vi.mock('@/hooks/intelligence/use-feed-articles', () => ({
  useFeedArticles: (...args: unknown[]) => mockUseFeedArticles(...args),
}));

vi.mock('@/hooks/intelligence/use-trigger-poll', () => ({
  useTriggerPoll: (...args: unknown[]) => mockUseTriggerPoll(...args),
}));

// Stub heavy child components — the overview page does not test their internals
vi.mock('@/components/intelligence/health-panel', () => ({
  HealthPanel: () => <div data-testid="health-panel" />,
}));

vi.mock('@/components/intelligence/metrics-panel', () => ({
  MetricsPanel: () => <div data-testid="metrics-panel" />,
}));

vi.mock('@/components/intelligence/rss-feed-panel', () => ({
  RssFeedPanel: () => <div data-testid="rss-feed-panel" />,
}));

vi.mock('@/lib/intelligence/relevance-display', () => ({
  getRelevanceLabel: (score: number) => `score:${score}`,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import WorkspaceOverviewPage, {
  deriveIsQuietWeek,
} from '@/app/intelligence/[workspaceId]/page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** Base quiet metrics: zero passed, zero flags, zero source errors. */
function quietMetrics() {
  return {
    total_articles: 20,
    passed_articles: 0,
    filtered_articles: 20,
    filter_ratio: 1,
    total_flags: 0,
    false_positive_flags: 0,
    false_negative_flags: 0,
    unresolved_flags: 0,
    last_poll_time: '2026-04-22T10:00:00Z',
    active_sources: 3,
    sources_with_errors: 0,
    recent_flags: [],
    period: '30d',
  };
}

/** Active metrics: some passed articles and an unresolved flag. */
function activeMetrics() {
  return {
    ...quietMetrics(),
    passed_articles: 5,
    unresolved_flags: 1,
    recent_flags: [
      {
        id: 'flag-1',
        flag_type: 'false_positive' as const,
        notes: 'test flag',
        created_at: '2026-04-22T09:00:00Z',
        article_title: 'Flagged Article',
      },
    ],
  };
}

/** Unhealthy metrics: sources have errors but zero activity otherwise. */
function unhealthyMetrics() {
  return {
    ...quietMetrics(),
    sources_with_errors: 2,
  };
}

function setupDefaults(metricsData = quietMetrics()) {
  mockUseParams.mockReturnValue({ workspaceId: WORKSPACE_ID });
  mockUseUserRole.mockReturnValue({
    role: 'admin',
    loading: false,
    canEdit: true,
    canAdmin: true,
  });
  mockUseIntelligenceMetrics.mockReturnValue({
    data: metricsData,
    isLoading: false,
  });
  mockUseIntelligenceWorkspace.mockReturnValue({
    data: { name: 'Test Workspace', domain_metadata: {} },
  });
  mockUseFeedArticles.mockReturnValue({ data: { articles: [] } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveIsQuietWeek', () => {
  it('returns false when metrics are undefined (loading state)', () => {
    expect(deriveIsQuietWeek(undefined)).toBe(false);
  });

  it('returns true when zero passed, zero flags, zero source errors', () => {
    expect(deriveIsQuietWeek(quietMetrics())).toBe(true);
  });

  it('returns false when passed_articles > 0', () => {
    expect(deriveIsQuietWeek({ ...quietMetrics(), passed_articles: 3 })).toBe(
      false,
    );
  });

  it('returns false when unresolved_flags > 0', () => {
    expect(deriveIsQuietWeek({ ...quietMetrics(), unresolved_flags: 1 })).toBe(
      false,
    );
  });

  it('returns false when sources_with_errors > 0', () => {
    expect(
      deriveIsQuietWeek({ ...quietMetrics(), sources_with_errors: 1 }),
    ).toBe(false);
  });
});

describe('WorkspaceOverviewPage — quiet-week collapse (P1-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collapses detail sections behind a toggle on a quiet week', () => {
    setupDefaults(quietMetrics());
    render(<WorkspaceOverviewPage />);

    // The collapse container should be present
    const details = screen.getByTestId('quiet-week-collapse');
    expect(details).toBeInTheDocument();
    expect(details.tagName.toLowerCase()).toBe('details');

    // Summary text is visible
    expect(screen.getByText(/No new activity this period/)).toBeInTheDocument();

    // Detail sections are NOT visible (details is closed)
    // MetricsPanel and RssFeedPanel are inside the collapsed region
    expect(details).not.toHaveAttribute('open');
  });

  it('renders full layout on an active week (flags or passed articles)', () => {
    setupDefaults(activeMetrics());
    render(<WorkspaceOverviewPage />);

    // No collapse container
    expect(screen.queryByTestId('quiet-week-collapse')).not.toBeInTheDocument();

    // MetricsPanel and RssFeedPanel are directly visible
    expect(screen.getByTestId('metrics-panel')).toBeInTheDocument();
    expect(screen.getByTestId('rss-feed-panel')).toBeInTheDocument();
  });

  it('does NOT collapse when sources have errors (unhealthy)', () => {
    setupDefaults(unhealthyMetrics());
    render(<WorkspaceOverviewPage />);

    // No collapse — sources_with_errors > 0 breaks the quiet condition
    expect(screen.queryByTestId('quiet-week-collapse')).not.toBeInTheDocument();

    // Full layout shown
    expect(screen.getByTestId('metrics-panel')).toBeInTheDocument();
  });

  it('always renders HealthPanel regardless of quiet state', () => {
    // Quiet week
    setupDefaults(quietMetrics());
    const { unmount } = render(<WorkspaceOverviewPage />);
    expect(screen.getByTestId('health-panel')).toBeInTheDocument();
    unmount();

    // Active week
    setupDefaults(activeMetrics());
    render(<WorkspaceOverviewPage />);
    expect(screen.getByTestId('health-panel')).toBeInTheDocument();
  });

  it('always renders Quick Actions regardless of quiet state', () => {
    setupDefaults(quietMetrics());
    render(<WorkspaceOverviewPage />);

    // Quick Actions heading and buttons are visible
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Manage Sources/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Review Articles/ }),
    ).toBeInTheDocument();
  });

  it('reveals detail sections when the toggle is opened on a quiet week', () => {
    setupDefaults(quietMetrics());
    render(<WorkspaceOverviewPage />);

    const details = screen.getByTestId(
      'quiet-week-collapse',
    ) as HTMLDetailsElement;

    // Simulate opening
    details.open = true;
    details.dispatchEvent(new Event('toggle'));

    // The detail content container exists
    expect(screen.getByTestId('quiet-week-details')).toBeInTheDocument();
  });
});
