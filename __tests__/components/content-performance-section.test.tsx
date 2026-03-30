/**
 * ContentPerformanceSection Component Tests
 *
 * Tests the dashboard aggregate win-rate analytics section:
 * overall metrics, domain breakdown, pending note, empty state,
 * loading state, and accessibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ContentPerformanceSection } from '@/components/dashboard/content-performance-section';

// ---------------------------------------------------------------------------
// Mock DomainBadge (uses taxonomy context which is not available in tests)
// ---------------------------------------------------------------------------

vi.mock('@/components/shared/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid={`domain-badge-${domain}`}>{domain}</span>
  ),
}));

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => data,
  });
}

function createAggregateData(overrides: Record<string, unknown> = {}) {
  return {
    overall: {
      total_citations: 24,
      winning_citations: 10,
      losing_citations: 6,
      pending_citations: 8,
      win_rate: 0.63,
      unique_items_cited: 16,
      unique_bids: 8,
      ...(overrides.overall as Record<string, unknown> ?? {}),
    },
    by_domain: overrides.by_domain ?? [
      {
        domain: 'security',
        total_citations: 12,
        winning_citations: 9,
        losing_citations: 3,
        pending_citations: 0,
        win_rate: 0.75,
        unique_items_cited: 8,
        unique_bids: 6,
      },
      {
        domain: 'compliance',
        total_citations: 8,
        winning_citations: 4,
        losing_citations: 4,
        pending_citations: 0,
        win_rate: 0.5,
        unique_items_cited: 5,
        unique_bids: 4,
      },
      {
        domain: 'corporate',
        total_citations: 4,
        winning_citations: 1,
        losing_citations: 2,
        pending_citations: 1,
        win_rate: 0.33,
        unique_items_cited: 3,
        unique_bids: 2,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentPerformanceSection', () => {
  it('renders loading skeleton during fetch', () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(<ContentPerformanceSection />);

    const section = screen.getByLabelText('Content performance');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Content Performance')).toBeInTheDocument();
  });

  it('renders four overall metric cards with correct values', async () => {
    mockFetchResponse(createAggregateData());

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(screen.getByText('63%')).toBeInTheDocument();
      expect(screen.getByText('24')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument(); // unique bids
      expect(screen.getByText('16')).toBeInTheDocument(); // unique items
      expect(screen.getByText('Win Rate')).toBeInTheDocument();
      expect(screen.getByText('Citations')).toBeInTheDocument();
      expect(screen.getByText('Bids')).toBeInTheDocument();
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
  });

  it('renders domain breakdown rows with win rate bars', async () => {
    mockFetchResponse(createAggregateData());

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(screen.getByText('By Domain')).toBeInTheDocument();
      expect(screen.getByTestId('domain-badge-security')).toBeInTheDocument();
      expect(screen.getByTestId('domain-badge-compliance')).toBeInTheDocument();
      expect(screen.getByTestId('domain-badge-corporate')).toBeInTheDocument();

      // Win rate percentages in domain rows
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('33%')).toBeInTheDocument();

      // Citation counts
      expect(screen.getByText('12 citations')).toBeInTheDocument();
      expect(screen.getByText('8 citations')).toBeInTheDocument();
      expect(screen.getByText('4 citations')).toBeInTheDocument();
    });
  });

  it('renders pending citations note when pending > 0', async () => {
    mockFetchResponse(createAggregateData());

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(
        screen.getByText('8 citations in bids awaiting outcome'),
      ).toBeInTheDocument();
    });
  });

  it('hides pending note when pending === 0', async () => {
    mockFetchResponse(
      createAggregateData({
        overall: { pending_citations: 0 },
        by_domain: [],
      }),
    );

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Win Rate')).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/citations in bids awaiting outcome/),
    ).not.toBeInTheDocument();
  });

  it('renders empty state when zero citations', async () => {
    mockFetchResponse(
      createAggregateData({
        overall: {
          total_citations: 0,
          winning_citations: 0,
          losing_citations: 0,
          pending_citations: 0,
          win_rate: 0,
          unique_items_cited: 0,
          unique_bids: 0,
        },
        by_domain: [],
      }),
    );

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(
        screen.getByText(/No bid performance data yet/),
      ).toBeInTheDocument();
      expect(screen.getByText('How it works:')).toBeInTheDocument();
      expect(
        screen.getByText(/Draft bid responses using KB content/),
      ).toBeInTheDocument();
    });
  });

  it('win rate colour matches threshold (teal >= 70%, sand 40-69%, rose < 40%)', async () => {
    mockFetchResponse(
      createAggregateData({
        overall: {
          total_citations: 10,
          winning_citations: 8,
          losing_citations: 2,
          pending_citations: 0,
          win_rate: 0.8,
          unique_items_cited: 5,
          unique_bids: 3,
        },
        by_domain: [],
      }),
    );

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      // 80% win rate should use teal text class
      const winRateEl = screen.getByText('80%');
      expect(winRateEl).toHaveClass('text-freshness-fresh');
    });
  });

  it('domain rows only appear for domains with citations', async () => {
    mockFetchResponse(
      createAggregateData({
        by_domain: [
          {
            domain: 'security',
            total_citations: 5,
            winning_citations: 3,
            losing_citations: 2,
            pending_citations: 0,
            win_rate: 0.6,
            unique_items_cited: 3,
            unique_bids: 2,
          },
        ],
      }),
    );

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(screen.getByTestId('domain-badge-security')).toBeInTheDocument();
    });

    // Other domains should not appear
    expect(screen.queryByTestId('domain-badge-compliance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('domain-badge-corporate')).not.toBeInTheDocument();
  });

  it('accessibility: meter roles have correct aria attributes', async () => {
    mockFetchResponse(createAggregateData());

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      const meters = screen.getAllByRole('meter');
      expect(meters.length).toBeGreaterThan(0);

      // Each domain bar should have correct attributes
      for (const meter of meters) {
        expect(meter).toHaveAttribute('aria-valuemin', '0');
        expect(meter).toHaveAttribute('aria-valuemax', '100');
        expect(meter).toHaveAttribute('aria-label');
      }
    });
  });
});
