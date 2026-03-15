/**
 * CoverageGuideTab Component Tests
 *
 * Tests the guide coverage tab — loading skeleton, error with retry,
 * empty state, and successful data rendering with summary cards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/coverage-guide-card', () => ({
  CoverageGuideCard: ({ guide }: { guide: { id: string; title: string } }) => (
    <div data-testid={`guide-card-${guide.id}`}>{guide.title}</div>
  ),
}));

// Import AFTER mocks
import { CoverageGuideTab } from '@/components/coverage-guide-tab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGuideResponse(overrides: Record<string, unknown> = {}) {
  return {
    guides: overrides.guides ?? [
      { id: 'guide-1', title: 'Health & Safety Guide', sections: [] },
      { id: 'guide-2', title: 'Environmental Policy Guide', sections: [] },
    ],
    summary: overrides.summary ?? {
      total_guides: 2,
      fully_populated: 1,
      partially_populated: 1,
      empty: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoverageGuideTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGuideResponse(),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading skeleton before data arrives', () => {
    // Make fetch hang to keep loading state
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<CoverageGuideTab />);
    // Skeleton renders multiple placeholder elements
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows error state with retry button on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    render(<CoverageGuideTab />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load guide coverage data.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();

    // Clicking retry triggers a new fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeGuideResponse(),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => {
      expect(screen.getByText('Health & Safety Guide')).toBeInTheDocument();
    });
  });

  it('shows empty state when no guides are published', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGuideResponse({ guides: [], summary: { total_guides: 0, fully_populated: 0, partially_populated: 0, empty: 0 } }),
    });
    render(<CoverageGuideTab />);
    await waitFor(() => {
      expect(screen.getByText('No guides published')).toBeInTheDocument();
    });
    expect(screen.getByText(/Publish a guide to see section-level coverage/)).toBeInTheDocument();
  });

  it('shows summary cards and guide cards on success', async () => {
    render(<CoverageGuideTab />);
    await waitFor(() => {
      expect(screen.getByText('Total guides')).toBeInTheDocument();
    });
    // Summary cards
    expect(screen.getByText('Fully populated')).toBeInTheDocument();
    expect(screen.getByText('Partially populated')).toBeInTheDocument();
    expect(screen.getByText('Empty')).toBeInTheDocument();

    // Summary values — '1' appears twice (fully_populated and partially_populated)
    expect(screen.getByText('2')).toBeInTheDocument(); // total_guides
    expect(screen.getAllByText('1').length).toBe(2); // fully_populated + partially_populated

    // Guide cards
    expect(screen.getByTestId('guide-card-guide-1')).toBeInTheDocument();
    expect(screen.getByTestId('guide-card-guide-2')).toBeInTheDocument();
    expect(screen.getByText('Health & Safety Guide')).toBeInTheDocument();
    expect(screen.getByText('Environmental Policy Guide')).toBeInTheDocument();
  });
});
