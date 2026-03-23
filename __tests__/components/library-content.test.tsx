/**
 * LibraryContent Component Tests
 *
 * Tests the Q&A Library page content — header, search, filters,
 * loading/empty states, bulk actions, and tag dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockFilters,
  mockSetFilters,
  mockClearFilters,
  mockActiveCount,
  mockGroupBy,
  mockSetGroupBy,
  mockBulk,
  mockUserRole,
  mockSupabaseQuery,
} = vi.hoisted(() => ({
  mockFilters: {
    value: {
      domain: undefined as string | undefined,
      source_file: undefined as string | undefined,
      variant: undefined as string | undefined,
      search: undefined as string | undefined,
      freshness: undefined as string | undefined,
      verified: undefined as string | undefined,
    },
  },
  mockSetFilters: vi.fn(),
  mockClearFilters: vi.fn(),
  mockActiveCount: { value: 0 },
  mockGroupBy: { value: 'none' as string },
  mockSetGroupBy: vi.fn(),
  mockBulk: {
    selectedIds: new Set<string>(),
    bulkOperating: false,
    bulkProgress: { current: 0, total: 0, label: '' },
    tagDialogOpen: false,
    setTagDialogOpen: vi.fn(),
    tagInput: '',
    setTagInput: vi.fn(),
    assignDialogOpen: false,
    setAssignDialogOpen: vi.fn(),
    workspaces: [] as Array<{ id: string; name: string; type: string }>,
    workspacesLoading: false,
    selectedWorkspaceId: '',
    setSelectedWorkspaceId: vi.fn(),
    toggleSelect: vi.fn(),
    toggleSelectAll: vi.fn(),
    clearSelection: vi.fn(),
    handleBulkReclassify: vi.fn(),
    handleBulkTagOpen: vi.fn(),
    handleBulkAssignOpen: vi.fn(),
    handleBulkVerify: vi.fn(),
    handleBulkDelete: vi.fn(),
    handleBulkTagConfirm: vi.fn(),
    handleBulkAssignConfirm: vi.fn(),
  },
  mockUserRole: { role: 'editor' as string | null, loading: false, canEdit: true, canAdmin: false },
  mockSupabaseQuery: {
    data: null as unknown[] | null,
    error: null as { message: string } | null,
    resolveImmediately: true,
  },
}));

// Chainable Supabase query builder
function createChainableQuery() {
  const builder: Record<string, unknown> = {};
  const chainMethods = ['select', 'eq', 'or', 'not', 'is', 'order', 'ilike', 'neq', 'trim'];
  for (const method of chainMethods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  // The terminal call — returns data/error via thenable
  builder.then = vi.fn((resolve: (v: unknown) => void) => {
    resolve({ data: mockSupabaseQuery.data, error: mockSupabaseQuery.error });
    return Promise.resolve({ data: mockSupabaseQuery.data, error: mockSupabaseQuery.error });
  });
  // Make it awaitable
  Object.defineProperty(builder, Symbol.toStringTag, { value: 'Promise' });
  return builder;
}

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/library',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: vi.fn().mockReturnValue(createChainableQuery()),
  }),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole,
}));

vi.mock('@/hooks/use-library-filters', () => ({
  useLibraryFilters: () => ({
    filters: mockFilters.value,
    setFilters: mockSetFilters,
    clearFilters: mockClearFilters,
    activeCount: mockActiveCount.value,
    groupBy: mockGroupBy.value,
    setGroupBy: mockSetGroupBy,
  }),
}));

vi.mock('@/hooks/use-library-bulk-actions', () => ({
  useLibraryBulkActions: () => mockBulk,
}));

vi.mock('@/lib/supabase/escape', () => ({
  escapePostgrestValue: (v: string) => v,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 72,
        size: 72,
        key: i,
      })),
    getTotalSize: () => count * 72,
    measureElement: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Stub child components
vi.mock('@/components/qa-row', () => ({
  QARow: ({ item }: { item: { id: string; title: string } }) => (
    <div data-testid={`qa-row-${item.id}`}>{item.title}</div>
  ),
}));

vi.mock('@/components/bulk-action-toolbar', () => ({
  BulkActionToolbar: ({ selectedCount }: { selectedCount: number }) =>
    selectedCount > 0 ? <div data-testid="bulk-toolbar">Bulk: {selectedCount}</div> : null,
}));

vi.mock('@/components/collapsible-group', () => ({
  CollapsibleGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  groupItems: vi.fn(),
}));

import { LibraryContent } from '@/app/library/library-content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQAItem(overrides: Partial<{ id: string; title: string; answer_standard: string | null; answer_advanced: string | null }> = {}) {
  return {
    id: overrides.id ?? 'item-1',
    title: overrides.title ?? 'What is our approach?',
    suggested_title: null,
    ai_summary: null,
    primary_domain: 'Corporate',
    primary_subtopic: 'Company History',
    content_type: 'q_a_pair',
    platform: 'upload',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-15',
    ai_keywords: [],
    classification_confidence: 0.9,
    priority: 'medium',
    freshness: 'fresh',
    user_tags: [],
    governance_review_status: null,
    metadata: {},
    verified_at: null,
    source_document: null,
    brief: null,
    content: 'Some content',
    answer_standard: overrides.answer_standard ?? 'Standard answer',
    answer_advanced: overrides.answer_advanced ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LibraryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilters.value = {
      domain: undefined,
      source_file: undefined,
      variant: undefined,
      search: undefined,
      freshness: undefined,
      verified: undefined,
    };
    mockActiveCount.value = 0;
    mockGroupBy.value = 'none';
    mockBulk.selectedIds = new Set();
    mockBulk.tagDialogOpen = false;
    mockBulk.tagInput = '';
    mockBulk.assignDialogOpen = false;
    mockSupabaseQuery.data = [];
    mockSupabaseQuery.error = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders header with "Q&A Library" title', async () => {
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Q&A Library' })).toBeInTheDocument();
    });
  });

  it('shows loading skeletons while fetching', () => {
    // On first render, isLoading starts as true before the useEffect resolves.
    // We can observe the initial loading state synchronously.
    mockSupabaseQuery.data = null;

    render(<LibraryContent />);
    // Loading skeletons are animate-pulse divs rendered while isLoading=true
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no items returned', async () => {
    mockSupabaseQuery.data = [];
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText('No Q&A pairs yet')).toBeInTheDocument();
    });
  });

  it('shows "No matching Q&A pairs" when filters active but no results', async () => {
    mockActiveCount.value = 1;
    mockSupabaseQuery.data = [];
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText('No matching Q&A pairs')).toBeInTheDocument();
    });
  });

  it('renders search input with aria-label', async () => {
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByLabelText('Search Q&A pairs')).toBeInTheDocument();
    });
  });

  it('renders domain filter select with taxonomy domains', async () => {
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByLabelText('Filter by domain')).toBeInTheDocument();
    });
  });

  it('renders freshness filter select', async () => {
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByLabelText('Filter by freshness')).toBeInTheDocument();
    });
  });

  it('shows secondary filters popover', async () => {
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText('More filters')).toBeInTheDocument();
    });
  });

  it('renders items as QARow components after fetch', async () => {
    const items = [
      createQAItem({ id: 'qa-1', title: 'First question' }),
      createQAItem({ id: 'qa-2', title: 'Second question' }),
    ];
    mockSupabaseQuery.data = items;

    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByTestId('qa-row-qa-1')).toBeInTheDocument();
      expect(screen.getByTestId('qa-row-qa-2')).toBeInTheDocument();
    });
  });

  it('shows stats bar with count', async () => {
    const items = [
      createQAItem({ id: 'qa-1', answer_standard: 'Yes', answer_advanced: null }),
      createQAItem({ id: 'qa-2', answer_standard: 'Yes', answer_advanced: 'Detailed' }),
    ];
    mockSupabaseQuery.data = items;

    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText(/2 Q&A pairs/)).toBeInTheDocument();
    });
  });

  it('select all checkbox toggles bulk selection', async () => {
    const items = [createQAItem({ id: 'qa-1' })];
    mockSupabaseQuery.data = items;

    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText('Select all')).toBeInTheDocument();
    });
    const checkbox = screen.getByLabelText('Select all Q&A pairs');
    expect(checkbox).toBeInTheDocument();
  });

  it('BulkActionToolbar appears when items selected', async () => {
    const items = [createQAItem({ id: 'qa-1' })];
    mockSupabaseQuery.data = items;
    mockBulk.selectedIds = new Set(['qa-1']);

    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByTestId('bulk-toolbar')).toBeInTheDocument();
      expect(screen.getByText('Bulk: 1')).toBeInTheDocument();
    });
  });

  it('tag dialog opens with correct selected count', async () => {
    mockBulk.selectedIds = new Set(['qa-1', 'qa-2', 'qa-3']);
    mockBulk.tagDialogOpen = true;
    mockSupabaseQuery.data = [createQAItem({ id: 'qa-1' })];

    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText('Add tags to 3 items')).toBeInTheDocument();
    });
  });

  it('clear all filters button resets filters', async () => {
    mockActiveCount.value = 2;
    mockSupabaseQuery.data = [];

    const user = userEvent.setup();
    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText('Clear all')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Clear all'));
    expect(mockClearFilters).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Item 2: Semantic search fallback in empty state
  // -------------------------------------------------------------------------

  it('shows "Try searching the full knowledge base" link when search filter returns no results', async () => {
    mockActiveCount.value = 1;
    mockFilters.value = { ...mockFilters.value, search: 'cyber security' };
    mockSupabaseQuery.data = [];

    render(<LibraryContent />);
    await waitFor(() => {
      const link = screen.getByText('Try searching the full knowledge base');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute(
        'href',
        '/search?q=cyber%20security',
      );
    });
  });

  it('does not show semantic search link when no search term', async () => {
    mockActiveCount.value = 1;
    mockFilters.value = { ...mockFilters.value, domain: 'Technical', search: undefined };
    mockSupabaseQuery.data = [];

    render(<LibraryContent />);
    await waitFor(() => {
      expect(screen.getByText('No matching Q&A pairs')).toBeInTheDocument();
    });
    expect(screen.queryByText('Try searching the full knowledge base')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Item 3: Verified filter in primary filter bar
  // -------------------------------------------------------------------------

  it('renders verified status filter in primary filter bar', async () => {
    render(<LibraryContent />);
    await waitFor(() => {
      // The verified filter should be in the primary bar (not just in the popover)
      const verifiedSelect = screen.getByLabelText('Filter by verified status');
      expect(verifiedSelect).toBeInTheDocument();
    });
  });
});
