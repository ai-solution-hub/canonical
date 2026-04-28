/**
 * P1-2: Browse Header Consolidation Tests
 *
 * Tests the consolidated browse header:
 * 1. + New split-button menu renders all 5 items
 * 2. Upload button removed from header (no standalone upload button)
 * 3. Display dropdown consolidates view + unread + overflow
 * 4. Keyboard shortcuts still resolve after reshape
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '../../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRouter, mockSearchParams, mockUserRole } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockSearchParams: { value: new URLSearchParams() },
  mockUserRole: {
    role: 'editor' as string | null,
    loading: false,
    canEdit: true,
    canAdmin: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/browse',
  useSearchParams: () => mockSearchParams.value,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole,
}));

// Stub heavy dependencies to isolate header logic
vi.mock('@/hooks/browse/use-browse-data', () => ({
  useBrowseData: () => ({
    items: [],
    totalCount: 0,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    qualityFlaggedIds: new Set(),
    freshnessCounts: null,
    sentinelCallbackRef: vi.fn(),
    filters: { sort: 'captured_date', order: 'desc' },
    activeFilterCount: 0,
    setFilters: vi.fn(),
    searchQuery: undefined,
    setSearchQuery: vi.fn(),
    clearSearchQuery: vi.fn(),
    clearFilters: vi.fn(),
    isSearchMode: false,
    searchError: null,
    updateItemLocally: vi.fn(),
    updateQualityFlag: vi.fn(),
    refreshData: vi.fn(),
  }),
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
    isLoaded: false,
    loadReadMarks: vi.fn(),
    checkReadStatus: vi.fn(),
  }),
}));

vi.mock('@/components/browse/filter-panel', () => ({
  FilterPanel: () => null,
}));

vi.mock('@/components/browse/filter-badges', () => ({
  FilterBadges: () => null,
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
  ClaudePromptButton: ({ label }: { label: string }) => (
    <button data-testid="claude-prompt-button">{label}</button>
  ),
}));

vi.mock('@/lib/claude-prompts', () => ({
  generateIngestDocumentPrompt: () => ({ prompt: 'test prompt' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Import AFTER mocks
import { BrowseContent } from '@/app/browse/browse-content';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('P1-2: Browse Header Consolidation', () => {
  beforeEach(() => {
    mockUserRole.role = 'editor';
    mockUserRole.canEdit = true;
    mockUserRole.loading = false;
    mockRouter.push.mockClear();
  });

  // ── 1. + New split-button menu ──

  it('renders the + New menu trigger for editors', () => {
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });
    expect(screen.getByTestId('new-content-menu')).toBeInTheDocument();
    expect(screen.getByTestId('new-content-menu')).toHaveTextContent('New');
  });

  it('+ New menu renders all 5 items when opened', async () => {
    const user = userEvent.setup();
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    await user.click(screen.getByTestId('new-content-menu'));

    expect(screen.getByText('Write content')).toBeInTheDocument();
    expect(screen.getByText('Import URL')).toBeInTheDocument();
    expect(screen.getByText('Upload file')).toBeInTheDocument();
    // Batch Q&A uses HTML entity &amp; in JSX, renders as "Batch Q&A"
    expect(screen.getByText(/Batch Q/)).toBeInTheDocument();
    expect(screen.getByTestId('claude-prompt-button')).toBeInTheDocument();
  });

  it('+ New menu items link to correct paths', async () => {
    const user = userEvent.setup();
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    await user.click(screen.getByTestId('new-content-menu'));

    const writeLink = screen.getByText('Write content').closest('a');
    expect(writeLink).toHaveAttribute('href', '/item/new');

    const urlLink = screen.getByText('Import URL').closest('a');
    expect(urlLink).toHaveAttribute('href', '/item/new?tab=url');

    const uploadLink = screen.getByText('Upload file').closest('a');
    expect(uploadLink).toHaveAttribute('href', '/item/new?tab=upload');

    const batchLink = screen.getByText(/Batch Q/).closest('a');
    expect(batchLink).toHaveAttribute('href', '/item/new?tab=batch');
  });

  it('does not render + New menu for viewers', () => {
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });
    expect(screen.queryByTestId('new-content-menu')).not.toBeInTheDocument();
  });

  // ── 2. Upload button removed from header ──

  it('does not render a standalone Upload button in the header', () => {
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });
    // The old header had a visible "Upload" button next to "New Content"
    // Now it should only be inside the dropdown
    const buttons = screen.getAllByRole('button');
    const uploadButtons = buttons.filter(
      (b) =>
        b.textContent === 'Upload' &&
        !b.closest('[role="menu"]') &&
        !b.closest('[data-testid="new-content-menu"]'),
    );
    expect(uploadButtons).toHaveLength(0);
  });

  // ── 3. Display dropdown ──

  it('renders the Display dropdown trigger', () => {
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });
    expect(screen.getByTestId('display-menu')).toBeInTheDocument();
  });

  it('Display dropdown consolidates view, unread, and multi-select controls', async () => {
    const user = userEvent.setup();
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    await user.click(screen.getByTestId('display-menu'));

    // View mode options
    expect(screen.getByText('Grid view')).toBeInTheDocument();
    expect(screen.getByText('List view')).toBeInTheDocument();
    // Unread toggle
    expect(screen.getByText('Show unread only')).toBeInTheDocument();
    // Multi-select
    expect(screen.getByText('Select items')).toBeInTheDocument();
  });

  // ── 4. Keyboard shortcuts still resolve ──

  it('/ shortcut focuses the browse search input', async () => {
    const user = userEvent.setup();
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    const searchInput = screen.getByLabelText('Search the knowledge base');
    expect(searchInput).not.toHaveFocus();

    await user.keyboard('/');
    expect(searchInput).toHaveFocus();
  });

  it('Shift+R navigates to /review', async () => {
    const user = userEvent.setup();
    render(<BrowseContent />, { wrapper: createQueryWrapper().Wrapper });

    await user.keyboard('{Shift>}R{/Shift}');
    expect(mockRouter.push).toHaveBeenCalledWith('/review');
  });
});
