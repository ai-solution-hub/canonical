/**
 * Component tests for the CostTabStub.
 *
 * Acceptance (ID-104.15 / testStrategy):
 * - The cost tab reads a real persisted `ai_call_events` aggregate keyed by
 *   `touchpoint_id` (not the `pipeline_runs` stub).
 * - No fourth observability surface is created.
 * - Semantic tokens only.
 * - `bun run test` clean.
 *
 * Test strategy: mock the TanStack Query hook result that wraps
 * `fetchEvalCostAggregate`. This proves:
 *  (a) the component calls `useQuery` with the `evalCostAggregate` key
 *      (not a raw `useEffect`/`createClient` call);
 *  (b) loading, error, and data states render correctly;
 *  (c) the stub-label banner is present with updated copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Hoist mock variables before vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @tanstack/react-query — intercept useQuery to control hook state
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...original,
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import CostTabStub from '@/components/provenance/cost-tab-stub';
import { queryKeys } from '@/lib/query/query-keys';
import type { EvalCostAggregateResult } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('CostTabStub', () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  // -------------------------------------------------------------------------
  // B-INV-17 — the component MUST use the evalCostAggregate query key
  // (not the pipeline_runs interim key / raw useEffect fetch)
  // -------------------------------------------------------------------------
  it('calls useQuery with the evalCostAggregate query key (B-INV-17)', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithQuery(<CostTabStub />);

    expect(mockUseQuery).toHaveBeenCalledOnce();
    const [options] = mockUseQuery.mock.calls[0] as [{ queryKey: unknown[] }];
    // The query key must match queryKeys.eval.costAggregate (not a pipeline_runs key)
    expect(options.queryKey).toEqual(queryKeys.eval.costAggregate);
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  it('renders a loading spinner while isLoading is true', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithQuery(<CostTabStub />);

    expect(screen.getByLabelText('Loading cost data')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------
  it('renders an error message when isError is true', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderWithQuery(<CostTabStub />);

    expect(screen.getByText(/could not load cost data/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Empty state — no ai_call_events rows yet
  // -------------------------------------------------------------------------
  it('renders the empty state when totalCost is null', () => {
    const emptyData: EvalCostAggregateResult = {
      totalCostUsd: null,
      callCount: 0,
      touchpointCount: 0,
    };
    mockUseQuery.mockReturnValue({
      data: emptyData,
      isLoading: false,
      isError: false,
    });

    renderWithQuery(<CostTabStub />);

    expect(screen.getByText(/no cost data recorded/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Data state — real ai_call_events aggregate
  // -------------------------------------------------------------------------
  it('renders the cost aggregate from ai_call_events when data is present', () => {
    const aggregateData: EvalCostAggregateResult = {
      totalCostUsd: 0.0142,
      callCount: 7,
      touchpointCount: 3,
    };
    mockUseQuery.mockReturnValue({
      data: aggregateData,
      isLoading: false,
      isError: false,
    });

    renderWithQuery(<CostTabStub />);

    // Total cost is shown
    expect(screen.getByText(/\$0\.0142/)).toBeInTheDocument();
    // Call count / touchpoint count visible
    expect(screen.getByText(/7/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Stub-label banner — must remain present (no fourth surface)
  // -------------------------------------------------------------------------
  it('retains the stub-label banner (B-INV-17 — no fourth surface)', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithQuery(<CostTabStub />);

    expect(screen.getByTestId('stub-label')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Banner copy — updated to reflect real ai_call_events data source
  // -------------------------------------------------------------------------
  it('banner does NOT reference pipeline_runs (data source is ai_call_events)', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithQuery(<CostTabStub />);

    // The old stub read pipeline_runs; the new one reads ai_call_events.
    // The banner copy should not mention pipeline runs.
    const banner = screen.getByTestId('stub-label');
    expect(banner.textContent).not.toMatch(/pipeline.?run/i);
  });
});
