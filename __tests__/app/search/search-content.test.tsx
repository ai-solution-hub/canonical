/**
 * CorpusSearchContent — `/search` Surface A wiring (ID-135 {135.9}).
 *
 * Behaviour-first (test-philosophy.md): drives the REAL `CorpusSearchContent`
 * together with the REAL `useCorpusSearch` hook ({135.6}), the REAL
 * `CorpusResultCard` ({135.7}), and the REAL search/kind/filter controls
 * ({135.8}) — mocking only the I/O + routing seams (`fetchJson`,
 * `next/navigation`, `next/link`). This proves the end-to-end wiring the
 * Subtask exists to deliver: no-query guidance is distinct from loading,
 * which is distinct from zero-results, which is distinct from a transport
 * failure; results render in the order the (mocked) `/api/search` response
 * returned them, with an explicit end-of-results indicator.
 *
 * The `/api/search` endpoint is MOCKED (no live DB in vitest) — fixtures
 * conform to the verified `hybrid_search` RPC row shape, matching the
 * {135.6} hook test fixtures.
 *
 * Spec: TECH §3 BI-1, BI-7, BI-8, BI-17, BI-18, BI-19, BI-20; PRODUCT.md
 * same invariants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

const { mockFetchJson, mockPush, navState } = vi.hoisted(() => ({
  mockFetchJson: vi.fn(),
  mockPush: vi.fn(),
  navState: { search: '' },
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return { ...actual, fetchJson: mockFetchJson };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navState.search),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/search',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { CorpusSearchContent } from '@/app/search/search-content';

let idCounter = 0;
function makeRow(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `1111111${idCounter}-1111-4111-8111-111111111111`,
    title: `Result ${idCounter}`,
    suggested_title: null,
    summary: 'A short summary or answer preview.',
    primary_domain: 'procurement',
    primary_subtopic: 'tendering',
    content_type: 'q_a_pair',
    similarity: 0.87,
    ...overrides,
  };
}

function renderContent() {
  const { Wrapper } = createQueryWrapper();
  return render(<CorpusSearchContent />, { wrapper: Wrapper });
}

/** A promise that never resolves — pins the hook in its loading state. */
function pendingFetch() {
  return new Promise(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  navState.search = '';
  idCounter = 0;
  mockFetchJson.mockResolvedValue({ results: [] });
});

describe('CorpusSearchContent — no-query guidance (BI-8)', () => {
  it('shows guidance, not a spinner or error, when there is no ?q', () => {
    navState.search = '';

    renderContent();

    expect(screen.getByText('Start your search')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Loading references'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

describe('CorpusSearchContent — loading state (BI-17)', () => {
  it('renders the shared ReferenceLoadingSkeleton while a search is in flight', () => {
    navState.search = 'q=vat+thresholds';
    mockFetchJson.mockReturnValue(pendingFetch());

    renderContent();

    expect(screen.getByLabelText('Loading references')).toBeInTheDocument();
    expect(screen.queryByText('Start your search')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('CorpusSearchContent — zero results (BI-18)', () => {
  it('shows a no-results state distinct from the no-query guidance', async () => {
    navState.search = 'q=nothing+matches';
    mockFetchJson.mockResolvedValue({ results: [] });

    renderContent();

    expect(await screen.findByText('No results match')).toBeInTheDocument();
    expect(screen.queryByText('Start your search')).not.toBeInTheDocument();
  });
});

describe('CorpusSearchContent — failure state (BI-19)', () => {
  it('shows a non-technical error with a retry affordance, never the raw error', async () => {
    navState.search = 'q=vat+thresholds';
    mockFetchJson.mockRejectedValue(new Error('ECONNRESET: socket hang up'));

    renderContent();

    expect(
      await screen.findByText("Couldn't load results"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/ECONNRESET|socket hang up/i),
    ).not.toBeInTheDocument();
    // Distinct from the empty/no-query states.
    expect(screen.queryByText('No results match')).not.toBeInTheDocument();
    expect(screen.queryByText('Start your search')).not.toBeInTheDocument();
  });
});

describe('CorpusSearchContent — results order + end-of-results indicator (BI-20)', () => {
  it('renders results in the order the response returned them, with an explicit end indicator', async () => {
    navState.search = 'q=vat+thresholds';
    mockFetchJson.mockResolvedValue({
      results: [
        makeRow({ title: 'Alpha result', content_type: 'q_a_pair' }),
        makeRow({ title: 'Beta result', content_type: 'source_document' }),
        makeRow({ title: 'Gamma result', content_type: 'reference_item' }),
      ],
    });

    renderContent();

    await waitFor(() =>
      expect(screen.getByText('Alpha result')).toBeInTheDocument(),
    );

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Alpha result', 'Beta result', 'Gamma result']);

    expect(screen.getByText(/end of results/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it('shows a Load more affordance instead of the end indicator when more results remain', async () => {
    navState.search = 'q=vat+thresholds';
    // The hook's limit-raising fallback treats a FULL page (48 rows, matching
    // its PAGE_SIZE) as "more may exist" — see hooks/corpus-search/use-corpus-search.ts.
    mockFetchJson.mockResolvedValue({
      results: Array.from({ length: 48 }, (_, i) =>
        makeRow({ title: `Result ${i + 1}` }),
      ),
    });

    renderContent();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /load more/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/end of results/i)).not.toBeInTheDocument();
  });
});
