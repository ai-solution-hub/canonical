import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CoverageHeatmapView } from '@/components/coverage/coverage-heatmap-view';
import type { CoverageCellData } from '@/components/coverage/coverage-cell';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetSubtopics = vi.fn();
const mockFormatSubtopic = vi.fn();
const mockFormatDomainName = vi.fn();
const mockGetDomainColourKey = vi.fn();

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getSubtopics: mockGetSubtopics,
    formatSubtopic: mockFormatSubtopic,
    formatDomainName: mockFormatDomainName,
    getDomainColourKey: mockGetDomainColourKey,
    domains: [],
    subtopics: [],
    loading: false,
    error: null,
    getDomainNames: () => [],
    refresh: () => {},
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock Tooltip components to render children directly for testing
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-provider">{children}</div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip">{children}</div>
  ),
  TooltipTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeCellData(
  domain: string,
  subtopic: string,
  counts: {
    item_count: number;
    fresh_count: number;
    aging_count: number;
    stale_count: number;
    expired_count: number;
  },
): CoverageCellData {
  return {
    domain_name: domain,
    subtopic_name: subtopic,
    ...counts,
  };
}

const SAMPLE_MATRIX: CoverageCellData[] = [
  makeCellData('corporate', 'annual-accounts', {
    item_count: 5,
    fresh_count: 4,
    aging_count: 1,
    stale_count: 0,
    expired_count: 0,
  }),
  makeCellData('corporate', 'company-overview', {
    item_count: 3,
    fresh_count: 1,
    aging_count: 1,
    stale_count: 1,
    expired_count: 0,
  }),
  makeCellData('financial', 'pricing-models', {
    item_count: 7,
    fresh_count: 7,
    aging_count: 0,
    stale_count: 0,
    expired_count: 0,
  }),
];

const ORDERED_DOMAINS = ['corporate', 'financial'];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockGetSubtopics.mockImplementation((domain: string) => {
    if (domain === 'corporate')
      return ['annual-accounts', 'company-overview', 'key-personnel'];
    if (domain === 'financial') return ['pricing-models'];
    return [];
  });

  mockFormatSubtopic.mockImplementation((s: string) =>
    s
      .split('-')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  );

  mockFormatDomainName.mockImplementation((d: string) =>
    d.charAt(0).toUpperCase() + d.slice(1),
  );

  mockGetDomainColourKey.mockReturnValue('corporate');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoverageHeatmapView', () => {
  it('renders a table with role="grid"', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    const grid = screen.getByRole('grid', { name: /freshness heatmap/i });
    expect(grid).toBeInTheDocument();
  });

  it('renders domain labels in row headers', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    expect(screen.getByText('Corporate')).toBeInTheDocument();
    expect(screen.getByText('Financial')).toBeInTheDocument();
  });

  it('renders subtopic labels in column headers', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    const grid = screen.getByRole('grid');
    const thead = grid.querySelector('thead')!;

    // Check column headers contain subtopic labels
    expect(within(thead).getByText('Annual Accounts')).toBeInTheDocument();
    expect(within(thead).getByText('Company Overview')).toBeInTheDocument();
    expect(within(thead).getByText('Key Personnel')).toBeInTheDocument();
    expect(within(thead).getByText('Pricing Models')).toBeInTheDocument();
  });

  it('renders item count text in each populated cell', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    // 5, 3, 7 from the sample matrix
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('renders correct number of rows (one per domain)', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    const grid = screen.getByRole('grid');
    const tbody = grid.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    const rows = tbody!.querySelectorAll('tr');
    expect(rows.length).toBe(2);
  });

  it('cells link to browse with correct domain+subtopic query params', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    // Find the link for corporate::annual-accounts (item count 5)
    const link5 = screen.getByText('5').closest('a');
    expect(link5).toHaveAttribute(
      'href',
      expect.stringContaining('domain=corporate'),
    );
    expect(link5).toHaveAttribute(
      'href',
      expect.stringContaining('subtopic=annual-accounts'),
    );
    expect(link5).toHaveAttribute(
      'href',
      expect.stringContaining('include_qa=true'),
    );
  });

  it('gap cells (0 items in domain subtopic) render with "0" text', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    // "key-personnel" belongs to corporate but has no data in the matrix
    // so it should render as a gap cell with "0"
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(1);

    // The 0 should be inside a link pointing to browse with key-personnel
    const zeroLink = zeros[0].closest('a');
    expect(zeroLink).toHaveAttribute(
      'href',
      expect.stringContaining('subtopic=key-personnel'),
    );
  });

  it('spacer cells (subtopic not in domain) are not interactive', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    // "pricing-models" does not belong to "corporate" domain
    // so that cell should be a spacer (aria-hidden td, no link)
    const grid = screen.getByRole('grid');
    const spacerCells = grid.querySelectorAll('td[aria-hidden="true"]');
    // Financial domain doesn't have annual-accounts, company-overview, key-personnel → 3 spacers
    // Corporate domain doesn't have pricing-models → 1 spacer
    // Total: 4 spacers
    expect(spacerCells.length).toBe(4);

    // Spacer cells should not contain links
    for (const spacer of spacerCells) {
      expect(spacer.querySelector('a')).toBeNull();
    }
  });

  it('legend is present with all freshness level labels', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    expect(screen.getByText('Legend:')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('Ageing')).toBeInTheDocument();
    expect(screen.getByText('Mixed')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('No content')).toBeInTheDocument();
  });

  it('legend has an aria-label', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    const legend = screen.getByRole('img', { name: /heatmap legend/i });
    expect(legend).toBeInTheDocument();
  });

  it('tooltip content includes freshness breakdown', () => {
    render(
      <CoverageHeatmapView
        matrix={SAMPLE_MATRIX}
        orderedDomains={ORDERED_DOMAINS}
      />,
    );

    // Our mock renders tooltip content directly in the DOM
    const tooltipContents = screen.getAllByTestId('tooltip-content');
    expect(tooltipContents.length).toBeGreaterThan(0);

    // Find the tooltip for the corporate::annual-accounts cell (5 items, 4 fresh, 1 aging)
    const annualAccountsTooltip = tooltipContents.find(
      (el) =>
        el.textContent?.includes('Annual Accounts') &&
        el.textContent?.includes('5 items'),
    );
    expect(annualAccountsTooltip).toBeDefined();
    expect(annualAccountsTooltip?.textContent).toContain('4 Fresh');
    expect(annualAccountsTooltip?.textContent).toContain('1 Ageing');
  });
});
