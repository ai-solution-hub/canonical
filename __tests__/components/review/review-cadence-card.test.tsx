/**
 * ReviewCadenceCard — component tests.
 *
 * Tests loading state, error state, metric display, domain breakdown,
 * overdue items list, and collapsible behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewCadenceCard } from '@/components/review/review-cadence-card';
import type { ReviewCadenceResponse } from '@/app/api/review/cadence/route';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeCadenceData(overrides: Partial<ReviewCadenceResponse> = {}): ReviewCadenceResponse {
  return {
    summary: {
      total_items: 100,
      never_reviewed: 20,
      reviewed_last_7_days: 10,
      reviewed_last_30_days: 30,
      reviewed_last_90_days: 60,
      overdue: 25,
      average_days_since_review: 45,
      ...overrides.summary,
    },
    overdue_items: overrides.overdue_items ?? [
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Stale Technology Article',
        primary_domain: 'Technology',
        verified_at: '2025-12-01T00:00:00Z',
        days_since_review: 115,
        governance_review_status: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        title: 'Never Reviewed Item',
        primary_domain: 'Operations',
        verified_at: null,
        days_since_review: -1,
        governance_review_status: null,
      },
    ],
    by_domain: overrides.by_domain ?? {
      Technology: { total: 50, never_reviewed: 10, average_days: 40, overdue: 12 },
      Operations: { total: 30, never_reviewed: 8, average_days: 55, overdue: 10 },
      'HR & People': { total: 20, never_reviewed: 2, average_days: 30, overdue: 3 },
    },
  };
}

function mockSuccessResponse(data: ReviewCadenceResponse = makeCadenceData()) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function mockErrorResponse(status = 500, error = 'Server error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewCadenceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- Loading state --

  it('shows loading skeleton initially', () => {
    // Never resolve the fetch
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(<ReviewCadenceCard />);

    expect(screen.getByRole('status', { name: /loading review health/i })).toBeInTheDocument();
    expect(screen.getByText('Review Health')).toBeInTheDocument();
  });

  // -- Error state --

  it('shows error message on fetch failure', async () => {
    mockErrorResponse(500, 'Failed to fetch');

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    });
  });

  // -- Successful data display --

  it('displays key metrics from summary', async () => {
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      // Metrics appear in the list items
      const metricCells = screen.getAllByRole('listitem');
      expect(metricCells.length).toBeGreaterThanOrEqual(3);
    });

    // Check the metric labels render (some appear in both metrics and table)
    expect(screen.getAllByText('Never reviewed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Avg. days since review')).toBeInTheDocument();
    expect(screen.getAllByText('Overdue').length).toBeGreaterThanOrEqual(1);
  });

  it('displays overdue badge in header when overdue > 0', async () => {
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByText('25 overdue')).toBeInTheDocument();
    });
  });

  it('does not display overdue badge when no items overdue', async () => {
    const data = makeCadenceData({
      summary: {
        total_items: 10,
        never_reviewed: 0,
        reviewed_last_7_days: 5,
        reviewed_last_30_days: 10,
        reviewed_last_90_days: 10,
        overdue: 0,
        average_days_since_review: 5,
      },
      overdue_items: [],
      by_domain: {},
    });
    mockSuccessResponse(data);

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByText('Overdue')).toBeInTheDocument(); // metric label
    });

    // The "X overdue" badge in the header should NOT be present
    expect(screen.queryByText(/\d+ overdue/)).not.toBeInTheDocument();
  });

  // -- Review recency breakdown --

  it('displays review recency stats', async () => {
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByText('Review recency')).toBeInTheDocument();
    });

    // Check the labels with values embedded via <strong> tags
    expect(screen.getByText(/Last 7d:/)).toBeInTheDocument();
    expect(screen.getByText(/Last 30d:/)).toBeInTheDocument();
    expect(screen.getByText(/Last 90d:/)).toBeInTheDocument();
  });

  // -- Domain breakdown table --

  it('renders domain breakdown table with correct data', async () => {
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByText('Technology')).toBeInTheDocument();
    });

    const table = screen.getByRole('table', { name: /review cadence by domain/i });
    expect(table).toBeInTheDocument();

    // Check domain names
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('HR & People')).toBeInTheDocument();
  });

  // -- Overdue items collapsible --

  it('shows overdue items toggle button with count', async () => {
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /overdue/i })).toBeInTheDocument();
    });

    const toggle = screen.getByRole('button', { name: /overdue/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands overdue items list on click', async () => {
    const user = userEvent.setup();
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /overdue/i })).toBeInTheDocument();
    });

    const toggle = screen.getByRole('button', { name: /overdue/i });
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const list = screen.getByRole('list', { name: /overdue review items/i });
    expect(list).toBeInTheDocument();

    // Check overdue item titles are visible
    expect(screen.getByText('Stale Technology Article')).toBeInTheDocument();
    expect(screen.getByText('Never Reviewed Item')).toBeInTheDocument();
  });

  it('shows "Never reviewed" for items with days_since_review = -1', async () => {
    const user = userEvent.setup();
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /overdue/i })).toBeInTheDocument();
    });

    // Before expanding: "Never reviewed" appears once (metric label)
    const beforeExpand = screen.getAllByText('Never reviewed');
    const countBefore = beforeExpand.length;

    await user.click(screen.getByRole('button', { name: /overdue/i }));

    // After expanding: "Never reviewed" appears one more time (in overdue list)
    const afterExpand = screen.getAllByText('Never reviewed');
    expect(afterExpand.length).toBe(countBefore + 1);
  });

  it('shows days ago for reviewed overdue items', async () => {
    const user = userEvent.setup();
    mockSuccessResponse();

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /overdue/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /overdue/i }));

    expect(screen.getByText('115d ago')).toBeInTheDocument();
  });

  // -- Custom className --

  it('passes through className prop', async () => {
    mockSuccessResponse();

    const { container } = render(<ReviewCadenceCard className="custom-class" />);

    await waitFor(() => {
      expect(screen.getByText('Review Health')).toBeInTheDocument();
    });

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.className).toContain('custom-class');
  });

  // -- No overdue items --

  it('does not render overdue toggle when no overdue items', async () => {
    const data = makeCadenceData({
      summary: {
        total_items: 5,
        never_reviewed: 0,
        reviewed_last_7_days: 5,
        reviewed_last_30_days: 5,
        reviewed_last_90_days: 5,
        overdue: 0,
        average_days_since_review: 3,
      },
      overdue_items: [],
    });
    mockSuccessResponse(data);

    render(<ReviewCadenceCard />);

    await waitFor(() => {
      expect(screen.getByText('Review Health')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /overdue/i })).not.toBeInTheDocument();
  });
});
