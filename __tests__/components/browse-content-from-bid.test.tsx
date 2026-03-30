/**
 * BrowseContent from_bid URL Parameter Tests
 *
 * Tests that ?from_bid=<workspaceId> URL param is parsed and passed
 * through to ContentGrid/ContentList as fromBidId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() factories
// ---------------------------------------------------------------------------

const mockSearchParams = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));

const mockBrowseData = vi.hoisted(() => ({
  items: [{ id: 'item-1' }, { id: 'item-2' }] as Array<{ id: string }>,
  totalCount: 2 as number | null,
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
  activeWorkspaces: [
    { id: 'ws-1', name: 'Bid Alpha', color: '#ff0000', deadline: '2026-04-15' },
    { id: 'ws-2', name: 'Bid Beta', color: '#00ff00', deadline: null },
  ],
  itemAssignments: new Map<string, Set<string>>(),
  toggleAssignment: vi.fn(),
  loadAssignments: vi.fn(),
}));

const capturedGridProps = vi.hoisted(() => ({
  fromBidId: undefined as string | undefined,
}));

const capturedListProps = vi.hoisted(() => ({
  fromBidId: undefined as string | undefined,
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mockSearchParams.current,
  usePathname: () => '/browse',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => function DynamicComponent() { return null; },
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
  useViewMode: () => ({ viewMode: 'grid', setViewMode: vi.fn() }),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ canEdit: true, role: 'editor' }),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: () => new Map(),
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

// Capture props passed to ContentGrid/ContentList
vi.mock('@/components/content/content-grid', () => ({
  ContentGrid: (props: Record<string, unknown>) => {
    capturedGridProps.fromBidId = props.fromBidId as string | undefined;
    return <div data-testid="content-grid" data-from-bid-id={props.fromBidId ?? ''} />;
  },
}));

vi.mock('@/components/content/content-list', () => ({
  ContentList: (props: Record<string, unknown>) => {
    capturedListProps.fromBidId = props.fromBidId as string | undefined;
    return <div data-testid="content-list" data-from-bid-id={props.fromBidId ?? ''} />;
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

describe('BrowseContent — from_bid URL parameter', () => {
  beforeEach(() => {
    mockSearchParams.current = new URLSearchParams();
    mockBrowseData.items = [{ id: 'item-1' }, { id: 'item-2' }] as Array<{ id: string }>;
    mockBrowseData.totalCount = 2;
    mockBrowseData.isLoading = false;
    mockBrowseData.isSearchMode = false;
    capturedGridProps.fromBidId = undefined;
    capturedListProps.fromBidId = undefined;
  });

  it('passes fromBidId to ContentGrid when ?from_bid is present', () => {
    mockSearchParams.current = new URLSearchParams('from_bid=ws-1');

    render(<BrowseContent />);

    const grid = screen.getByTestId('content-grid');
    expect(grid).toHaveAttribute('data-from-bid-id', 'ws-1');
    expect(capturedGridProps.fromBidId).toBe('ws-1');
  });

  it('does not pass fromBidId when ?from_bid is absent', () => {
    mockSearchParams.current = new URLSearchParams();

    render(<BrowseContent />);

    const grid = screen.getByTestId('content-grid');
    expect(grid).toHaveAttribute('data-from-bid-id', '');
    expect(capturedGridProps.fromBidId).toBeUndefined();
  });

  it('handles from_bid with other URL params without conflict', () => {
    mockSearchParams.current = new URLSearchParams('from_bid=ws-2&domain=security');

    render(<BrowseContent />);

    const grid = screen.getByTestId('content-grid');
    expect(grid).toHaveAttribute('data-from-bid-id', 'ws-2');
    expect(capturedGridProps.fromBidId).toBe('ws-2');
  });
});
