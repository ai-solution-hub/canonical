/**
 * CoveragePageTabs Component Tests
 *
 * Tests the coverage page tab container — default tab, tab switching,
 * enhanced gap summary banner with cross-source counts (taxonomy, template,
 * guide), "View priority gaps" link, skeleton loading state, and responsive
 * layout assertions.
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

vi.mock('@/app/coverage/coverage-content', () => ({
  CoverageContent: () => <div data-testid="coverage-content">Taxonomy Content</div>,
}));

vi.mock('@/components/coverage/template-coverage-content', () => ({
  TemplateCoverageContent: () => <div data-testid="template-coverage-content">Template Content</div>,
}));

vi.mock('@/components/coverage/coverage-guide-tab', () => ({
  CoverageGuideTab: () => <div data-testid="coverage-guide-tab">Guide Content</div>,
}));

vi.mock('@/components/coverage/priority-gaps-tab', () => ({
  PriorityGapsTab: () => <div data-testid="priority-gaps-tab">Priority Gaps Content</div>,
}));

// Import AFTER mocks
import { CoveragePageTabs } from '@/app/coverage/coverage-tabs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGapSummary(overrides: Record<string, unknown> = {}) {
  return {
    templates_assessed: 3,
    total_gaps: 5,
    total_partial: 2,
    gaps_by_type: { policy: 3, evidence: 2 },
    partial_by_type: { statement: 2 },
    gaps_by_template: [
      { template_name: 'ISO 27001', gap_count: 3, partial_count: 1, total: 10 },
      { template_name: 'PPN 06/21', gap_count: 2, partial_count: 1, total: 8 },
    ],
    ...overrides,
  };
}

function makeUnifiedSummary(overrides: Record<string, unknown> = {}) {
  return {
    total_gaps: 18,
    taxonomy_gaps: 7,
    template_gaps: 5,
    guide_gaps: 6,
    critical: 0,
    high: 3,
    medium: 10,
    low: 5,
    gaps: [],
    ...overrides,
  };
}

/**
 * Set up mockFetch to return different data based on the URL:
 * - /api/coverage/gap-summary -> gapSummaryData
 * - /api/coverage/gaps -> unifiedSummaryData
 */
function setupFetchMock(
  gapSummaryData: ReturnType<typeof makeGapSummary>,
  unifiedSummaryData: ReturnType<typeof makeUnifiedSummary>,
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/coverage/gap-summary')) {
      return Promise.resolve({
        ok: true,
        json: async () => gapSummaryData,
      });
    }
    if (url.includes('/api/coverage/gaps')) {
      return Promise.resolve({
        ok: true,
        json: async () => unifiedSummaryData,
      });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoveragePageTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no gaps (banner hidden)
    setupFetchMock(
      makeGapSummary({ total_gaps: 0, total_partial: 0, templates_assessed: 0 }),
      makeUnifiedSummary({ total_gaps: 0, taxonomy_gaps: 0, template_gaps: 0, guide_gaps: 0 }),
    );
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Tab rendering and switching
  // -------------------------------------------------------------------------

  it('renders with Priority Gaps tab active by default', async () => {
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.getByText('Coverage Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('priority-gaps-tab')).toBeInTheDocument();
  });

  it('switches to Domain Coverage tab on click', async () => {
    const user = userEvent.setup();
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: /Domain Coverage/ }));
    expect(screen.getByTestId('coverage-content')).toBeInTheDocument();
  });

  it('switches to Templates tab on click', async () => {
    const user = userEvent.setup();
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: /Templates/ }));
    expect(screen.getByTestId('template-coverage-content')).toBeInTheDocument();
  });

  it('switches to Guides tab on click', async () => {
    const user = userEvent.setup();
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: /Guides/ }));
    expect(screen.getByTestId('coverage-guide-tab')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Banner loading skeleton
  // -------------------------------------------------------------------------

  it('shows skeleton while banner data is loading', () => {
    // Never-resolving fetch to keep loading state
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<CoveragePageTabs />);
    expect(screen.getByRole('status', { name: /Loading gap summary/ })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Banner visibility
  // -------------------------------------------------------------------------

  it('renders gap summary banner when gaps exist', async () => {
    setupFetchMock(makeGapSummary(), makeUnifiedSummary());
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('Action required: content gaps detected')).toBeInTheDocument();
    });
  });

  it('does not render gap summary banner when no gaps exist across all sources', async () => {
    setupFetchMock(
      makeGapSummary({ total_gaps: 0, total_partial: 0, templates_assessed: 3 }),
      makeUnifiedSummary({ total_gaps: 0, taxonomy_gaps: 0, template_gaps: 0, guide_gaps: 0 }),
    );
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /Loading gap summary/ })).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Action required: content gaps detected')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Cross-source gap counts
  // -------------------------------------------------------------------------

  it('shows taxonomy gap count from unified summary', async () => {
    setupFetchMock(makeGapSummary(), makeUnifiedSummary({ taxonomy_gaps: 7 }));
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('taxonomy gaps')).toBeInTheDocument();
    });
    // The strong tag with count 7
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows guide gap count from unified summary', async () => {
    setupFetchMock(makeGapSummary(), makeUnifiedSummary({ guide_gaps: 6 }));
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('guide gaps')).toBeInTheDocument();
    });
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('shows template gap count in cross-source summary', async () => {
    setupFetchMock(makeGapSummary({ total_gaps: 5 }), makeUnifiedSummary());
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('template gaps')).toBeInTheDocument();
    });
  });

  it('uses singular form for 1 taxonomy gap', async () => {
    setupFetchMock(
      makeGapSummary({ total_gaps: 0, total_partial: 0, templates_assessed: 0 }),
      makeUnifiedSummary({ taxonomy_gaps: 1, template_gaps: 0, guide_gaps: 0, total_gaps: 1 }),
    );
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('taxonomy gap')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Template-specific details in banner
  // -------------------------------------------------------------------------

  it('shows gap and partial counts in the template breakdown', async () => {
    setupFetchMock(
      makeGapSummary({ total_gaps: 5, total_partial: 2 }),
      makeUnifiedSummary(),
    );
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText(/3 Policy/)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 Evidence/)).toBeInTheDocument();
    expect(screen.getByText(/2 Statement/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Action links
  // -------------------------------------------------------------------------

  it('switches to templates tab when "View template coverage details" is clicked', async () => {
    setupFetchMock(makeGapSummary(), makeUnifiedSummary());
    const user = userEvent.setup();
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('View template coverage details')).toBeInTheDocument();
    });
    await user.click(screen.getByText('View template coverage details'));
    expect(screen.getByTestId('template-coverage-content')).toBeInTheDocument();
  });

  it('switches to priority gaps tab when "View priority gaps" is clicked', async () => {
    setupFetchMock(makeGapSummary(), makeUnifiedSummary());
    const user = userEvent.setup();
    render(<CoveragePageTabs />);

    // First switch away from priority gaps (so we can verify it switches back)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Templates/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /Templates/ }));
    expect(screen.getByTestId('template-coverage-content')).toBeInTheDocument();

    // Now click "View priority gaps" in the banner
    await user.click(screen.getByText('View priority gaps'));
    expect(screen.getByTestId('priority-gaps-tab')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Fetch behaviour
  // -------------------------------------------------------------------------

  it('fetches both gap-summary and unified gaps endpoints', async () => {
    setupFetchMock(makeGapSummary(), makeUnifiedSummary());
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/coverage/gap-summary'),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/coverage/gaps?limit=0'),
    );
  });

  it('gracefully handles unified gaps endpoint failure', async () => {
    // gap-summary succeeds, gaps fails
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/coverage/gap-summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeGapSummary(),
        });
      }
      if (url.includes('/api/coverage/gaps')) {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(<CoveragePageTabs />);
    await waitFor(() => {
      // Banner should still show with template-only data
      expect(screen.getByText('Action required: content gaps detected')).toBeInTheDocument();
    });
    // Template gap count should still be visible
    expect(screen.getByText('template gaps')).toBeInTheDocument();
    // Taxonomy and guide counts should not appear (unified summary failed)
    expect(screen.queryByText('taxonomy gaps')).not.toBeInTheDocument();
    expect(screen.queryByText('guide gaps')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Banner shows only when gaps exist from at least one source
  // -------------------------------------------------------------------------

  it('shows banner for taxonomy-only gaps (no template gaps)', async () => {
    setupFetchMock(
      makeGapSummary({ total_gaps: 0, total_partial: 0, templates_assessed: 0 }),
      makeUnifiedSummary({ taxonomy_gaps: 3, template_gaps: 0, guide_gaps: 0, total_gaps: 3 }),
    );
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('Action required: content gaps detected')).toBeInTheDocument();
    });
    expect(screen.getByText('taxonomy gaps')).toBeInTheDocument();
    // No template breakdown should appear
    expect(screen.queryByText('View template coverage details')).not.toBeInTheDocument();
  });
});
