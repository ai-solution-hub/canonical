/**
 * BrowseStates Component Tests
 *
 * Tests the LoadingSkeleton and EmptyState components used by the browse page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockClearFilters } = vi.hoisted(() => ({
  mockClearFilters: vi.fn(),
}));

vi.mock('@/hooks/browse/use-browse-filters', () => ({
  useBrowseFilters: () => ({
    clearFilters: mockClearFilters,
  }),
}));

import { LoadingSkeleton, EmptyState } from '@/components/browse/browse-states';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoadingSkeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders list view skeleton with bordered rows', () => {
    const { container } = render(<LoadingSkeleton viewMode="list" />);
    // List skeleton has a bordered container with 10 child rows
    const rows = container.querySelectorAll('[style*="height: 64px"]');
    expect(rows).toHaveLength(10);
  });

  it('renders grid view skeleton with 12 card placeholders', () => {
    const { container } = render(<LoadingSkeleton viewMode="grid" />);
    // Grid skeleton renders 12 skeleton cards in a grid
    const grid = container.querySelector('[style*="grid-template-columns"]');
    expect(grid).toBeTruthy();
    expect(grid!.children).toHaveLength(12);
  });
});

describe('EmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "No items match your filters" when hasFilters is true', () => {
    render(<EmptyState hasFilters={true} />);
    expect(screen.getByText('No items match your filters')).toBeInTheDocument();
  });

  it('shows "No content yet" when hasFilters is false', () => {
    render(<EmptyState hasFilters={false} />);
    expect(screen.getByText('No content yet')).toBeInTheDocument();
  });

  it('shows clear filters button that calls clearFilters when hasFilters is true', async () => {
    const user = userEvent.setup();
    render(<EmptyState hasFilters={true} />);
    const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
    await user.click(clearBtn);
    expect(mockClearFilters).toHaveBeenCalledOnce();
  });
});
