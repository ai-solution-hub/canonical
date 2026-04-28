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

  // --- Filter-empty branch (unchanged) ---

  it('shows "No items match your filters" when hasFilters is true', () => {
    render(<EmptyState hasFilters={true} canEdit={false} />);
    expect(screen.getByText('No items match your filters')).toBeInTheDocument();
  });

  it('shows clear filters button that calls clearFilters when hasFilters is true', async () => {
    const user = userEvent.setup();
    render(<EmptyState hasFilters={true} canEdit={false} />);
    const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
    await user.click(clearBtn);
    expect(mockClearFilters).toHaveBeenCalledOnce();
  });

  // --- First-run branch (retrofitted to shared EmptyState) ---

  it('shows "No content yet" heading when no items and no filters', () => {
    render(<EmptyState hasFilters={false} canEdit={false} />);
    expect(
      screen.getByRole('heading', { name: 'No content yet' }),
    ).toBeInTheDocument();
  });

  it('shows description text when no items and no filters', () => {
    render(<EmptyState hasFilters={false} canEdit={false} />);
    expect(
      screen.getByText('Content added to the knowledge base will appear here.'),
    ).toBeInTheDocument();
  });

  it('shows "Add content" CTA linking to /item/new when canEdit is true', () => {
    render(<EmptyState hasFilters={false} canEdit={true} />);
    const cta = screen.getByRole('link', { name: 'Add content' });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/item/new');
  });

  it('shows "Import from URL" secondary CTA when canEdit is true', () => {
    render(<EmptyState hasFilters={false} canEdit={true} />);
    const cta = screen.getByRole('link', { name: 'Import from URL' });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/item/new?tab=url');
  });

  it('hides both CTAs when canEdit is false (viewer)', () => {
    render(<EmptyState hasFilters={false} canEdit={false} />);
    expect(screen.queryByRole('link', { name: 'Add content' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Import from URL' })).toBeNull();
  });

  it('does NOT show Q&A Library cross-link (AC-10 regression)', () => {
    render(<EmptyState hasFilters={false} canEdit={true} />);
    expect(screen.queryByText(/Q&A Library/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Q&A Library/i })).toBeNull();
  });

  it('does NOT link to /library anywhere in first-run state', () => {
    const { container } = render(
      <EmptyState hasFilters={false} canEdit={true} />,
    );
    const links = container.querySelectorAll('a[href="/library"]');
    expect(links).toHaveLength(0);
  });
});
