import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '../helpers/query-wrapper';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock the taxonomy context used by DomainBadge
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainColourKey: (domain: string) => domain.toLowerCase(),
    formatDomainName: (domain: string) =>
      domain
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase()),
  }),
}));

import { SearchBar } from '@/components/browse/search-bar';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Render SearchBar wrapped in a fresh QueryClientProvider. SearchBar calls
 * `useDebouncedPreview` which uses TanStack Query, so the provider is
 * required. Delegates to the canonical `createQueryWrapper` helper.
 */
function renderSearchBar(props: Parameters<typeof SearchBar>[0] = {}) {
  const { Wrapper } = createQueryWrapper();
  return render(<SearchBar {...props} />, { wrapper: Wrapper });
}

/** Mock preview API response shape. */
function createPreviewResponse(
  results: Array<{
    id: string;
    title: string;
    content_type: string;
    primary_domain: string | null;
  }>,
) {
  return new Response(JSON.stringify({ results, count: results.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default: suggestions returns empty, preview returns empty
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/search/suggestions')) {
        return new Response(JSON.stringify({ keywords: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/search/preview')) {
        return createPreviewResponse([]);
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with default placeholder', () => {
    renderSearchBar();
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('shows full placeholder for hero variant', () => {
    renderSearchBar({ variant: 'hero' });
    expect(
      screen.getByPlaceholderText('Search your knowledge base...'),
    ).toBeInTheDocument();
  });

  it('renders with default value', () => {
    renderSearchBar({ defaultValue: 'test query' });
    expect(screen.getByDisplayValue('test query')).toBeInTheDocument();
  });

  it('navigates to search page on form submit', async () => {
    const user = userEvent.setup();
    renderSearchBar();
    const input = screen.getByRole('combobox');
    await user.type(input, 'knowledge base');
    await user.keyboard('{Enter}');
    expect(mockPush).toHaveBeenCalledWith('/search?q=knowledge%20base');
  });

  it('does not navigate on empty query submit', async () => {
    const user = userEvent.setup();
    renderSearchBar();
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('remembers a submitted query as a recent search', async () => {
    const user = userEvent.setup();
    renderSearchBar();
    const input = screen.getByRole('combobox');
    await user.type(input, 'my search');
    await user.keyboard('{Enter}');
    const stored = JSON.parse(
      localStorage.getItem('kb-recent-searches') ?? '[]',
    );
    expect(stored).toContain('my search');
  });

  it('has combobox role for accessibility', () => {
    renderSearchBar();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('has search form role', () => {
    renderSearchBar();
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('renders hero variant with larger input', () => {
    renderSearchBar({ variant: 'hero' });
    const input = screen.getByRole('combobox');
    expect(input.className).toContain('h-12');
  });

  it('renders compact variant by default', () => {
    renderSearchBar();
    const input = screen.getByRole('combobox');
    expect(input.className).toContain('h-9');
  });

  it('trims whitespace from search queries', async () => {
    const user = userEvent.setup();
    renderSearchBar();
    const input = screen.getByRole('combobox');
    await user.type(input, '  trimmed search  ');
    await user.keyboard('{Enter}');
    expect(mockPush).toHaveBeenCalledWith('/search?q=trimmed%20search');
  });

  // ---------------------------------------------------------------------------
  // Inline variant tests (P1-30 Phase 1)
  // ---------------------------------------------------------------------------
  describe('inline variant', () => {
    it('renders with inline placeholder', () => {
      renderSearchBar({ variant: 'inline' });
      expect(
        screen.getByPlaceholderText('Search your knowledge...'),
      ).toBeInTheDocument();
    });

    it('renders inline input with correct height class', () => {
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      expect(input.className).toContain('h-10');
    });

    it('does not show keyboard shortcut badge', () => {
      renderSearchBar({ variant: 'inline' });
      // Compact variant shows Cmd+K / Ctrl+K badge — inline should not
      const kbd = document.querySelector('kbd');
      expect(kbd).toBeNull();
    });

    it('calls onSearch on submit instead of navigating', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline', onSearch });
      const input = screen.getByRole('combobox');
      await user.type(input, 'test query');
      await user.keyboard('{Enter}');
      expect(onSearch).toHaveBeenCalledWith('test query');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('clears the inline search when an empty form is submitted', async () => {
      const onClear = vi.fn();
      const onSearch = vi.fn();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline', onSearch, onClear });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.keyboard('{Enter}');
      expect(onClear).toHaveBeenCalled();
      expect(onSearch).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not navigate on submit', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline', onSearch });
      const input = screen.getByRole('combobox');
      await user.type(input, 'some query');
      await user.keyboard('{Enter}');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('exposes the underlying input element through inputRef', () => {
      const ref = { current: null } as React.RefObject<HTMLInputElement | null>;
      renderSearchBar({ variant: 'inline', inputRef: ref });
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('renders with defaultValue', () => {
      renderSearchBar({ variant: 'inline', defaultValue: 'initial search' });
      expect(screen.getByDisplayValue('initial search')).toBeInTheDocument();
    });

    it('has search form role with search content label', () => {
      renderSearchBar({ variant: 'inline' });
      const form = screen.getByRole('search');
      expect(form).toHaveAttribute('aria-label', 'Search content');
    });

    it('has combobox role for accessibility', () => {
      renderSearchBar({ variant: 'inline' });
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('remembers a submitted inline query as a recent search', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline', onSearch });
      const input = screen.getByRole('combobox');
      await user.type(input, 'inline search');
      await user.keyboard('{Enter}');
      const stored = JSON.parse(
        localStorage.getItem('kb-recent-searches') ?? '[]',
      );
      expect(stored).toContain('inline search');
    });

    it('trims whitespace from inline search queries', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline', onSearch });
      const input = screen.getByRole('combobox');
      await user.type(input, '  trimmed inline  ');
      await user.keyboard('{Enter}');
      expect(onSearch).toHaveBeenCalledWith('trimmed inline');
    });
  });

  // ---------------------------------------------------------------------------
  // Compact variant suggestion parity (SD-9)
  // ---------------------------------------------------------------------------
  describe('compact variant suggestion parity', () => {
    it('calls loadSuggestions on focus (parity with hero)', async () => {
      // Both hero and compact should call loadSuggestions on focus.
      // We verify this by checking that fetch is called when focusing compact.
      const user = userEvent.setup();
      renderSearchBar({ variant: 'compact' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      // loadSuggestions should have been triggered by focus
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/search/suggestions');
    });
  });

  // ---------------------------------------------------------------------------
  // Preview dropdown tests (P1-30 Phase 3)
  // ---------------------------------------------------------------------------
  describe('preview dropdown (inline variant)', () => {
    // Real `/api/search/preview` grain (ID-135.23): the route merges three
    // record kinds behind `content_type` — q_a_pair, source_document,
    // reference_item — each with its own live detail route. Fixtures use
    // the real content_types (not the pre-refactor 'article'/'policy'
    // taxonomy) so the per-kind destination mapping is exercised for real.
    const MOCK_PREVIEW_RESULTS = [
      {
        id: 'item-001',
        title: 'Risk Assessment Guide',
        content_type: 'q_a_pair',
        primary_domain: 'Corporate',
      },
      {
        id: 'item-002',
        title: 'Risk Management Policy',
        content_type: 'source_document',
        primary_domain: 'Technical',
      },
    ];

    function mockPreviewFetch(results = MOCK_PREVIEW_RESULTS) {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/search/suggestions')) {
          return new Response(
            JSON.stringify({ keywords: ['topic1', 'topic2'] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('/api/search/preview')) {
          return createPreviewResponse(results);
        }
        return new Response('{}', { status: 200 });
      });
    }

    it('only renders preview section in inline variant', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'hero' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      // Wait for any async updates
      await act(async () => {});
      // Preview region should NOT exist for hero variant
      expect(screen.queryByTestId('preview-results-region')).toBeNull();
    });

    it('does not show preview when query is below PREVIEW_MIN_QUERY_LENGTH', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      // Type only 2 characters (below threshold of 3)
      await user.type(input, 'ri');
      await act(async () => {});
      // Preview region should not exist
      expect(screen.queryByTestId('preview-results-region')).toBeNull();
      // Popular topics should still be visible (suggestions loaded on focus)
      await waitFor(() => {
        expect(screen.queryByText('Popular topics')).toBeInTheDocument();
      });
    });

    it('shows preview when query meets PREVIEW_MIN_QUERY_LENGTH and hides popular topics', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      // Type exactly 3 characters (meets threshold)
      await user.type(input, 'ris');
      // Wait for debounce + fetch to resolve
      await waitFor(
        () => {
          expect(
            screen.getByTestId('preview-results-region'),
          ).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
      // Popular topics should be hidden when preview is showing
      expect(screen.queryByText('Popular topics')).toBeNull();
    });

    it('renders preview results as <a> elements pointed at the live per-kind detail route', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await waitFor(
        () => {
          expect(screen.getByText('Risk Assessment Guide')).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
      // q_a_pair result → the {135.22} viewer; source_document result →
      // the documents detail page. Neither the dead /browse nor /item/
      // routes.
      const link1 = screen.getByText('Risk Assessment Guide').closest('a');
      expect(link1).not.toBeNull();
      expect(link1).toHaveAttribute('href', '/library/item-001');

      const link2 = screen.getByText('Risk Management Policy').closest('a');
      expect(link2).not.toBeNull();
      expect(link2).toHaveAttribute('href', '/documents/item-002');
    });

    it('renders a reference_item preview result pointed at /reference/{id}', async () => {
      mockPreviewFetch([
        {
          id: 'item-003',
          title: 'ISO 27001 Certificate',
          content_type: 'reference_item',
          primary_domain: 'Compliance',
        },
      ]);
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'iso 27001');
      await waitFor(
        () => {
          expect(screen.getByText('ISO 27001 Certificate')).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
      const link = screen.getByText('ISO 27001 Certificate').closest('a');
      expect(link).not.toBeNull();
      expect(link).toHaveAttribute('href', '/reference/item-003');
    });

    it('has aria-live="polite" on the preview region', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await waitFor(
        () => {
          const region = screen.getByTestId('preview-results-region');
          expect(region).toHaveAttribute('aria-live', 'polite');
        },
        { timeout: 2000 },
      );
    });

    it('has aria-busy="false" when preview is settled', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await waitFor(
        () => {
          const region = screen.getByTestId('preview-results-region');
          expect(region).toHaveAttribute('aria-busy', 'false');
        },
        { timeout: 2000 },
      );
    });

    it('renders "See all results" button in preview section', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await waitFor(
        () => {
          expect(screen.getByText('See all results')).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it('"See all results" button triggers full search via onSearch', async () => {
      mockPreviewFetch();
      const onSearch = vi.fn();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline', onSearch });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await waitFor(
        () => {
          expect(screen.getByText('See all results')).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
      await user.click(screen.getByText('See all results'));
      expect(onSearch).toHaveBeenCalledWith('risk assess');
    });

    it('clicking a q_a_pair preview result navigates to the /library viewer', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await waitFor(
        () => {
          expect(screen.getByText('Risk Assessment Guide')).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
      await user.click(screen.getByText('Risk Assessment Guide'));
      expect(mockPush).toHaveBeenCalledWith('/library/item-001');
    });

    it('clicking a source_document preview result navigates to /documents/{id}', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await waitFor(
        () => {
          expect(
            screen.getByText('Risk Management Policy'),
          ).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
      await user.click(screen.getByText('Risk Management Policy'));
      expect(mockPush).toHaveBeenCalledWith('/documents/item-002');
    });

    it('does not show preview for compact variant', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'compact' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      await act(async () => {});
      expect(screen.queryByTestId('preview-results-region')).toBeNull();
    });

    it('existing inline tests still work — Enter on input runs onSearch', async () => {
      mockPreviewFetch();
      const onSearch = vi.fn();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline', onSearch });
      const input = screen.getByRole('combobox');
      await user.type(input, 'risk assessment');
      // Enter on the input (not on a preview result) runs full semantic search
      await user.keyboard('{Enter}');
      expect(onSearch).toHaveBeenCalledWith('risk assessment');
    });

    it('ArrowDown keyboard nav extends into preview results (spec §4.1)', async () => {
      mockPreviewFetch();
      const user = userEvent.setup();
      renderSearchBar({ variant: 'inline' });
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.type(input, 'risk assess');
      // Wait for the preview section to render with at least the first result
      await waitFor(
        () => {
          expect(screen.getByText('Risk Assessment Guide')).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
      // Before ArrowDown, no active descendant (or -1 index semantics).
      // Press ArrowDown once — should point at the first navigable item.
      // With no recent searches persisted in this test, the first item is
      // the first preview result (Risk Assessment Guide, id='item-001').
      await user.keyboard('{ArrowDown}');
      const activeDescendant = input.getAttribute('aria-activedescendant');
      expect(activeDescendant).not.toBeNull();
      // The activeDescendant should point at an option associated with the
      // first preview result — its <a> has href="/library/item-001" so the
      // option id encodes the item id.
      const firstPreviewLink = screen
        .getByText('Risk Assessment Guide')
        .closest('a');
      expect(firstPreviewLink).not.toBeNull();
      expect(activeDescendant).toBe(firstPreviewLink!.getAttribute('id'));
    });
  });
});
