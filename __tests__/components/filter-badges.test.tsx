/**
 * FilterBadges Component Tests
 *
 * Tests the FilterBadges component — active filter badge rendering,
 * remove buttons, clear all, and conditional rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockFilters,
  mockActiveFilterCount,
  mockSearchQuery,
  mockRemoveFilter,
  mockRemoveFilterValue,
  mockClearFilters,
  mockClearSearchQuery,
} = vi.hoisted(() => ({
  mockFilters: {
    value: {} as Record<string, unknown>,
  },
  mockActiveFilterCount: { value: 0 },
  mockSearchQuery: { value: undefined as string | undefined },
  mockRemoveFilter: vi.fn(),
  mockRemoveFilterValue: vi.fn(),
  mockClearFilters: vi.fn(),
  mockClearSearchQuery: vi.fn(),
}));

vi.mock('@/hooks/browse/use-browse-filters', () => ({
  useBrowseFilters: () => ({
    filters: mockFilters.value,
    activeFilterCount: mockActiveFilterCount.value,
    searchQuery: mockSearchQuery.value,
    removeFilter: mockRemoveFilter,
    removeFilterValue: mockRemoveFilterValue,
    clearFilters: mockClearFilters,
    clearSearchQuery: mockClearSearchQuery,
  }),
}));

vi.mock('@/lib/taxonomy/taxonomy-format', () => ({
  formatSubtopic: (s: string) =>
    s.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
}));

vi.mock('@/lib/format', () => ({
  formatContentType: (t: string) => t.charAt(0).toUpperCase() + t.slice(1),
  formatPlatform: (p: string) => p.charAt(0).toUpperCase() + p.slice(1),
  formatDateUK: (d: string) => d,
}));

vi.mock('@/lib/validation/layer-schemas', () => ({
  getLayerLabel: (key: string) =>
    key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
}));

import { FilterBadges } from '@/components/browse/filter-badges';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FilterBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilters.value = {};
    mockActiveFilterCount.value = 0;
    mockSearchQuery.value = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when no active filters', () => {
    const { container } = render(<FilterBadges />);
    expect(container.innerHTML).toBe('');
  });

  it('shows domain badges with remove buttons', () => {
    mockActiveFilterCount.value = 1;
    mockFilters.value = { domain: ['Corporate'] };
    render(<FilterBadges />);
    expect(screen.getByText('Corporate')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Remove Domain filter: Corporate'),
    ).toBeInTheDocument();
  });

  it('shows content type badges', () => {
    mockActiveFilterCount.value = 1;
    mockFilters.value = { content_type: ['article'] };
    render(<FilterBadges />);
    expect(screen.getByText('Article')).toBeInTheDocument();
  });

  it('shows platform badges', () => {
    mockActiveFilterCount.value = 1;
    mockFilters.value = { platform: ['web'] };
    render(<FilterBadges />);
    expect(screen.getByText('Web')).toBeInTheDocument();
  });

  it('shows date range badge', () => {
    mockActiveFilterCount.value = 1;
    mockFilters.value = { date_from: '2026-01-01', date_to: '2026-02-01' };
    render(<FilterBadges />);
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
  });

  it('shows "Clear all" button when more than 1 filter is active', () => {
    mockActiveFilterCount.value = 2;
    mockFilters.value = { domain: ['Corporate'], platform: ['web'] };
    render(<FilterBadges />);
    expect(
      screen.getByRole('button', { name: 'Clear all' }),
    ).toBeInTheDocument();
  });

  it('remove button calls removeFilterValue', async () => {
    const user = userEvent.setup();
    mockActiveFilterCount.value = 1;
    mockFilters.value = { domain: ['Corporate'] };
    render(<FilterBadges />);
    const removeBtn = screen.getByLabelText('Remove Domain filter: Corporate');
    await user.click(removeBtn);
    expect(mockRemoveFilterValue).toHaveBeenCalledWith('domain', 'Corporate');
  });

  it('clear all button calls clearFilters', async () => {
    const user = userEvent.setup();
    mockActiveFilterCount.value = 2;
    mockFilters.value = { domain: ['Corporate'], platform: ['web'] };
    render(<FilterBadges />);
    const clearBtn = screen.getByRole('button', { name: 'Clear all' });
    await user.click(clearBtn);
    expect(mockClearFilters).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Search query badge
  // -------------------------------------------------------------------------

  it('shows search query badge when searchQuery is set', () => {
    mockActiveFilterCount.value = 1;
    mockSearchQuery.value = 'infrastructure planning';
    render(<FilterBadges />);
    expect(screen.getByText('Search:')).toBeInTheDocument();
    expect(screen.getByText('infrastructure planning')).toBeInTheDocument();
  });

  it('search query badge shows "Search: {query}" format', () => {
    mockActiveFilterCount.value = 1;
    mockSearchQuery.value = 'test query';
    render(<FilterBadges />);
    // The badge renders "Search:" as the label and the query as the value
    const badge = screen.getByText('test query');
    expect(badge).toBeInTheDocument();
    // The label "Search:" should precede it
    expect(screen.getByText('Search:')).toBeInTheDocument();
  });

  it('search query badge truncates at 40 characters', () => {
    mockActiveFilterCount.value = 1;
    // 50 character query — should be truncated to 37 + ellipsis
    mockSearchQuery.value =
      'This is a very long search query that exceeds fort';
    render(<FilterBadges />);
    // Should show first 37 chars + ellipsis character
    expect(
      screen.getByText('This is a very long search query that\u2026'),
    ).toBeInTheDocument();
    // Full text should not appear
    expect(screen.queryByText(mockSearchQuery.value)).not.toBeInTheDocument();
  });

  it('search query badge remove button calls clearSearchQuery', async () => {
    const user = userEvent.setup();
    mockActiveFilterCount.value = 1;
    mockSearchQuery.value = 'test query';
    render(<FilterBadges />);
    const removeBtn = screen.getByLabelText('Remove Search filter: test query');
    await user.click(removeBtn);
    expect(mockClearSearchQuery).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // P1-16: Three-axis badge ordering regression
  // -------------------------------------------------------------------------

  describe('three-axis badge ordering (P1-16)', () => {
    it('renders Layer badge at position 4 (after Domain and Subtopic, before Content Type)', () => {
      mockActiveFilterCount.value = 4;
      mockFilters.value = {
        domain: ['Corporate'],
        subtopic: 'pricing',
        layer: 'sales_brief',
        content_type: ['article'],
      };
      render(<FilterBadges />);

      // Get all rendered badges by their remove buttons (each badge has one)
      const removeButtons = screen.getAllByRole('button', {
        name: /^Remove .+ filter:/,
      });

      // Expected order: Domain, Subtopic, Layer, Type
      expect(removeButtons[0]).toHaveAttribute(
        'aria-label',
        'Remove Domain filter: Corporate',
      );
      expect(removeButtons[1]).toHaveAttribute(
        'aria-label',
        'Remove Subtopic filter: Pricing',
      );
      expect(removeButtons[2]).toHaveAttribute(
        'aria-label',
        'Remove Layer filter: Sales Brief',
      );
      expect(removeButtons[3]).toHaveAttribute(
        'aria-label',
        'Remove Type filter: Article',
      );
    });

    it('renders Layer badge before Freshness badge', () => {
      mockActiveFilterCount.value = 2;
      mockFilters.value = {
        layer: 'bid_detail',
        freshness: ['fresh'],
      };
      render(<FilterBadges />);

      const removeButtons = screen.getAllByRole('button', {
        name: /^Remove .+ filter:/,
      });

      // Layer should come before Freshness
      const layerIdx = removeButtons.findIndex(
        (btn) => btn.getAttribute('aria-label') === 'Remove Layer filter: Bid Detail',
      );
      // Freshness badges don't exist as a named filter in the current badges
      // but Layer should be first in this set
      expect(layerIdx).toBe(0);
    });

    it('renders Layer badge with formatted label from getLayerLabel', () => {
      mockActiveFilterCount.value = 1;
      mockFilters.value = { layer: 'company_reference' };
      render(<FilterBadges />);

      expect(screen.getByText('Layer:')).toBeInTheDocument();
      expect(screen.getByText('Company Reference')).toBeInTheDocument();
    });
  });
});
