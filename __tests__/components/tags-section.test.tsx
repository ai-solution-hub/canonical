/**
 * TagsSection Component Tests
 *
 * Tests the tag management section — loading state, summary stats,
 * tab switching, tag list rendering, and merge dialog.
 *
 * Uses TanStack Query wrapper for data fetching via useTagsData hook.
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
  mockUserRole: { role: 'admin' as string | null, loading: false, canEdit: true, canAdmin: true },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
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
  DuplicateReview: () => <div data-testid="duplicate-review">DuplicateReview</div>,
}));

vi.mock('@/components/settings/tag-domain-view', () => ({
  TagDomainView: () => <div data-testid="tag-domain-view">TagDomainView</div>,
}));

vi.mock('@/components/settings/tag-bulk-actions', () => ({
  TagBulkActions: () => <div data-testid="tag-bulk-actions">TagBulkActions</div>,
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

function createTagData(count = 5): Array<{ tag: string; count: number; source: 'user' | 'ai' }> {
  return Array.from({ length: count }, (_, i) => ({
    tag: `tag-${i + 1}`,
    count: 10 - i * 2,
    source: (i % 2 === 0 ? 'user' : 'ai') as 'user' | 'ai',
  }));
}

function setupFetchResponses(
  tags: unknown[] = createTagData(),
  duplicates: unknown[] = [],
  domainGroups: unknown[] = [],
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/tags/duplicates')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(duplicates) });
    }
    if (url.includes('/api/tags/by-domain')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(domainGroups) });
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

    // The component returns a spinner when loading or roleLoading
    const spinners = document.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('displays summary stats after loading', async () => {
    const tags = createTagData(5);
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Tag Health')).toBeInTheDocument();
    });

    // Total tags count
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Total tags')).toBeInTheDocument();
  });

  it('renders tab triggers for navigation between views', async () => {
    setupFetchResponses();

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Tag Health')).toBeInTheDocument();
    });

    expect(screen.getByRole('tab', { name: /duplicates/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /by domain/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /all tags/i })).toBeInTheDocument();
    // Admin sees bulk actions tab
    expect(screen.getByRole('tab', { name: /bulk actions/i })).toBeInTheDocument();
  });

  it('shows tag list with tag names and counts in All Tags tab', async () => {
    const user = userEvent.setup();
    const tags = createTagData(3);
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Tag Health')).toBeInTheDocument();
    });

    // Switch to All Tags tab
    await user.click(screen.getByRole('tab', { name: /all tags/i }));

    await waitFor(() => {
      // Tags with count > 1 should be visible (singletons hidden by default)
      // tag-1 has count 10, tag-2 has count 8, tag-3 has count 6
      expect(screen.getByText('tag-1')).toBeInTheDocument();
      expect(screen.getByText('tag-2')).toBeInTheDocument();
    });
  });

  it('opens merge dialog when merge button is clicked', async () => {
    const user = userEvent.setup();
    const tags = createTagData(3);
    setupFetchResponses(tags);

    const { Wrapper } = createQueryWrapper();
    render(<TagsSection />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Tag Health')).toBeInTheDocument();
    });

    // Switch to All Tags tab
    await user.click(screen.getByRole('tab', { name: /all tags/i }));

    await waitFor(() => {
      expect(screen.getByText('tag-1')).toBeInTheDocument();
    });

    // Click merge button for first tag
    const mergeButton = screen.getByLabelText('Merge tag: tag-1');
    await user.click(mergeButton);

    // Merge dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Merge Tag')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Target tag name...')).toBeInTheDocument();
  });
});
