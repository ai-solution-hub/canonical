/**
 * Tests for PipelineHealthTab component.
 *
 * Validates rendering, filter interactions, drawer behaviour, empty state,
 * and load-more pagination.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PipelineRollupEntry } from '@/app/api/admin/provenance/pipeline-runs/route';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockPush, mockSearchParams } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockPush: vi.fn(),
  mockSearchParams: { value: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/provenance',
  useSearchParams: () => mockSearchParams.value,
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import PipelineHealthTab from '@/components/provenance/pipeline-health-tab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRollupEntry(
  overrides: Partial<PipelineRollupEntry> & { pipelineName: string },
): PipelineRollupEntry {
  return {
    runs: 5,
    completed: 4,
    failed: 0,
    running: 0,
    completedWithErrors: 1,
    successPct: 100,
    avgDurationMs: 5000,
    p95DurationMs: 8000,
    lastRunAt: '2026-04-16T10:00:00.000Z',
    ...overrides,
  };
}

interface MockRow {
  id: string;
  pipeline_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  items_processed: number | null;
  error_message: string | null;
  source_filename: string | null;
  workspace_id: string | null;
  created_by: string | null;
  result: unknown;
  progress: unknown;
  items_created: string[] | null;
  cost: number | null;
}

function makeRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    pipeline_name: 'content_gaps',
    status: 'completed',
    started_at: '2026-04-16T08:00:00.000Z',
    completed_at: '2026-04-16T08:01:00.000Z',
    items_processed: 10,
    error_message: null,
    source_filename: null,
    workspace_id: null,
    created_by: null,
    result: null,
    progress: null,
    items_created: null,
    cost: null,
    ...overrides,
  };
}

function mockFetchResponse(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset();
  mockPush.mockReset();
  mockSearchParams.value = new URLSearchParams();
  vi.stubGlobal('fetch', mockFetch);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineHealthTab', () => {
  it('renders list and rollup cards after loading', async () => {
    mockFetchResponse({
      rows: [makeRow()],
      rollup: [makeRollupEntry({ pipelineName: 'content_gaps' })],
      hasMore: false,
      nextCursor: null,
      window: { range: '24h', since: '2026-04-15T08:00:00.000Z' },
    });

    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    // Wait for loading to finish — "content gaps" appears in multiple places
    // (filter pill, rollup card, table row), so check for a rollup-specific element
    await waitFor(() => {
      expect(screen.getByText('Runs')).toBeInTheDocument();
    });

    // Rollup card should show
    expect(screen.getByText('Success')).toBeInTheDocument();
    // Table should have rows
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows empty state when no rows exist', async () => {
    mockFetchResponse({
      rows: [],
      rollup: [],
      hasMore: false,
      nextCursor: null,
      window: { range: '24h', since: '2026-04-15T08:00:00.000Z' },
    });

    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByText('No pipeline runs in this window'),
      ).toBeInTheDocument();
    });
  });

  it('range change updates URL search params', async () => {
    mockFetchResponse({
      rows: [],
      rollup: [],
      hasMore: false,
      nextCursor: null,
      window: { range: '24h', since: '2026-04-15T08:00:00.000Z' },
    });

    const user = userEvent.setup();
    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByText('No pipeline runs in this window'),
      ).toBeInTheDocument();
    });

    // Mock fetch for the new range query
    mockFetchResponse({
      rows: [],
      rollup: [],
      hasMore: false,
      nextCursor: null,
      window: { range: '7d', since: '2026-04-09T08:00:00.000Z' },
    });

    // Click the "7 days" button
    const btn7d = screen.getByText('7 days');
    await user.click(btn7d);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('range=7d'),
      expect.anything(),
    );
  });

  it('kind filter updates URL search params', async () => {
    mockFetchResponse({
      rows: [makeRow()],
      rollup: [
        makeRollupEntry({ pipelineName: 'content_gaps' }),
        makeRollupEntry({ pipelineName: 'freshness' }),
      ],
      hasMore: false,
      nextCursor: null,
      window: { range: '24h', since: '2026-04-15T08:00:00.000Z' },
    });

    const user = userEvent.setup();
    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Click a kind filter pill — these are in the Pipeline filter group
    const filterGroup = screen.getByRole('group', { name: 'Pipeline filter' });
    const kindPill = filterGroup.querySelector('button');
    expect(kindPill).toBeTruthy();

    if (kindPill) {
      await user.click(kindPill);
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('kinds=content_gaps'),
        expect.anything(),
      );
    }
  });

  it('clicking a failed row opens the drawer', async () => {
    const failedRow = makeRow({
      id: 'a0000000-0000-4000-8000-000000000002',
      pipeline_name: 'failing_pipeline',
      status: 'failed',
      error_message: 'Connection timeout',
      completed_at: null,
    });

    mockFetchResponse({
      rows: [failedRow],
      rollup: [
        makeRollupEntry({
          pipelineName: 'failing_pipeline',
          failed: 1,
          successPct: 0,
        }),
      ],
      hasMore: false,
      nextCursor: null,
      window: { range: '24h', since: '2026-04-15T08:00:00.000Z' },
    });

    const user = userEvent.setup();
    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Click the failed row — it has role="button" in the table body
    const table = screen.getByRole('table');
    const clickableRow = table.querySelector('tbody tr[role="button"]');
    expect(clickableRow).toBeTruthy();
    await user.click(clickableRow!);

    // Drawer should show error message
    await waitFor(() => {
      expect(screen.getByText('Connection timeout')).toBeInTheDocument();
    });
  });

  it('completed row does not open the drawer', async () => {
    const completedRow = makeRow({
      status: 'completed',
    });

    mockFetchResponse({
      rows: [completedRow],
      rollup: [makeRollupEntry({ pipelineName: 'content_gaps' })],
      hasMore: false,
      nextCursor: null,
      window: { range: '24h', since: '2026-04-15T08:00:00.000Z' },
    });

    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Completed rows should not have role="button"
    const table = screen.getByRole('table');
    const tableRows = table.querySelectorAll('tbody tr');
    expect(tableRows).toHaveLength(1);
    expect(tableRows[0].getAttribute('role')).not.toBe('button');
  });

  it('shows load more button when hasMore is true', async () => {
    mockFetchResponse({
      rows: [makeRow()],
      rollup: [makeRollupEntry({ pipelineName: 'content_gaps' })],
      hasMore: true,
      nextCursor: {
        started_at: '2026-04-16T07:00:00.000Z',
        id: 'a0000000-0000-4000-8000-000000000050',
      },
      window: { range: '24h', since: '2026-04-15T08:00:00.000Z' },
    });

    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });
  });

  it('shows error state when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal error' }),
    });

    render(<PipelineHealthTab />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load pipeline runs/),
      ).toBeInTheDocument();
    });
  });
});
