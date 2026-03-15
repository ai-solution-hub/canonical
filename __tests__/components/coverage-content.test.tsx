/**
 * CoverageContent Component Tests
 *
 * Tests the taxonomy coverage tab — loading, error, empty,
 * success states, layer filter, refresh, CSV export, and domain ordering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockTaxonomy } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockTaxonomy: {
    value: null as ReturnType<typeof import('../helpers/mock-contexts').mockTaxonomyContext> | null,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/coverage',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomy.value,
}));

// Stub child components
vi.mock('@/components/coverage-summary-cards', () => ({
  CoverageSummaryCards: ({ summary }: { summary: unknown[] }) => (
    <div data-testid="coverage-summary-cards">
      {summary.length} summary rows
    </div>
  ),
}));

vi.mock('@/components/coverage-domain-section', () => ({
  CoverageDomainSection: ({ domainName, defaultExpanded }: { domainName: string; defaultExpanded: boolean }) => (
    <div data-testid={`domain-section-${domainName}`} data-expanded={defaultExpanded}>
      Domain: {domainName}
    </div>
  ),
}));

vi.mock('@/components/coverage-layer-filter', () => ({
  CoverageLayerFilter: ({ value, onLayerChange }: { value: string | null; onLayerChange: (v: string | null) => void }) => (
    <select
      data-testid="layer-filter"
      value={value ?? ''}
      onChange={(e) => onLayerChange(e.target.value || null)}
    >
      <option value="">All layers</option>
      <option value="bid_detail">Bid Detail</option>
    </select>
  ),
}));

import { CoverageContent } from '@/app/coverage/coverage-content';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createCoverageResponse(overrides: Partial<{
  matrix: unknown[];
  summary: unknown[];
}> = {}) {
  return {
    matrix: overrides.matrix ?? [
      {
        domain_name: 'Corporate',
        subtopic_name: 'Company History',
        item_count: 5,
        fresh_count: 3,
        aging_count: 1,
        stale_count: 1,
        expired_count: 0,
      },
      {
        domain_name: 'Technical',
        subtopic_name: 'Infrastructure',
        item_count: 3,
        fresh_count: 2,
        aging_count: 0,
        stale_count: 1,
        expired_count: 0,
      },
    ],
    summary: overrides.summary ?? [
      { domain_name: 'Corporate', total_items: 5, coverage_pct: 80 },
      { domain_name: 'Technical', total_items: 3, coverage_pct: 60 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoverageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaxonomy.value = mockTaxonomyContext();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading skeleton while fetching data', () => {
    // Never resolve fetch
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<CoverageContent />);

    expect(screen.getByRole('status', { name: /loading coverage data/i })).toBeInTheDocument();
  });

  it('shows error message and retry button on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows empty state with Settings link when no taxonomy is configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matrix: [], summary: [] }),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(screen.getByText('No taxonomy configured')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /go to settings/i })).toHaveAttribute('href', '/settings');
  });

  it('renders summary cards and domain sections on success', async () => {
    const data = createCoverageResponse();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(screen.getByTestId('coverage-summary-cards')).toBeInTheDocument();
    });
    expect(screen.getByTestId('domain-section-Corporate')).toBeInTheDocument();
    expect(screen.getByTestId('domain-section-Technical')).toBeInTheDocument();
  });

  it('re-fetches data when layer filter changes', async () => {
    const user = userEvent.setup();
    const data = createCoverageResponse();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });

    render(<CoverageContent />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('coverage-summary-cards')).toBeInTheDocument();
    });

    const initialCallCount = mockFetch.mock.calls.length;

    // Change layer filter
    const filterSelect = screen.getByTestId('layer-filter');
    await user.selectOptions(filterSelect, 'bid_detail');

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    // Verify the latest call includes the layer param
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(lastCall[0]).toContain('layer=bid_detail');
  });

  it('calls fetchCoverage again when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const data = createCoverageResponse();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(screen.getByTestId('coverage-summary-cards')).toBeInTheDocument();
    });

    const callsBefore = mockFetch.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('shows Export CSV button when data exists', async () => {
    const data = createCoverageResponse();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
    });
  });

  it('renders first domain expanded by default', async () => {
    const data = createCoverageResponse();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      const corporate = screen.getByTestId('domain-section-Corporate');
      expect(corporate).toHaveAttribute('data-expanded', 'true');

      const technical = screen.getByTestId('domain-section-Technical');
      expect(technical).toHaveAttribute('data-expanded', 'false');
    });
  });
});
