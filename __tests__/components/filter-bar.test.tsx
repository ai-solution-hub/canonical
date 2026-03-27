/**
 * FilterBar Component Tests
 *
 * Tests the FilterBar component — view mode toggle, sort controls,
 * filter button with active count, and overflow menu interactions.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SortOption, ViewMode } from '@/components/browse/filter-bar';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Radix Select uses portals — mock to render inline
vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return actual;
});

// Import AFTER mocks
import { FilterBar, getSortOptions } from '@/components/browse/filter-bar';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface FilterBarTestProps {
  showUnreadOnly?: boolean;
  onToggleUnreadOnly?: () => void;
  multiSelectMode?: boolean;
  onToggleMultiSelect?: () => void;
  sortOption?: SortOption;
  onSortChange?: (value: SortOption) => void;
  viewMode?: ViewMode;
  onViewChange?: (mode: ViewMode) => void;
  hideThumbnails?: boolean;
  onToggleThumbnails?: () => void;
  activeFilterCount?: number;
  onOpenFilters?: () => void;
  hasSearchQuery?: boolean;
}

function makeProps(overrides: FilterBarTestProps = {}) {
  return {
    showUnreadOnly: false,
    onToggleUnreadOnly: vi.fn(),
    multiSelectMode: false,
    onToggleMultiSelect: vi.fn(),
    sortOption: 'date-desc' as SortOption,
    onSortChange: vi.fn(),
    viewMode: 'grid' as ViewMode,
    onViewChange: vi.fn(),
    hideThumbnails: false,
    onToggleThumbnails: vi.fn(),
    activeFilterCount: 0,
    onOpenFilters: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FilterBar', () => {
  it('renders view mode toggle buttons', () => {
    render(<FilterBar {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List view' })).toBeInTheDocument();
  });

  it('marks the active view mode button as pressed', () => {
    render(<FilterBar {...makeProps({ viewMode: 'list' })} />);
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onViewChange when grid button clicked', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<FilterBar {...makeProps({ viewMode: 'list', onViewChange })} />);

    await user.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(onViewChange).toHaveBeenCalledWith('grid');
  });

  it('calls onViewChange when list button clicked', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<FilterBar {...makeProps({ viewMode: 'grid', onViewChange })} />);

    await user.click(screen.getByRole('button', { name: 'List view' }));
    expect(onViewChange).toHaveBeenCalledWith('list');
  });

  it('renders the Filters button', () => {
    render(<FilterBar {...makeProps()} />);
    expect(screen.getByRole('button', { name: /Filters/i })).toBeInTheDocument();
  });

  it('calls onOpenFilters when Filters button clicked', async () => {
    const user = userEvent.setup();
    const onOpenFilters = vi.fn();
    render(<FilterBar {...makeProps({ onOpenFilters })} />);

    await user.click(screen.getByRole('button', { name: /Filters/i }));
    expect(onOpenFilters).toHaveBeenCalledOnce();
  });

  it('shows active filter count badge when filters are active', () => {
    render(<FilterBar {...makeProps({ activeFilterCount: 3 })} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show filter count badge when no filters active', () => {
    render(<FilterBar {...makeProps({ activeFilterCount: 0 })} />);
    // The number "0" should not appear as a badge
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders the view mode group with correct role', () => {
    render(<FilterBar {...makeProps()} />);
    expect(screen.getByRole('group', { name: 'View mode' })).toBeInTheDocument();
  });

  it('renders the More options overflow menu trigger', () => {
    render(<FilterBar {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Relevance sort option (search mode)
  // -------------------------------------------------------------------------

  it('getSortOptions includes Relevance when hasSearchQuery is true', () => {
    const options = getSortOptions(true);
    expect(options[0].value).toBe('relevance');
    expect(options[0].label).toBe('Relevance');
    // Base options should still be present after relevance
    expect(options.length).toBe(7); // 1 relevance + 6 base
  });

  it('getSortOptions does NOT include Relevance when hasSearchQuery is false', () => {
    const options = getSortOptions(false);
    const relevanceOption = options.find((o) => o.value === 'relevance');
    expect(relevanceOption).toBeUndefined();
    expect(options.length).toBe(6); // 6 base options only
  });

  it('renders "Relevance" sort value when hasSearchQuery is true and sortOption is relevance', () => {
    render(
      <FilterBar
        {...makeProps({ hasSearchQuery: true, sortOption: 'relevance' })}
      />,
    );
    // "Relevance" appears in both the SelectValue and the mobile shortLabel span
    const elements = screen.getAllByText('Relevance');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('does not render "Relevance" short label when hasSearchQuery is false', () => {
    render(
      <FilterBar
        {...makeProps({ hasSearchQuery: false, sortOption: 'date-desc' })}
      />,
    );
    // "Relevance" should not appear anywhere since it is not in the sort options
    expect(screen.queryByText('Relevance')).not.toBeInTheDocument();
  });
});
