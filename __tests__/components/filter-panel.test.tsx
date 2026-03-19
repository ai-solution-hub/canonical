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
  mockAllWorkspaces: { value: [] as Array<{ id: string; name: string; color: string }> },
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

vi.mock('@/hooks/use-browse-filters', () => ({
  useBrowseFilters: () => ({
    filters: mockFilters.value,
    activeFilterCount: mockActiveFilterCount.value,
    setFilters: mockSetFilters,
    clearFilters: mockClearFilters,
    removeFilter: vi.fn(),
    removeFilterValue: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-filter-data', () => ({
  useFilterData: () => ({
    counts: mockCounts.value,
    authorSearch: mockAuthorSearch.value,
    setAuthorSearch: mockSetAuthorSearch,
    allAuthors: mockAllAuthors.value,
    popularKeywords: mockPopularKeywords.value,
    allWorkspaces: mockAllWorkspaces.value,
    allUserTags: mockAllUserTags.value,
    allEntities: mockAllEntities.value,
  }),
}));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: () => false,
  CLIENT_CONFIG: { features: {} },
}));

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [],
    loading: false,
    error: null,
    getLayerKeys: () => [],
    getLayerLabel: (key: string) => key,
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

import { FilterPanel } from '@/components/filter-panel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FilterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText('Narrow down your content items')).toBeInTheDocument();
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

  it('renders platform filter section', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it('renders freshness filter section with all four states', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByText('Freshness')).toBeInTheDocument();
    // Freshness is collapsed by default — expand it first
    fireEvent.click(screen.getByText('Freshness'));
    // The text labels within the freshness buttons
    const freshTexts = ['fresh', 'aging', 'stale', 'expired'];
    for (const text of freshTexts) {
      // Each freshness button has a capitalized label span
      const buttons = screen.getAllByRole('button', { name: new RegExp(text, 'i') });
      expect(buttons.length).toBeGreaterThan(0);
    }
  });

  it('renders priority filter section with high/medium/low options', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('renders apply and clear buttons in the footer', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('disables clear all button when no filters are active', () => {
    mockActiveFilterCount.value = 0;

    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    const clearBtn = screen.getByRole('button', { name: 'Clear all' });
    expect(clearBtn).toBeDisabled();
  });

  it('renders quality issues checkbox', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.getByText('Has quality issues')).toBeInTheDocument();
  });

  it('renders date range filter section with from/to inputs', () => {
    render(<FilterPanel open={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByText('Date Range')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <FilterPanel open={false} onOpenChange={mockOnOpenChange} />,
    );

    // The Sheet component should not render content when closed
    expect(screen.queryByText('Filters')).not.toBeInTheDocument();
  });
});
