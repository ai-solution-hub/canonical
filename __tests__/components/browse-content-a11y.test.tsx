/**
 * BrowseContent Accessibility Tests
 *
 * Tests that the Browse page has correct aria-labels based on search mode,
 * and that a screen reader announcement is rendered when search results load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// Cold-start gate transitively renders `PromptCardChipComposite` which
// reads `useTaxonomy` + `useTopDomains` (Supabase RPC). Stub both so
// non-search-mode tests don't need a TaxonomyProvider chain.
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: () => [] as string[],
    formatDomainName: (name: string) => name,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: vi.fn(async () => ({ data: { domain: {} }, error: null })),
  }),
}));

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() factories
// ---------------------------------------------------------------------------

const mockBrowseData = vi.hoisted(() => ({
  items: [] as Array<{ id: string }>,
  totalCount: null as number | null,
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  qualityFlaggedIds: new Set<string>(),
  freshnessCounts: null,
  sentinelCallbackRef: vi.fn(),
  filters: { sort: 'captured_date', order: 'desc' as const },
  activeFilterCount: 0,
  setFilters: vi.fn(),
  searchQuery: undefined as string | undefined,
  setSearchQuery: vi.fn(),
  clearFilters: vi.fn(),
  isSearchMode: false,
  searchError: null,
  updateItemLocally: vi.fn(),
  updateQualityFlag: vi.fn(),
}));

const mockFilterPresets = vi.hoisted(() => ({
  presets: [],
  activePreset: null,
  applyPreset: vi.fn(),
  savePreset: vi.fn(),
  renamePreset: vi.fn(),
  deletePreset: vi.fn(),
  restorePreset: vi.fn(),
  canSave: false,
}));

const mockQuickAssign = vi.hoisted(() => ({
  activeWorkspaces: [],
  itemAssignments: new Map(),
  toggleAssignment: vi.fn(),
  loadAssignments: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/browse',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function DynamicComponent() {
      return null;
    },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/hooks/browse/use-browse-data', () => ({
  useBrowseData: () => mockBrowseData,
}));

vi.mock('@/hooks/browse/use-filter-presets', () => ({
  useFilterPresets: () => mockFilterPresets,
}));

vi.mock('@/hooks/use-quick-assign', () => ({
  useQuickAssign: () => mockQuickAssign,
}));

vi.mock('@/hooks/ui/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/hooks/ui/use-view-mode', () => ({
  useViewMode: () => ['grid', vi.fn()],
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ canEdit: false, role: 'viewer' }),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: () => new Map(),
}));

vi.mock('@/hooks/use-primary-focus', () => ({
  usePrimaryFocus: () => ({ primaryFocus: null, isLoading: false }),
}));

vi.mock('@/contexts/read-marks-context', () => ({
  useReadMarks: () => ({
    isRead: () => false,
    readItemIds: new Set(),
    markBulkRead: vi.fn(),
    isLoaded: true,
    loadReadMarks: vi.fn(),
    checkReadStatus: vi.fn(),
  }),
}));

vi.mock('@/lib/browse-helpers', () => ({
  getSortOptionFromFilters: () => 'date-desc',
  getSortFiltersFromOption: () => ({ sort: 'captured_date', order: 'desc' }),
}));

vi.mock('@/lib/claude-prompts', () => ({
  generateIngestDocumentPrompt: () => ({ prompt: 'test' }),
}));

// Mock child components that are complex or use their own contexts
vi.mock('@/components/content/content-grid', () => ({
  ContentGrid: () => <div data-testid="content-grid" />,
}));

vi.mock('@/components/content/content-list', () => ({
  ContentList: () => <div data-testid="content-list" />,
}));

vi.mock('@/components/browse/filter-panel', () => ({
  FilterPanel: () => null,
}));

vi.mock('@/components/browse/filter-badges', () => ({
  FilterBadges: () => null,
}));

vi.mock('@/components/browse/filter-bar', () => ({
  FilterBar: () => null,
}));

vi.mock('@/components/browse/bulk-actions', () => ({
  BulkActions: () => null,
}));

vi.mock('@/components/browse/browse-states', () => ({
  LoadingSkeleton: () => <div>Loading...</div>,
  EmptyState: () => <div>No items</div>,
}));

vi.mock('@/components/browse/preset-bar', () => ({
  PresetBar: () => null,
}));

vi.mock('@/components/browse/save-preset-dialog', () => ({
  SavePresetDialog: () => null,
}));

vi.mock('@/components/browse/manage-presets-dialog', () => ({
  ManagePresetsDialog: () => null,
}));

vi.mock('@/components/content/claude-prompt-button', () => ({
  ClaudePromptButton: () => null,
}));

// Import AFTER mocks
import { BrowseContent } from '@/app/browse/browse-content';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowseContent — accessibility', () => {
  beforeEach(() => {
    // Reset to default non-search state
    mockBrowseData.isSearchMode = false;
    mockBrowseData.searchQuery = undefined;
    mockBrowseData.totalCount = 42;
    mockBrowseData.isLoading = false;
    mockBrowseData.items = [];
  });

  describe('aria-label on results container', () => {
    it('uses "Browse content" aria-label when not in search mode', () => {
      render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });
      expect(
        screen.getByRole('region', { name: 'Browse content' }),
      ).toBeInTheDocument();
    });

    it('uses "Browse and search results" aria-label when in search mode', () => {
      mockBrowseData.isSearchMode = true;
      mockBrowseData.searchQuery = 'data protection';
      mockBrowseData.totalCount = 5;
      render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });
      expect(
        screen.getByRole('region', { name: 'Browse and search results' }),
      ).toBeInTheDocument();
    });
  });

  describe('screen reader announcement', () => {
    it('announces result count when search completes', () => {
      mockBrowseData.isSearchMode = true;
      mockBrowseData.searchQuery = 'data protection';
      mockBrowseData.totalCount = 5;
      mockBrowseData.isLoading = false;
      render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

      screen.getByRole('status', { name: '' });
      // The sr-only div with aria-live="polite"
      const srOnlyDivs = document.querySelectorAll('[aria-live="polite"]');
      const announcementDiv = Array.from(srOnlyDivs).find((el) =>
        el.classList.contains('sr-only'),
      );
      expect(announcementDiv).toBeDefined();
      expect(announcementDiv!.textContent).toBe(
        '5 results for data protection',
      );
    });

    it('announces singular "result" for count of 1', () => {
      mockBrowseData.isSearchMode = true;
      mockBrowseData.searchQuery = 'specific query';
      mockBrowseData.totalCount = 1;
      mockBrowseData.isLoading = false;
      render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

      const srOnlyDivs = document.querySelectorAll('[aria-live="polite"]');
      const announcementDiv = Array.from(srOnlyDivs).find((el) =>
        el.classList.contains('sr-only'),
      );
      expect(announcementDiv).toBeDefined();
      expect(announcementDiv!.textContent).toBe('1 result for specific query');
    });

    it('does not announce when not in search mode', () => {
      mockBrowseData.isSearchMode = false;
      mockBrowseData.searchQuery = undefined;
      mockBrowseData.totalCount = 42;
      render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

      const srOnlyDivs = document.querySelectorAll('[aria-live="polite"]');
      const announcementDiv = Array.from(srOnlyDivs).find((el) =>
        el.classList.contains('sr-only'),
      );
      expect(announcementDiv).toBeDefined();
      expect(announcementDiv!.textContent).toBe('');
    });

    it('does not announce while loading', () => {
      mockBrowseData.isSearchMode = true;
      mockBrowseData.searchQuery = 'loading query';
      mockBrowseData.totalCount = null;
      mockBrowseData.isLoading = true;
      render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

      const srOnlyDivs = document.querySelectorAll('[aria-live="polite"]');
      const announcementDiv = Array.from(srOnlyDivs).find((el) =>
        el.classList.contains('sr-only'),
      );
      expect(announcementDiv).toBeDefined();
      expect(announcementDiv!.textContent).toBe('');
    });
  });
});
