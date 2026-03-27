/**
 * ContentLibraryDrawer Component Tests
 *
 * Tests the Content Library slide-in drawer — search, type filter chips,
 * loading/empty states, result rendering, and domain filter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockSearch, mockSearchResults, mockIsLoading, mockError } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockSearchResults: { value: [] as Array<{
    id: string;
    title: string;
    content_type: string;
    primary_domain: string | null;
    similarity: number;
    ai_summary: string | null;
    metadata: Record<string, unknown> | null;
    source_document: string | null;
    [key: string]: unknown;
  }> },
  mockIsLoading: { value: false },
  mockError: { value: null as string | null },
}));

vi.mock('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: mockSearchResults.value,
    isLoading: mockIsLoading.value,
    error: mockError.value,
    search: mockSearch,
  }),
}));

vi.mock('@/hooks/use-modifier-key', () => ({
  useModifierKey: () => '\u2318',
}));

vi.mock('@/components/content/content-library-result', () => ({
  ContentLibraryResult: ({ result }: { result: { id: string; title: string } }) => (
    <div data-testid={`result-${result.id}`}>{result.title}</div>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { ContentLibraryDrawer } from '@/components/content/content-library-drawer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSearchResult(overrides: Partial<{
  id: string;
  title: string;
  content_type: string;
  primary_domain: string | null;
  similarity: number;
}> = {}) {
  return {
    id: overrides.id ?? 'res-1',
    title: overrides.title ?? 'Test result',
    suggested_title: null,
    ai_summary: null,
    primary_domain: overrides.primary_domain ?? 'Corporate',
    primary_subtopic: null,
    content_type: overrides.content_type ?? 'article',
    platform: 'web',
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
    metadata: null,
    verified_at: null,
    source_document: null,
    brief: null,
    similarity: overrides.similarity ?? 0.85,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentLibraryDrawer', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchResults.value = [];
    mockIsLoading.value = false;
    mockError.value = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render content when open=false', () => {
    render(<ContentLibraryDrawer open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Content Library')).not.toBeInTheDocument();
  });

  it('renders sheet with title "Content Library" when open=true', () => {
    render(<ContentLibraryDrawer {...defaultProps} />);
    expect(screen.getByText('Content Library')).toBeInTheDocument();
  });

  it('pre-populates search input with questionText on open', async () => {
    render(
      <ContentLibraryDrawer {...defaultProps} questionText="What is our approach to data security?" />,
    );

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith(
        'What is our approach to data security?',
        0.3,
        15,
      );
    });
  });

  it('shows type filter chips (All types, Q&A pairs)', () => {
    render(<ContentLibraryDrawer {...defaultProps} />);
    expect(screen.getByText('All types')).toBeInTheDocument();
    expect(screen.getByText('Q&A pairs')).toBeInTheDocument();
  });

  it('shows loading skeletons during search', () => {
    mockIsLoading.value = true;
    render(<ContentLibraryDrawer {...defaultProps} />);
    // Skeleton elements have animate-pulse
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no search performed', () => {
    render(<ContentLibraryDrawer {...defaultProps} />);
    expect(screen.getByText(/Search the content library/)).toBeInTheDocument();
  });

  it('shows "No results" when search returns empty', async () => {
    mockSearchResults.value = [];
    mockIsLoading.value = false;

    // We need hasSearched = true. Trigger by opening with questionText.
    render(
      <ContentLibraryDrawer {...defaultProps} questionText="nonexistent query" />,
    );

    await waitFor(() => {
      expect(screen.getByText(/No results for/)).toBeInTheDocument();
    });
  });

  it('renders results via ContentLibraryResult', async () => {
    mockSearchResults.value = [
      createSearchResult({ id: 'r-1', title: 'Data protection policy' }),
      createSearchResult({ id: 'r-2', title: 'Security overview' }),
    ];

    render(
      <ContentLibraryDrawer {...defaultProps} questionText="data security" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('result-r-1')).toBeInTheDocument();
      expect(screen.getByTestId('result-r-2')).toBeInTheDocument();
    });
  });

  it('shows result count', async () => {
    mockSearchResults.value = [
      createSearchResult({ id: 'r-1' }),
      createSearchResult({ id: 'r-2' }),
      createSearchResult({ id: 'r-3' }),
    ];

    render(
      <ContentLibraryDrawer {...defaultProps} questionText="test query" />,
    );

    await waitFor(() => {
      expect(screen.getByText('3 results')).toBeInTheDocument();
    });
  });

  it('shows domain filter when results available', async () => {
    mockSearchResults.value = [
      createSearchResult({ id: 'r-1', primary_domain: 'Corporate' }),
      createSearchResult({ id: 'r-2', primary_domain: 'Technical' }),
    ];

    render(
      <ContentLibraryDrawer {...defaultProps} questionText="test" />,
    );

    await waitFor(() => {
      // Domain filter select trigger should appear
      expect(screen.getByText('All domains')).toBeInTheDocument();
    });
  });
});
