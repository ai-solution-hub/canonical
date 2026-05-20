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
import { mockTaxonomyContext } from '../../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockTaxonomy, mockUserRole, mockCoverageTargets } =
  vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockTaxonomy: {
      value: null as ReturnType<
        typeof import('../../helpers/mock-contexts').mockTaxonomyContext
      > | null,
    },
    mockUserRole: {
      value: {
        role: 'admin' as string,
        canAdmin: true,
        canEdit: true,
        loading: false,
      },
    },
    mockCoverageTargets: {
      value: {
        targets: [] as Array<{
          id: string;
          domain_id: string;
          metric_name: string;
          target_value: number;
          domain_name: string | null;
        }>,
        loading: false,
        error: null,
        saveTargets: vi.fn(),
        refetch: vi.fn(),
      },
    },
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/coverage',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomy.value,
}));

// Stub child components
vi.mock('@/components/coverage/coverage-summary-cards', () => ({
  CoverageSummaryCards: ({ summary }: { summary: unknown[] }) => (
    <div data-testid="coverage-summary-cards">
      {summary.length} summary rows
    </div>
  ),
}));

vi.mock('@/components/coverage/coverage-domain-section', () => ({
  CoverageDomainSection: ({
    domainName,
    defaultExpanded,
  }: {
    domainName: string;
    defaultExpanded: boolean;
  }) => (
    <div
      data-testid={`domain-section-${domainName}`}
      data-expanded={defaultExpanded}
    >
      Domain: {domainName}
    </div>
  ),
}));

vi.mock('@/components/coverage/coverage-heatmap-view', () => ({
  CoverageHeatmapView: ({
    matrix,
    orderedDomains,
  }: {
    matrix: unknown[];
    orderedDomains: string[];
  }) => (
    <div data-testid="coverage-heatmap-view">
      Heatmap: {matrix.length} cells, {orderedDomains.length} domains
    </div>
  ),
}));

vi.mock('@/hooks/use-coverage-targets', () => ({
  useCoverageTargets: () => mockCoverageTargets.value,
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole.value,
}));

vi.mock('@/components/coverage/coverage-target-progress', () => ({
  CoverageTargetProgress: () => null,
}));

vi.mock('@/components/coverage/coverage-target-editor', () => ({
  CoverageTargetEditor: () => null,
}));

vi.mock('@/components/browse/coverage-layer-filter', () => ({
  CoverageLayerFilter: ({
    value,
    onLayerChange,
  }: {
    value: string | null;
    onLayerChange: (v: string | null) => void;
  }) => (
    <select
      data-testid="layer-filter"
      value={value ?? ''}
      onChange={(e) => onLayerChange(e.target.value || null)}
    >
      <option value="">All layers</option>
      <option value="bid_detail">Procurement Detail</option>
    </select>
  ),
}));

import { CoverageContent } from '@/app/coverage/coverage-content';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createCoverageResponse(
  overrides: Partial<{
    matrix: unknown[];
    summary: unknown[];
  }> = {},
) {
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
  const localStorageStore: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    mockTaxonomy.value = mockTaxonomyContext();
    mockUserRole.value = {
      role: 'admin',
      canAdmin: true,
      canEdit: true,
      loading: false,
    };
    mockCoverageTargets.value = {
      targets: [],
      loading: false,
      error: null,
      saveTargets: vi.fn(),
      refetch: vi.fn(),
    };
    vi.stubGlobal('fetch', mockFetch);

    // Clear localStorage store between tests
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);

    // Mock localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
      (key: string) => localStorageStore[key] ?? null,
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key: string, value: string) => {
        localStorageStore[key] = value;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading skeleton while fetching data', () => {
    // Never resolve fetch
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<CoverageContent />);

    expect(
      screen.getByRole('status', { name: /loading coverage data/i }),
    ).toBeInTheDocument();
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

  it('shows empty-content state with "Add content" CTA for editors when taxonomy exists but no content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matrix: [], summary: [] }),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(
        screen.getByText('Your knowledge base is empty'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        'Add some content to see coverage broken down by domain.',
      ),
    ).toBeInTheDocument();
    const ctaLink = screen.getByRole('link', { name: 'Add content' });
    expect(ctaLink).toHaveAttribute('href', '/item/new');
  });

  it('hides CTA in empty-content state for viewers (canEdit=false)', async () => {
    mockUserRole.value = {
      role: 'viewer',
      canAdmin: false,
      canEdit: false,
      loading: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matrix: [], summary: [] }),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(
        screen.getByText('Your knowledge base is empty'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        'Add some content to see coverage broken down by domain.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Add content' }),
    ).not.toBeInTheDocument();
  });

  it('shows no-taxonomy empty state with Settings link when no domains exist', async () => {
    mockTaxonomy.value = mockTaxonomyContext({ domains: [] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matrix: [], summary: [] }),
    });

    render(<CoverageContent />);

    await waitFor(() => {
      expect(screen.getByText('No taxonomy configured')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: /go to settings/i }),
    ).toHaveAttribute('href', '/settings');
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
      expect(
        screen.getByRole('button', { name: /export csv/i }),
      ).toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // Heatmap view toggle (tests 29–35)
  // -------------------------------------------------------------------------

  describe('heatmap view toggle', () => {
    it('renders toggle with Cards and Heatmap buttons', async () => {
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByRole('button', { name: /cards/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /heatmap/i }),
      ).toBeInTheDocument();
    });

    it('defaults to Cards view (domain sections visible, heatmap not)', async () => {
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      // Card view renders domain sections
      expect(
        screen.getByTestId('domain-section-Corporate'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('domain-section-Technical'),
      ).toBeInTheDocument();

      // Heatmap should not be rendered
      expect(
        screen.queryByTestId('coverage-heatmap-view'),
      ).not.toBeInTheDocument();
    });

    it('switches to heatmap view when Heatmap button is clicked', async () => {
      const user = userEvent.setup();
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /heatmap/i }));

      // Heatmap should now be visible
      expect(screen.getByTestId('coverage-heatmap-view')).toBeInTheDocument();

      // Domain sections should no longer be visible
      expect(
        screen.queryByTestId('domain-section-Corporate'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('domain-section-Technical'),
      ).not.toBeInTheDocument();
    });

    it('switches back to card view when Cards button is clicked', async () => {
      const user = userEvent.setup();
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      // Switch to heatmap first
      await user.click(screen.getByRole('button', { name: /heatmap/i }));
      expect(screen.getByTestId('coverage-heatmap-view')).toBeInTheDocument();

      // Switch back to cards
      await user.click(screen.getByRole('button', { name: /cards/i }));

      // Domain sections should be back
      expect(
        screen.getByTestId('domain-section-Corporate'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('domain-section-Technical'),
      ).toBeInTheDocument();

      // Heatmap should be gone
      expect(
        screen.queryByTestId('coverage-heatmap-view'),
      ).not.toBeInTheDocument();
    });

    it('persists view mode to localStorage', async () => {
      const user = userEvent.setup();
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      // Default persists 'cards'
      expect(localStorageStore['coverage-view-mode']).toBe('cards');

      // Switch to heatmap
      await user.click(screen.getByRole('button', { name: /heatmap/i }));

      expect(localStorageStore['coverage-view-mode']).toBe('heatmap');
    });

    it('reads view mode from localStorage on mount', async () => {
      // Pre-set heatmap in localStorage before render
      localStorageStore['coverage-view-mode'] = 'heatmap';

      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      // Should render heatmap view, not card view
      expect(screen.getByTestId('coverage-heatmap-view')).toBeInTheDocument();
      expect(
        screen.queryByTestId('domain-section-Corporate'),
      ).not.toBeInTheDocument();
    });

    it('toggle buttons have correct aria-pressed attributes', async () => {
      const user = userEvent.setup();
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      const cardsBtn = screen.getByRole('button', { name: /cards/i });
      const heatmapBtn = screen.getByRole('button', { name: /heatmap/i });

      // Default: Cards is pressed, Heatmap is not
      expect(cardsBtn).toHaveAttribute('aria-pressed', 'true');
      expect(heatmapBtn).toHaveAttribute('aria-pressed', 'false');

      // Switch to heatmap
      await user.click(heatmapBtn);

      expect(cardsBtn).toHaveAttribute('aria-pressed', 'false');
      expect(heatmapBtn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  // -------------------------------------------------------------------------
  // Coverage targets empty state
  // -------------------------------------------------------------------------

  describe('coverage targets empty state', () => {
    it('shows admin CTA when no targets exist and user is admin', async () => {
      mockUserRole.value = {
        role: 'admin',
        canAdmin: true,
        canEdit: true,
        loading: false,
      };
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      expect(screen.getByText('No coverage targets set')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Define target goals so you can track how current content measures up against what you need.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /create coverage target/i }),
      ).toBeInTheDocument();
    });

    it('shows neutral message for non-admin when no targets exist', async () => {
      mockUserRole.value = {
        role: 'editor',
        canAdmin: false,
        canEdit: true,
        loading: false,
      };
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByText('No coverage targets configured yet.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /create coverage target/i }),
      ).not.toBeInTheDocument();
    });

    it('shows neutral message for viewer when no targets exist', async () => {
      mockUserRole.value = {
        role: 'viewer',
        canAdmin: false,
        canEdit: false,
        loading: false,
      };
      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByText('No coverage targets configured yet.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('No coverage targets set'),
      ).not.toBeInTheDocument();
    });

    it('does not show empty state when targets exist', async () => {
      mockCoverageTargets.value = {
        targets: [
          {
            id: '00000000-0000-4000-8000-000000000010',
            domain_id: '00000000-0000-4000-8000-000000000001',
            metric_name: 'item_count',
            target_value: 10,
            domain_name: 'Corporate',
          },
        ],
        loading: false,
        error: null,
        saveTargets: vi.fn(),
        refetch: vi.fn(),
      };

      const data = createCoverageResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      });

      render(<CoverageContent />);

      await waitFor(() => {
        expect(
          screen.getByTestId('coverage-summary-cards'),
        ).toBeInTheDocument();
      });

      expect(
        screen.queryByText('No coverage targets set'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('No coverage targets configured yet.'),
      ).not.toBeInTheDocument();
    });
  });
});
