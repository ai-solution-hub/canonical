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
  mockRemoveFilter,
  mockRemoveFilterValue,
  mockClearFilters,
} = vi.hoisted(() => ({
  mockFilters: {
    value: {} as Record<string, unknown>,
  },
  mockActiveFilterCount: { value: 0 },
  mockRemoveFilter: vi.fn(),
  mockRemoveFilterValue: vi.fn(),
  mockClearFilters: vi.fn(),
}));

vi.mock('@/hooks/use-browse-filters', () => ({
  useBrowseFilters: () => ({
    filters: mockFilters.value,
    activeFilterCount: mockActiveFilterCount.value,
    removeFilter: mockRemoveFilter,
    removeFilterValue: mockRemoveFilterValue,
    clearFilters: mockClearFilters,
  }),
}));

vi.mock('@/lib/taxonomy-format', () => ({
  formatSubtopic: (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
}));

vi.mock('@/lib/format', () => ({
  formatContentType: (t: string) => t.charAt(0).toUpperCase() + t.slice(1),
  formatPlatform: (p: string) => p.charAt(0).toUpperCase() + p.slice(1),
  formatDateUK: (d: string) => d,
}));

vi.mock('@/lib/validation/layer-schemas', () => ({
  getLayerLabel: (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
}));

import { FilterBadges } from '@/components/filter-badges';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FilterBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilters.value = {};
    mockActiveFilterCount.value = 0;
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
    expect(screen.getByLabelText('Remove Domain filter: Corporate')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
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
});
