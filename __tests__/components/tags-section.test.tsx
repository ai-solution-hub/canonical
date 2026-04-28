/**
 * TagsSection Component Tests
 *
 * Tests the tag management section — 2-tab layout (Clean up / Browse all),
 * inline summary, singleton action, tab switching, and CRUD regressions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockUserRole, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockUserRole: {
    role: 'admin' as string | null,
    loading: false,
    canEdit: true,
    canAdmin: true,
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole,
}));

// Stub sub-components to isolate TagsSection
vi.mock('@/components/settings/duplicate-review', () => ({
  DuplicateReview: (props: { duplicates: unknown[] }) => (
    <div data-testid="duplicate-review">
      DuplicateReview ({(props.duplicates as unknown[]).length} groups)
    </div>
  ),
}));

vi.mock('@/components/settings/tag-domain-view', () => ({
  TagDomainView: () => <div data-testid="tag-domain-view">TagDomainView</div>,
}));

vi.mock('@/components/settings/tag-bulk-actions', () => ({
  TagBulkActions: () => (
    <div data-testid="tag-bulk-actions">TagBulkActions</div>
  ),
}));

// Mock @tanstack/react-virtual to render all items (no virtual scrolling in tests)
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: i,
        size: 44,
        start: i * 44,
      })),
  }),
}));

import { TagsSection } from '@/components/settings/tags-section';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createTagData(
  count = 5,
): Array<{ tag: string; count: number; source: 'user' | 'ai' }> {
  return Array.from({ length: count }, (_, i) => ({
    tag: `tag-${i + 1}`,
    count: 10 - i * 2,
    source: (i % 2 === 0 ? 'user' : 'ai') as 'user' | 'ai',
  }));
}

function createDomainGroups() {
  return [
    {
      domain: 'Technology',
      tags: [
        { tag: 'javascript', count: 5 },
        { tag: 'react', count: 3 },
      ],
    },
    {
      domain: 'Science',
      tags: [{ tag: 'physics', count: 2 }],
    },
  ];
}

function setupFetchResponses(
  tags: unknown[] = createTagData(),
  duplicates: unknown[] = [],
  domainGroups: unknown[] = [],
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/tags/duplicates')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(duplicates),
      });
    }
    if (url.includes('/api/tags/by-domain')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(domainGroups),
      });
    }
    if (url.includes('/api/tags')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(tags) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRole.role = 'admin';
    mockUserRole.loading = false;
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = true;
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading spinner while data is being fetched', () => {
    mockUserRole.loading = true;
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    const spinners = document.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });

  // ─── AC5: Inline summary replaces separate stats tiles ───

  it('displays inline summary instead of separate stats tiles', async () => {
    const tags = createTagData(5);
    const domains = createDomainGroups();
    setupFetchResponses(tags, [], domains);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/5 tags across 2 domains/)).toBeInTheDocument();
    });

    // Old stats tiles should NOT exist
    expect(screen.queryByText('Total tags')).not.toBeInTheDocument();
    expect(screen.queryByText('Duplicate groups')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Singleton tags (hidden by default)'),
    ).not.toBeInTheDocument();
  });

  // ─── AC1: Two tabs — "Clean up" and "Browse all" ───

  it('renders exactly two tabs: "Clean up" and "Browse all"', async () => {
    setupFetchResponses();

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /clean up/i }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole('tab', { name: /browse all/i }),
    ).toBeInTheDocument();

    // Old tabs should NOT exist
    expect(
      screen.queryByRole('tab', { name: /^duplicates$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: /by domain/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: /all tags/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: /bulk actions/i }),
    ).not.toBeInTheDocument();
  });

  // ─── AC1: Clean up tab merges duplicates + domain view + bulk actions ───

  it('shows duplicates, domain view, and bulk actions within Clean up tab', async () => {
    const tags = createTagData(3);
    const dupes = [
      {
        canonical: 'test',
        variants: ['Test'],
        variant_count: 1,
        total_usage: 5,
      },
    ];
    setupFetchResponses(tags, dupes, createDomainGroups());

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /clean up/i }),
      ).toBeInTheDocument();
    });

    // Clean up tab should be active by default when duplicates exist
    expect(screen.getByTestId('duplicate-review')).toBeInTheDocument();
    expect(screen.getByTestId('tag-domain-view')).toBeInTheDocument();
    expect(screen.getByTestId('tag-bulk-actions')).toBeInTheDocument();
  });

  // ─── AC2: Tab switching preserves bulk-action scope ───

  it('switching to Browse all and back preserves Clean up content', async () => {
    const user = userEvent.setup();
    const tags = createTagData(3);
    const dupes = [
      {
        canonical: 'test',
        variants: ['Test'],
        variant_count: 1,
        total_usage: 5,
      },
    ];
    setupFetchResponses(tags, dupes, createDomainGroups());

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /clean up/i }),
      ).toBeInTheDocument();
    });

    // Switch to Browse all
    await user.click(screen.getByRole('tab', { name: /browse all/i }));

    await waitFor(() => {
      // Browse all content should show tag list
      expect(screen.getByLabelText('Search tags')).toBeInTheDocument();
    });

    // Switch back to Clean up
    await user.click(screen.getByRole('tab', { name: /clean up/i }));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-review')).toBeInTheDocument();
      expect(screen.getByTestId('tag-bulk-actions')).toBeInTheDocument();
    });
  });

  // ─── AC1: Browse all shows virtual-scrolled tag list ───

  it('shows tag list with virtual scroll in Browse all tab', async () => {
    const user = userEvent.setup();
    const tags = createTagData(3);
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /browse all/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /browse all/i }));

    await waitFor(() => {
      // Tags with count > 1 visible (singletons hidden by default)
      expect(screen.getByText('tag-1')).toBeInTheDocument();
      expect(screen.getByText('tag-2')).toBeInTheDocument();
    });
  });

  // ─── AC6: Singletons counter wired to action ───

  it('provides a delete singletons action from the Browse all tab', async () => {
    const user = userEvent.setup();
    // Include a tag with count=1 (singleton)
    const tags = [
      { tag: 'common-tag', count: 5, source: 'ai' as const },
      { tag: 'singleton-tag', count: 1, source: 'ai' as const },
    ];
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /browse all/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /browse all/i }));

    await waitFor(() => {
      expect(screen.getByText('common-tag')).toBeInTheDocument();
    });

    // Should have a button to delete singletons (not just informational)
    const deleteBtn = screen.getByRole('button', {
      name: /delete.*singleton/i,
    });
    expect(deleteBtn).toBeInTheDocument();
  });

  // ─── AC8c: CRUD regression — rename ───

  it('opens rename dialog when rename button is clicked in Browse all', async () => {
    const user = userEvent.setup();
    const tags = createTagData(3);
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /browse all/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /browse all/i }));

    await waitFor(() => {
      expect(screen.getByText('tag-1')).toBeInTheDocument();
    });

    const renameButton = screen.getByLabelText('Rename tag: tag-1');
    await user.click(renameButton);

    await waitFor(() => {
      expect(screen.getByText('Rename Tag')).toBeInTheDocument();
    });
  });

  // ─── AC8c: CRUD regression — merge ───

  it('opens merge dialog when merge button is clicked in Browse all', async () => {
    const user = userEvent.setup();
    const tags = createTagData(3);
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /browse all/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /browse all/i }));

    await waitFor(() => {
      expect(screen.getByText('tag-1')).toBeInTheDocument();
    });

    const mergeButton = screen.getByLabelText('Merge tag: tag-1');
    await user.click(mergeButton);

    await waitFor(() => {
      expect(screen.getByText('Merge Tag')).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText('Target tag name...'),
      ).toBeInTheDocument();
    });
  });

  // ─── AC8c: CRUD regression — delete ───

  it('opens delete dialog when delete button is clicked in Browse all', async () => {
    const user = userEvent.setup();
    const tags = createTagData(3);
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /browse all/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /browse all/i }));

    await waitFor(() => {
      expect(screen.getByText('tag-1')).toBeInTheDocument();
    });

    const deleteButton = screen.getByLabelText('Delete tag: tag-1');
    await user.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Delete Tag')).toBeInTheDocument();
    });
  });

  // ─── AC4: No overlap with entity-management ───

  it('does not render any entity-management components', async () => {
    setupFetchResponses();

    const { Wrapper } = createQueryWrapper();
    const { container } = render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /clean up/i }),
      ).toBeInTheDocument();
    });

    // No entity-management data-testids or content
    expect(
      container.querySelector('[data-testid*="entity"]'),
    ).not.toBeInTheDocument();
  });

  // ─── Default tab selection ───

  it('defaults to Clean up tab when duplicates exist', async () => {
    const dupes = [
      {
        canonical: 'test',
        variants: ['Test'],
        variant_count: 1,
        total_usage: 5,
      },
    ];
    setupFetchResponses(createTagData(), dupes);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-review')).toBeInTheDocument();
    });
  });

  it('defaults to Browse all tab when no duplicates exist', async () => {
    setupFetchResponses(createTagData(3), []);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      // Should show tag list (Browse all content)
      expect(screen.getByLabelText('Search tags')).toBeInTheDocument();
    });
  });
});
