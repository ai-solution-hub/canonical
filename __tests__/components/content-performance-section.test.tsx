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
      unique_procurements: 8,
      // ID-145 {145.20} BI-32 — shortlist pass-rate defaults to "no data"
      // (honest empty state), matching a cold-start/RPC-default response.
      shortlist_total: 0,
      shortlist_passed: 0,
      shortlist_pass_rate: 0,
      ...((overrides.overall as Record<string, unknown>) ?? {}),
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
        unique_procurements: 6,
        shortlist_total: 0,
        shortlist_passed: 0,
        shortlist_pass_rate: 0,
      },
      {
        domain: 'compliance',
        total_citations: 8,
        winning_citations: 4,
        losing_citations: 4,
        pending_citations: 0,
        win_rate: 0.5,
        unique_items_cited: 5,
        unique_procurements: 4,
        shortlist_total: 0,
        shortlist_passed: 0,
        shortlist_pass_rate: 0,
      },
      {
        domain: 'corporate',
        total_citations: 4,
        winning_citations: 1,
        losing_citations: 2,
        pending_citations: 1,
        win_rate: 0.33,
        unique_items_cited: 3,
        unique_procurements: 2,
        shortlist_total: 0,
        shortlist_passed: 0,
        shortlist_pass_rate: 0,
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
          unique_procurements: 0,
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
        screen.getByText(/Draft procurement responses using KB content/),
      ).toBeInTheDocument();
    });
  });

  it('surfaces the rounded overall win-rate percentage', async () => {
    mockFetchResponse(
      createAggregateData({
        overall: {
          total_citations: 10,
          winning_citations: 8,
          losing_citations: 2,
          pending_citations: 0,
          win_rate: 0.8,
          unique_items_cited: 5,
          unique_procurements: 3,
        },
        by_domain: [],
      }),
    );

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(screen.getByText('80%')).toBeInTheDocument();
    });
  });

  // The win-rate-tier -> freshness-token colour mapping is pinned once in
  // content-performance-section.contract.test.tsx (the sanctioned coupling
  // point). The "80%" figure itself — the user-observable signal — is asserted
  // by the behaviour tests above.

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
            unique_procurements: 2,
          },
        ],
      }),
    );

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(screen.getByTestId('domain-badge-security')).toBeInTheDocument();
    });

    // Other domains should not appear
    expect(
      screen.queryByTestId('domain-badge-compliance'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('domain-badge-corporate'),
    ).not.toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // Shortlist pass-rate (ID-145 {145.20} BI-32)
  // -------------------------------------------------------------------------

  describe('shortlist pass-rate', () => {
    it('renders the overall shortlist pass-rate label and percentage when data exists', async () => {
      mockFetchResponse(
        createAggregateData({
          overall: {
            shortlist_total: 8,
            shortlist_passed: 6,
            // Deliberately distinct from the default win_rate (63%) and
            // the default by_domain win rates (75%/50%/33%) so the
            // assertion below cannot false-positive-match a sibling tile.
            shortlist_pass_rate: 0.8,
          },
        }),
      );

      render(<ContentPerformanceSection />);

      await waitFor(() => {
        expect(screen.getByText('Shortlist Pass Rate')).toBeInTheDocument();
        expect(screen.getByText('80%')).toBeInTheDocument();
      });
    });

    it('shows an honest empty state (not "0%") when shortlist_total is zero', async () => {
      mockFetchResponse(
        createAggregateData({
          overall: {
            shortlist_total: 0,
            shortlist_passed: 0,
            shortlist_pass_rate: 0,
          },
        }),
      );

      render(<ContentPerformanceSection />);

      await waitFor(() => {
        expect(screen.getByText('Shortlist Pass Rate')).toBeInTheDocument();
      });

      // No shortlist data at all -> a neutral placeholder, never a
      // misleading "0%" (BI-32 acceptance: "honest empty state ... not a
      // mislabelled zero").
      expect(screen.queryByText('0%')).not.toBeInTheDocument();
    });

    it('renders a real 0% pass rate distinctly from "no data" when shortlist_total > 0', async () => {
      mockFetchResponse(
        createAggregateData({
          overall: {
            shortlist_total: 3,
            shortlist_passed: 0,
            shortlist_pass_rate: 0,
          },
        }),
      );

      render(<ContentPerformanceSection />);

      await waitFor(() => {
        expect(screen.getByText('Shortlist Pass Rate')).toBeInTheDocument();
        expect(screen.getByText('0%')).toBeInTheDocument();
      });
    });

    it('renders a per-domain shortlist column with pass-rate figures', async () => {
      mockFetchResponse(
        createAggregateData({
          by_domain: [
            {
              domain: 'security',
              total_citations: 12,
              winning_citations: 9,
              losing_citations: 3,
              pending_citations: 0,
              win_rate: 0.75,
              unique_items_cited: 8,
              unique_procurements: 6,
              shortlist_total: 4,
              shortlist_passed: 3,
              shortlist_pass_rate: 0.75,
            },
          ],
        }),
      );

      render(<ContentPerformanceSection />);

      await waitFor(() => {
        expect(screen.getByTestId('domain-badge-security')).toBeInTheDocument();
        // The domain win-rate (75%) and the domain shortlist pass-rate
        // (75%) are numerically equal in this fixture but rendered as two
        // distinct labelled figures — assert the shortlist-specific text.
        expect(screen.getByText(/Shortlist: 75%/)).toBeInTheDocument();
      });
    });

    it('shows an honest per-domain empty indicator when a domain has no shortlist data', async () => {
      mockFetchResponse(
        createAggregateData({
          by_domain: [
            {
              domain: 'compliance',
              total_citations: 8,
              winning_citations: 4,
              losing_citations: 4,
              pending_citations: 0,
              win_rate: 0.5,
              unique_items_cited: 5,
              unique_procurements: 4,
              shortlist_total: 0,
              shortlist_passed: 0,
              shortlist_pass_rate: 0,
            },
          ],
        }),
      );

      render(<ContentPerformanceSection />);

      await waitFor(() => {
        expect(
          screen.getByTestId('domain-badge-compliance'),
        ).toBeInTheDocument();
      });

      expect(screen.getByText(/Shortlist: —/)).toBeInTheDocument();
    });
  });
});
