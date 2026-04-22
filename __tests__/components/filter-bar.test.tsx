/**
 * FilterBar Component Tests
 *
 * Tests the FilterBar component — Display dropdown (view mode, unread toggle,
 * multi-select, thumbnails), sort controls, and filter button with active count.
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
  it('renders the Display dropdown trigger', () => {
    render(<FilterBar {...makeProps()} />);
    expect(screen.getByTestId('display-menu')).toBeInTheDocument();
  });

  it('renders the Filters button', () => {
    render(<FilterBar {...makeProps()} />);
    expect(
      screen.getByRole('button', { name: /Filters/i }),
    ).toBeInTheDocument();
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

  // ── Display dropdown ──

  it('Display dropdown shows view mode options (Grid + List)', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...makeProps()} />);

    await user.click(screen.getByTestId('display-menu'));
    expect(screen.getByText('Grid view')).toBeInTheDocument();
    expect(screen.getByText('List view')).toBeInTheDocument();
  });

  it('calls onViewChange(list) from Display dropdown', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<FilterBar {...makeProps({ viewMode: 'grid', onViewChange })} />);

    await user.click(screen.getByTestId('display-menu'));
    await user.click(screen.getByText('List view'));
    expect(onViewChange).toHaveBeenCalledWith('list');
  });

  it('calls onViewChange(grid) from Display dropdown', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<FilterBar {...makeProps({ viewMode: 'list', onViewChange })} />);

    await user.click(screen.getByTestId('display-menu'));
    await user.click(screen.getByText('Grid view'));
    expect(onViewChange).toHaveBeenCalledWith('grid');
  });

  it('Display dropdown shows unread toggle', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...makeProps()} />);

    await user.click(screen.getByTestId('display-menu'));
    expect(screen.getByText('Show unread only')).toBeInTheDocument();
  });

  it('calls onToggleUnreadOnly from Display dropdown', async () => {
    const user = userEvent.setup();
    const onToggleUnreadOnly = vi.fn();
    render(<FilterBar {...makeProps({ onToggleUnreadOnly })} />);

    await user.click(screen.getByTestId('display-menu'));
    await user.click(screen.getByText('Show unread only'));
    expect(onToggleUnreadOnly).toHaveBeenCalledOnce();
  });

  it('Display dropdown shows "Show all items" when unread only is active', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...makeProps({ showUnreadOnly: true })} />);

    await user.click(screen.getByTestId('display-menu'));
    expect(screen.getByText('Show all items')).toBeInTheDocument();
  });

  it('Display dropdown shows select items option', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...makeProps()} />);

    await user.click(screen.getByTestId('display-menu'));
    expect(screen.getByText('Select items')).toBeInTheDocument();
  });

  it('calls onToggleMultiSelect from Display dropdown', async () => {
    const user = userEvent.setup();
    const onToggleMultiSelect = vi.fn();
    render(<FilterBar {...makeProps({ onToggleMultiSelect })} />);

    await user.click(screen.getByTestId('display-menu'));
    await user.click(screen.getByText('Select items'));
    expect(onToggleMultiSelect).toHaveBeenCalledOnce();
  });

  it('Display dropdown shows thumbnail toggle when in grid mode', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...makeProps({ viewMode: 'grid' })} />);

    await user.click(screen.getByTestId('display-menu'));
    expect(screen.getByText('Hide thumbnails')).toBeInTheDocument();
  });

  it('Display dropdown hides thumbnail toggle when in list mode', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...makeProps({ viewMode: 'list' })} />);

    await user.click(screen.getByTestId('display-menu'));
    expect(screen.queryByText('Hide thumbnails')).not.toBeInTheDocument();
    expect(screen.queryByText('Show thumbnails')).not.toBeInTheDocument();
  });

  it('marks the active view mode as checked in Display dropdown', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...makeProps({ viewMode: 'grid' })} />);

    await user.click(screen.getByTestId('display-menu'));
    // Radix DropdownMenuRadioItem uses role="menuitemradio" with aria-checked
    const gridItem = screen
      .getByText('Grid view')
      .closest('[role="menuitemradio"]');
    expect(gridItem).toHaveAttribute('aria-checked', 'true');
    const listItem = screen
      .getByText('List view')
      .closest('[role="menuitemradio"]');
    expect(listItem).toHaveAttribute('aria-checked', 'false');
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
