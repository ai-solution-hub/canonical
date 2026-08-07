/**
 * Workspace overview — Trigger Poll button behaviour.
 *
 * Asserts:
 * - Admin sees the button, viewer does not
 * - Clicking fires the mutation
 * - Button shows pending state while mutation runs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  mockMutate,
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
    mockMutate,
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

// Stub heavy child components
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

import WorkspaceOverviewPage from '@/app/intelligence/[workspaceId]/page';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function setupDefaults() {
  mockUseParams.mockReturnValue({ workspaceId: WORKSPACE_ID });
  mockUseIntelligenceMetrics.mockReturnValue({
    data: {
      total_ingested: 10,
      total_passed: 5,
      filter_ratio: 0.5,
      recent_flags: [],
      unresolved_flags: 0,
    },
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

describe('WorkspaceOverviewPage — Trigger Poll button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it('renders the Trigger Poll button for admin users', () => {
    mockUseUserRole.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });

    render(<WorkspaceOverviewPage />);

    const button = screen.getByRole('button', { name: /Trigger Poll/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('does not render the Trigger Poll button for viewer users', () => {
    mockUseUserRole.mockReturnValue({
      role: 'viewer',
      loading: false,
      canEdit: false,
      canAdmin: false,
    });

    render(<WorkspaceOverviewPage />);

    expect(
      screen.queryByRole('button', { name: /Trigger Poll/i }),
    ).not.toBeInTheDocument();
  });

  it('does not render the Trigger Poll button for editor users', () => {
    mockUseUserRole.mockReturnValue({
      role: 'editor',
      loading: false,
      canEdit: true,
      canAdmin: false,
    });

    render(<WorkspaceOverviewPage />);

    expect(
      screen.queryByRole('button', { name: /Trigger Poll/i }),
    ).not.toBeInTheDocument();
  });

  it('calls mutate when clicked', async () => {
    mockUseUserRole.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });

    render(<WorkspaceOverviewPage />);

    const button = screen.getByRole('button', { name: /Trigger Poll/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledOnce();
    });
  });

  it('shows pending state while mutation is running', () => {
    mockUseUserRole.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });
    mockUseTriggerPoll.mockReturnValue({
      mutate: mockMutate,
      isPending: true,
    });

    render(<WorkspaceOverviewPage />);

    const button = screen.getByRole('button', { name: /Polling/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });
});
