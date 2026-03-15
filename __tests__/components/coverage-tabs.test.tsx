/**
 * CoveragePageTabs Component Tests
 *
 * Tests the coverage page tab container — default tab, tab switching,
 * gap summary banner rendering with breakdown, and view templates link.
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

vi.mock('@/components/template-coverage-content', () => ({
  TemplateCoverageContent: () => <div data-testid="template-coverage-content">Template Content</div>,
}));

vi.mock('@/components/coverage-guide-tab', () => ({
  CoverageGuideTab: () => <div data-testid="coverage-guide-tab">Guide Content</div>,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoveragePageTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: gap-summary returns no gaps (banner hidden)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGapSummary({ total_gaps: 0, total_partial: 0, templates_assessed: 0 }),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders with Taxonomy tab active by default', async () => {
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.getByText('Coverage Dashboard')).toBeInTheDocument();
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

  it('renders gap summary banner when gaps exist', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGapSummary(),
    });
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('Action required: content gaps detected')).toBeInTheDocument();
    });
  });

  it('does not render gap summary banner when total_gaps and total_partial are zero', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGapSummary({ total_gaps: 0, total_partial: 0 }),
    });
    render(<CoveragePageTabs />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByText('Action required: content gaps detected')).not.toBeInTheDocument();
  });

  it('shows gap and partial counts in the banner breakdown', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGapSummary({ total_gaps: 5, total_partial: 2 }),
    });
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
    // Check type breakdown badges
    expect(screen.getByText(/3 Policy/)).toBeInTheDocument();
    expect(screen.getByText(/2 Evidence/)).toBeInTheDocument();
    expect(screen.getByText(/2 Statement/)).toBeInTheDocument();
  });

  it('switches to templates tab when "View template coverage details" is clicked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGapSummary(),
    });
    const user = userEvent.setup();
    render(<CoveragePageTabs />);
    await waitFor(() => {
      expect(screen.getByText('View template coverage details')).toBeInTheDocument();
    });
    await user.click(screen.getByText('View template coverage details'));
    expect(screen.getByTestId('template-coverage-content')).toBeInTheDocument();
  });
});
