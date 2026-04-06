/**
 * HealthPanel — component tests.
 *
 * Verifies the panel renders the correct status (healthy/degraded/failing),
 * shows stale-run warnings, expands the per-source breakdown, renders the
 * loading skeleton, and exposes a working retry button on error.
 *
 * Tests assert what the user actually sees in each state — badge text,
 * warning copy, expanded source rows — not just that the component renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HealthPanel } from '@/components/intelligence/health-panel';
import type { WorkspaceHealthResponse } from '@/hooks/intelligence/use-workspace-health';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** Pin Date.now() so relative-time formatting is deterministic. */
const FIXED_NOW = new Date('2026-04-06T12:00:00.000Z').getTime();

function pinTime() {
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
}

function buildHealthyResponse(): WorkspaceHealthResponse {
  return {
    pipeline: {
      lastSuccessfulRun: new Date(FIXED_NOW - 12 * 60 * 1000).toISOString(),
      timeSinceLastRunMs: 12 * 60 * 1000,
      sourcesWithFailures: 0,
      sourcesAtFailureLimit: 0,
      totalActiveSources: 3,
      healthy: true,
      statusMessage: 'Pipeline is healthy',
    },
    sources: {
      workspaceId: 'ws-1',
      sources: [
        {
          id: 's1',
          name: 'DfE Feed',
          url: 'https://www.gov.uk/dfe.atom',
          lastPolledAt: new Date(
            FIXED_NOW - 5 * 60 * 1000,
          ).toISOString(),
          lastPolledStatus: 'success',
          lastPolledError: null,
          consecutiveFailures: 0,
          pollingIntervalMinutes: 30,
          articleCount: 10,
        },
      ],
      healthySources: 1,
      failingSources: 0,
      disabledSources: 0,
    },
  };
}

function buildDegradedResponse(): WorkspaceHealthResponse {
  return {
    pipeline: {
      lastSuccessfulRun: new Date(FIXED_NOW - 15 * 60 * 1000).toISOString(),
      timeSinceLastRunMs: 15 * 60 * 1000,
      sourcesWithFailures: 2,
      sourcesAtFailureLimit: 0,
      totalActiveSources: 5,
      healthy: true,
      statusMessage: 'Pipeline is healthy',
    },
    sources: {
      workspaceId: 'ws-1',
      sources: [
        {
          id: 's1',
          name: 'Healthy Feed',
          url: 'https://example.com/healthy.rss',
          lastPolledAt: new Date(
            FIXED_NOW - 5 * 60 * 1000,
          ).toISOString(),
          lastPolledStatus: 'success',
          lastPolledError: null,
          consecutiveFailures: 0,
          pollingIntervalMinutes: 30,
          articleCount: 22,
        },
        {
          id: 's2',
          name: 'Flaky Feed',
          url: 'https://example.com/flaky.rss',
          lastPolledAt: new Date(
            FIXED_NOW - 30 * 60 * 1000,
          ).toISOString(),
          lastPolledStatus: 'error',
          lastPolledError: 'Connection timeout',
          consecutiveFailures: 3,
          pollingIntervalMinutes: 60,
          articleCount: 5,
        },
      ],
      healthySources: 3,
      failingSources: 2,
      disabledSources: 0,
    },
  };
}

function buildFailingResponse(): WorkspaceHealthResponse {
  return {
    pipeline: {
      lastSuccessfulRun: new Date(
        FIXED_NOW - 48 * 60 * 60 * 1000,
      ).toISOString(),
      timeSinceLastRunMs: 48 * 60 * 60 * 1000,
      sourcesWithFailures: 3,
      sourcesAtFailureLimit: 1,
      totalActiveSources: 5,
      healthy: false,
      statusMessage: '1 source(s) at failure limit',
    },
    sources: {
      workspaceId: 'ws-1',
      sources: [
        {
          id: 's1',
          name: 'Dead Feed',
          url: 'https://broken.example.com/feed',
          lastPolledAt: new Date(
            FIXED_NOW - 4 * 60 * 60 * 1000,
          ).toISOString(),
          lastPolledStatus: 'error',
          lastPolledError: 'HTTP 500 Internal Server Error',
          consecutiveFailures: 10,
          pollingIntervalMinutes: 30,
          articleCount: 0,
        },
      ],
      healthySources: 4,
      failingSources: 1,
      disabledSources: 1,
    },
  };
}

function buildStaleResponse(): WorkspaceHealthResponse {
  return {
    pipeline: {
      lastSuccessfulRun: new Date(
        FIXED_NOW - 90 * 60 * 1000,
      ).toISOString(),
      // 90 minutes — well over the 30-minute stale threshold but under the
      // 24-hour "unhealthy" threshold so the pipeline still reports healthy.
      timeSinceLastRunMs: 90 * 60 * 1000,
      sourcesWithFailures: 0,
      sourcesAtFailureLimit: 0,
      totalActiveSources: 3,
      healthy: true,
      statusMessage: 'Pipeline is healthy',
    },
    sources: {
      workspaceId: 'ws-1',
      sources: [],
      healthySources: 0,
      failingSources: 0,
      disabledSources: 0,
    },
  };
}

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetch(response: WorkspaceHealthResponse) {
  mockFetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', mockFetch);
}

function stubFetchError(message: string) {
  mockFetch = vi.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: message }),
  }));
  vi.stubGlobal('fetch', mockFetch);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pinTime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it('renders the loading skeleton while the request is pending', () => {
    // Stub fetch with a never-resolving promise so we stay in loading state.
    mockFetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', mockFetch);

    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    expect(
      screen.getByRole('status', { name: 'Loading pipeline health' }),
    ).toBeInTheDocument();
    // Status badge text should NOT yet be present.
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Healthy state
  // -------------------------------------------------------------------------

  it('renders a green Healthy badge when the pipeline is healthy', async () => {
    stubFetch(buildHealthyResponse());
    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Healthy')).toBeInTheDocument();
    });

    const badge = screen.getByLabelText('Status: Healthy');
    expect(badge).toHaveTextContent('Healthy');
    // Status-success token classes for the green badge.
    expect(badge.className).toMatch(/text-status-success/);
    expect(badge.className).toMatch(/bg-status-success/);

    // Status message and stats grid render.
    expect(screen.getByText('Pipeline is healthy')).toBeInTheDocument();

    // Both "Last successful run" and "Time since last run" stats render
    // the same relative time when called immediately after a run.
    const lastRunLabel = screen.getByText('Last successful run');
    const lastRunCard = lastRunLabel.closest('div');
    expect(lastRunCard).not.toBeNull();
    expect(
      within(lastRunCard as HTMLElement).getByText('12 minutes ago'),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Degraded state
  // -------------------------------------------------------------------------

  it('renders an amber Degraded badge when sources have failures', async () => {
    stubFetch(buildDegradedResponse());
    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Degraded')).toBeInTheDocument();
    });

    const badge = screen.getByLabelText('Status: Degraded');
    expect(badge).toHaveTextContent('Degraded');
    expect(badge.className).toMatch(/text-status-warning/);
    expect(badge.className).toMatch(/bg-status-warning/);

    // Sources-with-failures stat shows "2".
    const failuresLabel = screen.getByText('Sources with failures');
    const failuresCard = failuresLabel.closest('div');
    expect(failuresCard).not.toBeNull();
    expect(within(failuresCard as HTMLElement).getByText('2')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Failing state
  // -------------------------------------------------------------------------

  it('renders a red Failing badge when sources are at the failure limit', async () => {
    stubFetch(buildFailingResponse());
    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Failing')).toBeInTheDocument();
    });

    const badge = screen.getByLabelText('Status: Failing');
    expect(badge).toHaveTextContent('Failing');
    expect(badge.className).toMatch(/text-status-error/);
    expect(badge.className).toMatch(/bg-status-error/);

    // Status message from API surfaces.
    expect(
      screen.getByText('1 source(s) at failure limit'),
    ).toBeInTheDocument();

    // "At failure limit" stat shows "1".
    const limitLabel = screen.getByText('At failure limit');
    const limitCard = limitLabel.closest('div');
    expect(limitCard).not.toBeNull();
    expect(within(limitCard as HTMLElement).getByText('1')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Stale-run warning
  // -------------------------------------------------------------------------

  it('shows a stale warning when the time since last run exceeds 30 minutes', async () => {
    stubFetch(buildStaleResponse());
    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Degraded')).toBeInTheDocument();
    });

    // Both stat cards display "1 hour ago" (last successful run + time since
    // last run resolve to the same relative duration in this scenario).
    expect(screen.getAllByText('1 hour ago').length).toBeGreaterThanOrEqual(1);

    // The "Pipeline is stale" warning copy should be visible.
    expect(screen.getByText('Pipeline is stale')).toBeInTheDocument();

    // The "Time since last run" card should be styled as a warning.
    const sinceLabel = screen.getByText('Time since last run');
    const sinceCard = sinceLabel.closest('div');
    expect(sinceCard).not.toBeNull();
    expect((sinceCard as HTMLElement).className).toMatch(
      /border-status-warning/,
    );
  });

  // -------------------------------------------------------------------------
  // Per-source breakdown — collapse / expand
  // -------------------------------------------------------------------------

  it('expands the per-source breakdown when the toggle is clicked', async () => {
    const user = userEvent.setup();
    stubFetch(buildDegradedResponse());
    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Degraded')).toBeInTheDocument();
    });

    // Source list should not exist before expansion.
    expect(screen.queryByTestId('source-breakdown')).not.toBeInTheDocument();
    // Source names should also not be visible yet.
    expect(screen.queryByText('Flaky Feed')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', {
      name: /Per-source breakdown/i,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    // After click the breakdown is visible and contains both source names.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByTestId('source-breakdown');
    expect(list).toBeInTheDocument();
    expect(within(list).getByText('Healthy Feed')).toBeInTheDocument();
    expect(within(list).getByText('Flaky Feed')).toBeInTheDocument();
    // The error message from the failing source should also surface.
    expect(within(list).getByText('Connection timeout')).toBeInTheDocument();
    // The "3 consecutive failures" indicator should be visible.
    expect(
      within(list).getByText('3 consecutive failures'),
    ).toBeInTheDocument();
  });

  it('collapses the breakdown again when the toggle is clicked twice', async () => {
    const user = userEvent.setup();
    stubFetch(buildDegradedResponse());
    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Degraded')).toBeInTheDocument();
    });

    const toggle = screen.getByRole('button', {
      name: /Per-source breakdown/i,
    });
    await user.click(toggle);
    expect(screen.getByTestId('source-breakdown')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByTestId('source-breakdown')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  it('renders an error state with a working retry button on fetch failure', async () => {
    const user = userEvent.setup();
    stubFetchError('Failed to fetch pipeline health');

    renderWithQuery(<HealthPanel workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Could not load pipeline health'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Failed to fetch pipeline health'),
    ).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /Retry/i });
    expect(retryButton).toBeInTheDocument();

    // Switch the mock to a success response and click retry.
    const callsBefore = mockFetch.mock.calls.length;
    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => buildHealthyResponse(),
    }));

    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Healthy')).toBeInTheDocument();
    });
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
