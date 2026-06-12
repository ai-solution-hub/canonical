/**
 * BrowseContent Verification Names Integration Tests
 *
 * Tests that BrowseContent correctly collects verified_by UUIDs from items,
 * resolves them via useDisplayNames, and passes the resulting map to
 * ContentGrid and ContentList.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { createQueryWrapper } from '../../helpers/query-wrapper';

// Cold-start gate renders SearchPromptCards → PromptCardChipComposite
// which reads `useTaxonomy` + `useTopDomains`. Stub both to a benign
// empty state.
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
// Hoisted mocks — must be declared before vi.mock() factories reference them
// ---------------------------------------------------------------------------

const {
  mockUseDisplayNames,
  mockUseBrowseData,
  mockItems,
  mockContentGridProps,
  mockContentListProps,
} = vi.hoisted(() => {
  const mockItems = [
    {
      id: 'item-1',
      title: 'Item One',
      suggested_title: null,
      summary: 'Summary one',
      primary_domain: 'Corporate',
      primary_subtopic: null,
      content_type: 'article',
      platform: 'web',
      author_name: null,
      source_domain: null,
      source_file: null,
      thumbnail_url: null,
      captured_date: '2026-01-15T10:00:00Z',
      ai_keywords: null,
      classification_confidence: 0.9,
      priority: null,
      freshness: 'fresh',
      user_tags: null,
      governance_review_status: null,
      metadata: null,
      content: null,
      brief: null,
      verified_at: '2026-03-20T12:00:00Z',
      verified_by: 'user-uuid-1',
    },
    {
      id: 'item-2',
      title: 'Item Two',
      suggested_title: null,
      summary: 'Summary two',
      primary_domain: 'Technical',
      primary_subtopic: null,
      content_type: 'article',
      platform: 'web',
      author_name: null,
      source_domain: null,
      source_file: null,
      thumbnail_url: null,
      captured_date: '2026-01-16T10:00:00Z',
      ai_keywords: null,
      classification_confidence: 0.85,
      priority: null,
      freshness: 'fresh',
      user_tags: null,
      governance_review_status: null,
      metadata: null,
      content: null,
      brief: null,
      verified_at: null,
      verified_by: null,
    },
    {
      id: 'item-3',
      title: 'Item Three',
      suggested_title: null,
      summary: 'Summary three',
      primary_domain: 'Corporate',
      primary_subtopic: null,
      content_type: 'article',
      platform: 'web',
      author_name: null,
      source_domain: null,
      source_file: null,
      thumbnail_url: null,
      captured_date: '2026-01-17T10:00:00Z',
      ai_keywords: null,
      classification_confidence: 0.88,
      priority: null,
      freshness: 'fresh',
      user_tags: null,
      governance_review_status: null,
      metadata: null,
      content: null,
      brief: null,
      verified_at: '2026-03-21T12:00:00Z',
      verified_by: 'user-uuid-2',
    },
  ];

  return {
    mockUseDisplayNames: vi.fn<(...args: unknown[]) => Map<string, string>>(
      () =>
        new Map([
          ['user-uuid-1', 'Jane Smith'],
          ['user-uuid-2', 'Bob Jones'],
        ]),
    ),
    mockUseBrowseData: vi.fn(() => ({
      items: mockItems,
      totalCount: 3,
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      qualityFlaggedIds: new Set(),
      freshnessCounts: null,
      sentinelCallbackRef: vi.fn(),
      filters: {},
      activeFilterCount: 0,
      setFilters: vi.fn(),
      searchQuery: undefined,
      setSearchQuery: vi.fn(),
      clearFilters: vi.fn(),
      isSearchMode: false,
      searchError: null,
      updateItemLocally: vi.fn(),
      updateQualityFlag: vi.fn(),
    })),
    mockItems,
    mockContentGridProps: vi.fn<(...args: unknown[]) => unknown>(),
    mockContentListProps: vi.fn<(...args: unknown[]) => unknown>(),
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: mockUseDisplayNames,
}));

vi.mock('@/hooks/browse/use-browse-data', () => ({
  useBrowseData: mockUseBrowseData,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/browse',
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

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: 'editor',
    loading: false,
    canEdit: true,
    canAdmin: false,
  }),
}));

vi.mock('@/hooks/ui/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/hooks/ui/use-view-mode', () => ({
  useViewMode: () => ({ viewMode: 'grid', setViewMode: vi.fn() }),
}));

vi.mock('@/hooks/browse/use-filter-presets', () => ({
  useFilterPresets: () => ({
    presets: [],
    activePreset: null,
    applyPreset: vi.fn(),
    savePreset: vi.fn(),
    renamePreset: vi.fn(),
    deletePreset: vi.fn(),
    restorePreset: vi.fn(),
    canSave: false,
  }),
}));

vi.mock('@/hooks/use-quick-assign', () => ({
  useQuickAssign: () => ({
    activeWorkspaces: [],
    itemAssignments: new Map(),
    toggleAssignment: vi.fn(),
    loadAssignments: vi.fn(),
  }),
}));

vi.mock('@/lib/browse-helpers', () => ({
  getSortOptionFromFilters: () => 'captured_date_desc',
  getSortFiltersFromOption: () => ({}),
}));

// Mock child components to capture their props
vi.mock('@/components/content/content-grid', () => ({
  ContentGrid: (props: Record<string, unknown>) => {
    mockContentGridProps(props);
    return <div data-testid="content-grid" />;
  },
}));

vi.mock('@/components/content/content-list', () => ({
  ContentList: (props: Record<string, unknown>) => {
    mockContentListProps(props);
    return <div data-testid="content-list" />;
  },
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
  LoadingSkeleton: () => null,
  EmptyState: () => null,
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

vi.mock('@/lib/claude-prompts', () => ({
  generateIngestDocumentPrompt: () => ({ prompt: 'test' }),
}));

import { BrowseContent } from '@/app/browse/browse-content';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowseContent — Verification Names', () => {
  beforeEach(() => {
    mockContentGridProps.mockClear();
    mockContentListProps.mockClear();
    mockUseDisplayNames.mockClear();
  });

  it('calls useDisplayNames with verified_by UUIDs from items', () => {
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    // useDisplayNames should have been called with an array containing the verified_by UUIDs
    expect(mockUseDisplayNames).toHaveBeenCalled();
    const callArgs = mockUseDisplayNames.mock.calls[0][0] as string[];
    // Items 1 and 3 have verified_by; item 2 does not
    expect(callArgs).toContain('user-uuid-1');
    expect(callArgs).toContain('user-uuid-2');
    expect(callArgs).toHaveLength(2);
  });

  it('passes verifierNames map to ContentGrid', () => {
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    expect(mockContentGridProps).toHaveBeenCalled();
    const gridProps = mockContentGridProps.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const verifierNames = gridProps.verifierNames as Map<string, string>;
    expect(verifierNames).toBeInstanceOf(Map);
    expect(verifierNames.get('user-uuid-1')).toBe('Jane Smith');
    expect(verifierNames.get('user-uuid-2')).toBe('Bob Jones');
  });

  it('does not call useDisplayNames with empty array when no items are verified', () => {
    // Override to return items with no verified_by
    mockUseBrowseData.mockReturnValueOnce({
      items: [
        { ...mockItems[1] }, // item-2 has no verified_by
      ],
      totalCount: 1,
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      qualityFlaggedIds: new Set(),
      freshnessCounts: null,
      sentinelCallbackRef: vi.fn(),
      filters: {},
      activeFilterCount: 0,
      setFilters: vi.fn(),
      searchQuery: undefined,
      setSearchQuery: vi.fn(),
      clearFilters: vi.fn(),
      isSearchMode: false,
      searchError: null,
      updateItemLocally: vi.fn(),
      updateQualityFlag: vi.fn(),
    });

    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    expect(mockUseDisplayNames).toHaveBeenCalled();
    const callArgs = mockUseDisplayNames.mock.calls[0][0] as string[];
    expect(callArgs).toHaveLength(0);
  });
});
