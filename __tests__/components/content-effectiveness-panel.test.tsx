/**
 * ContentEffectivenessPanel Component Tests
 *
 * Tests the three display states (empty, awaiting outcomes, active),
 * metrics rendering, win rate bar, bid history, and accessibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ContentEffectivenessPanel } from '@/components/item-detail/content-effectiveness-panel';

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

const CONTENT_ID = '00000000-0000-4000-8000-000000000001';

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => data,
  });
}

function createEffectivenessData(overrides: Record<string, unknown> = {}) {
  return {
    content_item_id: CONTENT_ID,
    total_citations: 12,
    winning_citations: 5,
    losing_citations: 3,
    pending_citations: 4,
    win_rate: 0.625,
    bids: [
      {
        workspace_id: 'ws-1',
        workspace_name: 'NHS Digital Redesign',
        buyer: 'NHS England',
        outcome: 'won',
        cited_at: '2026-01-15T10:00:00Z',
      },
      {
        workspace_id: 'ws-2',
        workspace_name: 'Council Portal',
        buyer: null,
        outcome: 'lost',
        cited_at: '2026-02-20T14:00:00Z',
      },
      {
        workspace_id: 'ws-3',
        workspace_name: 'Transport App',
        buyer: 'TfL',
        outcome: null,
        cited_at: '2026-03-01T09:00:00Z',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentEffectivenessPanel', () => {
  it('renders loading skeleton during fetch', () => {
    // Make fetch hang
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    const section = screen.getByLabelText('Content effectiveness');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Content Effectiveness')).toBeInTheDocument();
  });

  it('renders empty state when total_citations is 0', async () => {
    mockFetchResponse(createEffectivenessData({ total_citations: 0, bids: [] }));

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      expect(
        screen.getByText(/This content has not yet been cited/),
      ).toBeInTheDocument();
    });
  });

  it('renders awaiting outcomes when citations exist but no decided outcomes', async () => {
    mockFetchResponse(
      createEffectivenessData({
        total_citations: 5,
        winning_citations: 0,
        losing_citations: 0,
        pending_citations: 5,
        win_rate: 0,
        bids: [
          {
            workspace_id: 'ws-1',
            workspace_name: 'Test Bid',
            buyer: null,
            outcome: null,
            cited_at: '2026-03-01T09:00:00Z',
          },
        ],
      }),
    );

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      // Should show "---" for win rate and "awaiting outcomes" label
      expect(screen.getByText('---')).toBeInTheDocument();
      expect(screen.getByText('awaiting outcomes')).toBeInTheDocument();
    });

    // Win rate bar should NOT be present
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('renders metrics row with correct values', async () => {
    mockFetchResponse(createEffectivenessData());

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('63%')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument(); // distinct bids
      expect(screen.getByText('citations')).toBeInTheDocument();
      expect(screen.getByText('win rate')).toBeInTheDocument();
      expect(screen.getByText('bids used in')).toBeInTheDocument();
    });
  });

  it('renders win rate bar with correct width percentage', async () => {
    mockFetchResponse(createEffectivenessData());

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      const meter = screen.getByRole('meter');
      expect(meter).toBeInTheDocument();
      expect(meter).toHaveAttribute('aria-valuenow', '63');
      expect(meter).toHaveAttribute('aria-valuemin', '0');
      expect(meter).toHaveAttribute('aria-valuemax', '100');
      expect(meter).toHaveAttribute('aria-label', 'Win rate');
    });
  });

  it('renders bid history list with correct outcome badges', async () => {
    mockFetchResponse(createEffectivenessData());

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Bid History')).toBeInTheDocument();
      expect(screen.getByText('NHS Digital Redesign')).toBeInTheDocument();
      expect(screen.getByText('Council Portal')).toBeInTheDocument();
      expect(screen.getByText('Transport App')).toBeInTheDocument();
    });

    // Check outcome badges via aria-labels
    expect(screen.getByLabelText('Outcome: Won')).toBeInTheDocument();
    expect(screen.getByLabelText('Outcome: Lost')).toBeInTheDocument();
    expect(screen.getByLabelText('Outcome: Pending')).toBeInTheDocument();
  });

  it('truncates bid list to 5 items with "Show all" button', async () => {
    const manyBids = Array.from({ length: 7 }, (_, i) => ({
      workspace_id: `ws-${i}`,
      workspace_name: `Bid ${i + 1}`,
      buyer: null,
      outcome: i % 2 === 0 ? 'won' : 'lost',
      cited_at: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));

    mockFetchResponse(createEffectivenessData({ bids: manyBids }));

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Bid 1')).toBeInTheDocument();
      expect(screen.getByText('Bid 5')).toBeInTheDocument();
    });

    // Bid 6 and 7 should NOT be visible initially
    expect(screen.queryByText('Bid 6')).not.toBeInTheDocument();
    expect(screen.queryByText('Bid 7')).not.toBeInTheDocument();

    // Should show "Show all" button
    const showAllBtn = screen.getByText(/Show all/);
    expect(showAllBtn).toBeInTheDocument();

    // Click to expand
    fireEvent.click(showAllBtn);

    // Now all bids should be visible
    expect(screen.getByText('Bid 6')).toBeInTheDocument();
    expect(screen.getByText('Bid 7')).toBeInTheDocument();
  });

  it('accessibility: meter role has correct aria attributes', async () => {
    mockFetchResponse(createEffectivenessData({ win_rate: 0.75 }));

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      const meter = screen.getByRole('meter');
      expect(meter).toHaveAttribute('aria-valuenow', '75');
      expect(meter).toHaveAttribute('aria-valuemin', '0');
      expect(meter).toHaveAttribute('aria-valuemax', '100');
      expect(meter).toHaveAttribute('aria-label', 'Win rate');
    });
  });

  it('accessibility: outcome badges have aria-label text', async () => {
    mockFetchResponse(
      createEffectivenessData({
        bids: [
          {
            workspace_id: 'ws-1',
            workspace_name: 'Won Bid',
            buyer: null,
            outcome: 'won',
            cited_at: '2026-01-01T10:00:00Z',
          },
          {
            workspace_id: 'ws-2',
            workspace_name: 'Lost Bid',
            buyer: null,
            outcome: 'lost',
            cited_at: '2026-01-02T10:00:00Z',
          },
          {
            workspace_id: 'ws-3',
            workspace_name: 'Withdrawn Bid',
            buyer: null,
            outcome: 'withdrawn',
            cited_at: '2026-01-03T10:00:00Z',
          },
        ],
      }),
    );

    render(<ContentEffectivenessPanel contentItemId={CONTENT_ID} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Outcome: Won')).toBeInTheDocument();
      expect(screen.getByLabelText('Outcome: Lost')).toBeInTheDocument();
      expect(screen.getByLabelText('Outcome: Withdrawn')).toBeInTheDocument();
    });
  });
});
