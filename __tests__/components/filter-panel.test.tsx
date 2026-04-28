/**
 * FilterPanel Component Tests
 *
 * Tests the FilterPanel component which provides a sheet-based filter UI
 * with domain, content type, platform, freshness, priority, and other
 * filter sections. Uses a draft/apply/reset pattern via three custom hooks:
 * useBrowseFilters, useFilterData, and useFilterDraft.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockFilters,
  mockActiveFilterCount,
  mockSetFilters,
  mockClearFilters,
  mockCounts,
  mockAllAuthors,
  mockAuthorSearch,
  mockSetAuthorSearch,
  mockPopularKeywords,
  mockAllWorkspaces,
  mockAllUserTags,
  mockAllEntities,
  mockOnOpenChange,
} = vi.hoisted(() => ({
  mockFilters: {
    value: {
      domain: undefined as string[] | undefined,
      subtopic: undefined as string | undefined,
      content_type: undefined as string[] | undefined,
      platform: undefined as string[] | undefined,
      author: undefined as string[] | undefined,
      date_from: undefined as string | undefined,
      date_to: undefined as string | undefined,
      keywords: undefined as string[] | undefined,
      starred: undefined as boolean | undefined,
      priority: undefined as string[] | undefined,
      workspace: undefined as string | undefined,
      user_tags: undefined as string[] | undefined,
      freshness: undefined as string[] | undefined,
      layer: undefined as string | undefined,
      entity: undefined as string | undefined,
      quality_issues: undefined as boolean | undefined,
      include_drafts: undefined as boolean | undefined,
      include_qa: undefined as boolean | undefined,
      sort: 'captured_date' as string,
      order: 'desc' as string,
    },
  },
  mockActiveFilterCount: { value: 0 },
  mockSetFilters: vi.fn(),
  mockClearFilters: vi.fn(),
  mockCounts: {
    value: {
      domain: {} as Record<string, number>,
      content_type: {} as Record<string, number>,
      platform: {} as Record<string, number>,
    },
  },
  mockAllAuthors: { value: [] as Array<{ name: string; count: number }> },
  mockAuthorSearch: { value: '' },
  mockSetAuthorSearch: vi.fn(),
  mockPopularKeywords: { value: [] as string[] },
  mockAllWorkspaces: {
    value: [] as Array<{ id: string; name: string; color: string }>,
  },
  mockAllUserTags: { value: [] as Array<{ tag: string; count: number }> },
  mockAllEntities: { value: [] as Array<{ name: string; count: number }> },
  mockOnOpenChange: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  }),
  usePathname: () => '/browse',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

vi.mock('@/hooks/browse/use-browse-filters', () => ({
  useBrowseFilters: () => ({
    filters: mockFilters.value,
    activeFilterCount: mockActiveFilterCount.value,
    setFilters: mockSetFilters,
    clearFilters: mockClearFilters,
    removeFilter: vi.fn(),
    removeFilterValue: vi.fn(),
  }),
}));

vi.mock('@/hooks/browse/use-filter-data', () => ({
  useFilterData: () => ({
    counts: mockCounts.value,
    authorSearch: mockAuthorSearch.value,
    setAuthorSearch: mockSetAuthorSearch,
    allAuthors: mockAllAuthors.value,
    popularKeywords: mockPopularKeywords.value,
    allWorkspaces: mockAllWorkspaces.value,
    allUserTags: mockAllUserTags.value,
    allEntities: mockAllEntities.value,
    entityTypeCounts: [],
  }),
}));

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn((..._args: unknown[]) => true),
}));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  CLIENT_CONFIG: { features: {}, layer_vocabulary: [] },
  FALLBACK_LAYERS: [],
}));

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [
      {
        key: 'sales_brief',
        label: 'Sales Brief',
        description: '',
        display_order: 1,
        is_active: true,
      },
      {
        key: 'bid_detail',
        label: 'Bid Detail',
        description: '',
        display_order: 2,
        is_active: true,
      },
      {
        key: 'company_reference',
        label: 'Company Reference',
        description: '',
        display_order: 3,
        is_active: true,
      },
      {
        key: 'research',
        label: 'Research',
        description: '',
        display_order: 4,
        is_active: true,
      },
    ],
    loading: false,
    error: null,
    getLayerKeys: () => [
      'sales_brief',
      'bid_detail',
      'company_reference',
      'research',
    ],
    getLayerLabel: (key: string) =>
      key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    getLayerDescription: () => '',
    refresh: vi.fn(),
  }),
}));

// Mock the Supabase client (used by sub-components like DomainFilter)
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      ),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

import { FilterPanel } from '@/components/browse/filter-panel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FilterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(true);
    mockFilters.value = {
      domain: undefined,
      subtopic: undefined,
      content_type: undefined,
      platform: undefined,
      author: undefined,
      date_from: undefined,
      date_to: undefined,
      keywords: undefined,
      starred: undefined,
      priority: undefined,
      workspace: undefined,
      user_tags: undefined,
      freshness: undefined,
      layer: undefined,
      entity: undefined,
      quality_issues: undefined,
      include_drafts: undefined,
      include_qa: undefined,
      sort: 'captured_date',
      order: 'desc',
    };
    mockActiveFilterCount.value = 0;
    mockCounts.value = { domain: {}, content_type: {}, platform: {} };
    mockAllAuthors.value = [];
    mockAuthorSearch.value = '';
    mockPopularKeywords.value = [];
    mockAllWorkspaces.value = [];
    mockAllUserTags.value = [];
    mockAllEntities.value = [];
  });

  it('renders filter sheet with title when open', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(
      screen.getByText('Narrow down your content items'),
    ).toBeInTheDocument();
  });

  it('renders domain filter section with taxonomy-driven options', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    // Domain section should show taxonomy domain names
    expect(screen.getByText('Domain')).toBeInTheDocument();
    expect(screen.getByText('Corporate')).toBeInTheDocument();
    expect(screen.getByText('Technical')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
  });

  it('renders content type filter section', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByText('Content Type')).toBeInTheDocument();
  });

  it('renders platform filter section inside Advanced', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    // Platform is now in the Advanced bucket — expand it first
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it('renders freshness filter section in Secondary tier', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    // Freshness is a secondary filter — section visible but collapsed (defaultOpen=false)
    expect(screen.getByText('Freshness')).toBeInTheDocument();
    // Expand the Freshness section to see the chips
    fireEvent.click(screen.getByText('Freshness'));
    const freshTexts = ['fresh', 'aging', 'stale', 'expired'];
    for (const text of freshTexts) {
      const buttons = screen.getAllByRole('button', {
        name: new RegExp(text, 'i'),
      });
      expect(buttons.length).toBeGreaterThan(0);
    }
  });

  it('renders priority filter section inside Advanced', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    // Priority is now in the Advanced bucket — expand it first
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('renders apply and clear buttons in the footer', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(
      screen.getByRole('button', { name: 'Apply filters' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear all' }),
    ).toBeInTheDocument();
  });

  it('disables clear all button when no filters are active', () => {
    mockActiveFilterCount.value = 0;

    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    const clearBtn = screen.getByRole('button', { name: 'Clear all' });
    expect(clearBtn).toBeDisabled();
  });

  it('renders quality issues checkbox inside Advanced', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    // Quality is now in the Advanced bucket — expand it first
    expect(screen.queryByText('Quality')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.getByText('Has quality issues')).toBeInTheDocument();
  });

  it('renders date range filter section inside Advanced', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    // Date Range is now in the Advanced bucket — expand it first
    expect(screen.queryByText('Date Range')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByText('Date Range')).toBeInTheDocument();
    // Expand the Date Range section itself
    fireEvent.click(screen.getByText('Date Range'));
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<FilterPanel open={false} onOpenChange={mockOnOpenChange} />);

    // The Sheet component should not render content when closed
    expect(screen.queryByText('Filters')).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Progressive disclosure (P1-1)
  // -----------------------------------------------------------------------

  describe('progressive disclosure', () => {
    it('renders high-signal filters visible without expanding Advanced', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // Primary filters should be visible immediately
      expect(screen.getByText('Domain')).toBeInTheDocument();
      expect(screen.getByText('Content Layer')).toBeInTheDocument();
      expect(screen.getByText('Content Type')).toBeInTheDocument();
      // Freshness is now Secondary (still visible, but collapsed)
      expect(screen.getByText('Freshness')).toBeInTheDocument();
    });

    it('hides advanced filters behind a disclosure toggle by default', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // The Advanced toggle should exist
      const advancedToggle = screen.getByRole('button', { name: /advanced/i });
      expect(advancedToggle).toBeInTheDocument();

      // Advanced sections should NOT be visible before expanding
      // Date Range is an advanced filter
      expect(screen.queryByText('Date Range')).not.toBeInTheDocument();
      // Keywords is an advanced filter
      expect(screen.queryByText('Keywords')).not.toBeInTheDocument();
    });

    it('reveals advanced filters when the Advanced toggle is clicked', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      const advancedToggle = screen.getByRole('button', { name: /advanced/i });
      fireEvent.click(advancedToggle);

      // After expanding, advanced sections should be visible
      expect(screen.getByText('Date Range')).toBeInTheDocument();
      expect(screen.getByText('Keywords')).toBeInTheDocument();
      expect(screen.getByText('Priority')).toBeInTheDocument();
      expect(screen.getByText('Quality')).toBeInTheDocument();
      expect(screen.getByText('Drafts')).toBeInTheDocument();
      expect(screen.getByText('Q&A Pairs')).toBeInTheDocument();
      expect(screen.getByText('Starred')).toBeInTheDocument();
      expect(screen.getByText('Owner')).toBeInTheDocument();
      expect(screen.getByText('Review Status')).toBeInTheDocument();
    });

    it('collapses advanced filters when the Advanced toggle is clicked again', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      const advancedToggle = screen.getByRole('button', { name: /advanced/i });

      // Open
      fireEvent.click(advancedToggle);
      expect(screen.getByText('Date Range')).toBeInTheDocument();

      // Close
      fireEvent.click(advancedToggle);
      expect(screen.queryByText('Date Range')).not.toBeInTheDocument();
    });

    it('keeps Author in secondary position (visible by default) and hides Platform behind Advanced', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // Author is secondary — visible without Advanced
      expect(screen.getByText('Author')).toBeInTheDocument();
      // Platform moved into Advanced bucket per audit 01a §P0-3
      expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    });

    it('shows Subtopic in the primary section when a single domain is selected', () => {
      mockFilters.value = { ...mockFilters.value, domain: ['Corporate'] };
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // SubtopicFilter renders "Subtopic (Corporate)" as its title
      expect(screen.getByText(/Subtopic \(Corporate\)/)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Filter application behaviour unchanged (P1-1)
  // -----------------------------------------------------------------------

  describe('filter application unchanged after reorganisation', () => {
    it('applies secondary filter (freshness) correctly after expanding section', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // Freshness is now secondary and defaultOpen={false} — expand section first
      fireEvent.click(screen.getByText('Freshness'));

      // Find the "fresh" toggle — use aria-pressed to distinguish from section heading
      const freshButtons = screen.getAllByRole('button', { name: /fresh/i });
      const freshToggle = freshButtons.find(
        (btn) => btn.getAttribute('aria-pressed') !== null,
      );
      expect(freshToggle).toBeDefined();
      fireEvent.click(freshToggle!);

      const applyBtn = screen.getByRole('button', { name: 'Apply filters' });
      fireEvent.click(applyBtn);

      expect(mockSetFilters).toHaveBeenCalled();
    });

    it('applies advanced filter (date range) correctly after expanding', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // Expand Advanced
      const advancedToggle = screen.getByRole('button', { name: /advanced/i });
      fireEvent.click(advancedToggle);

      // Expand Date Range section
      fireEvent.click(screen.getByText('Date Range'));

      const fromInput = screen.getByLabelText('From');
      fireEvent.change(fromInput, { target: { value: '2026-01-01' } });

      // Click apply
      const applyBtn = screen.getByRole('button', { name: 'Apply filters' });
      fireEvent.click(applyBtn);

      expect(mockSetFilters).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // P1-16: Three-axis tier regression tests
  // -----------------------------------------------------------------------

  describe('three-axis tier placement (P1-16)', () => {
    it('renders Layer filter in Primary tier (visible without Advanced)', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // Content Layer should be visible as a primary filter
      expect(screen.getByText('Content Layer')).toBeInTheDocument();
      // Layer chips should be visible without clicking Advanced
      expect(screen.getByText('Sales Brief')).toBeInTheDocument();
      expect(screen.getByText('Bid Detail')).toBeInTheDocument();
      expect(screen.getByText('Company Reference')).toBeInTheDocument();
      // 'Research' appears as both the Research layer chip and in the
      // Keywords filter's exposed keyword chips (pre-existing mock data).
      expect(screen.getAllByText('Research').length).toBeGreaterThanOrEqual(1);
    });

    it('renders Freshness in Secondary tier (not Primary)', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // Freshness section heading is visible (secondary tier is visible)
      expect(screen.getByText('Freshness')).toBeInTheDocument();

      // But freshness chips are NOT visible by default (defaultOpen=false)
      // The section must be expanded to see the state buttons
      expect(
        screen.queryByRole('button', { name: /^fresh$/i }),
      ).not.toBeInTheDocument();

      // Expand the section
      fireEvent.click(screen.getByText('Freshness'));
      const freshButtons = screen.getAllByRole('button', { name: /fresh/i });
      const freshToggle = freshButtons.find(
        (btn) => btn.getAttribute('aria-pressed') !== null,
      );
      expect(freshToggle).toBeDefined();
    });

    it('does not duplicate Layer inside Advanced tier', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      // Layer is in Primary
      expect(screen.getByText('Content Layer')).toBeInTheDocument();

      // Expand Advanced
      fireEvent.click(screen.getByRole('button', { name: /advanced/i }));

      // Content Layer should appear exactly once (in Primary, not duplicated in Advanced)
      expect(screen.getAllByText('Content Layer')).toHaveLength(1);
    });

    it('hides Layer when content_layers feature flag is disabled', () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      expect(screen.queryByText('Content Layer')).not.toBeInTheDocument();
      expect(screen.queryByText('Sales Brief')).not.toBeInTheDocument();
    });

    it('Primary tier contains Domain, Layer, Content Type in correct order', () => {
      render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

      const domainEl = screen.getByText('Domain');
      const layerEl = screen.getByText('Content Layer');
      const typeEl = screen.getByText('Content Type');

      // All three should be in the document before the Advanced toggle
      const advancedToggle = screen.getByRole('button', { name: /advanced/i });

      // Compare DOM positions: Primary elements should precede Advanced
      expect(
        domainEl.compareDocumentPosition(advancedToggle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        layerEl.compareDocumentPosition(advancedToggle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        typeEl.compareDocumentPosition(advancedToggle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // Layer should come after Domain, before Content Type
      expect(
        domainEl.compareDocumentPosition(layerEl) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        layerEl.compareDocumentPosition(typeEl) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});
