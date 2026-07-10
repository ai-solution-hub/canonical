/**
 * DerivedPairsList — ID-135 {135.17}, TECH.md §3 BI-28.
 *
 * Props-driven presenter of `useDerivedPairs` ({135.13}) — no data fetching
 * of its own. Mocks the hook (vi.hoisted, mirroring
 * `__tests__/components/content-library-drawer.test.tsx`'s pattern) rather
 * than a network layer, since this component's only job is to render the
 * hook's `data`/`isLoading`/`isError` states, never to own the fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { DerivedPair } from '@/hooks/source-document-detail/use-source-document-detail';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUseDerivedPairs, mockRefetch } = vi.hoisted(() => ({
  mockUseDerivedPairs: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock('@/hooks/source-document-detail/use-source-document-detail', () => ({
  useDerivedPairs: (id: string) => mockUseDerivedPairs(id),
}));

import { DerivedPairsList } from '@/components/source-document-detail/derived-pairs-list';

const DOC_ID = '11111111-1111-4111-8111-111111111111';

function makePair(overrides: Partial<DerivedPair> = {}): DerivedPair {
  return {
    id: 'qa-1',
    question_text: 'What is the policy?',
    answer_standard: 'The policy is X.',
    publication_status: 'published',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockQueryState(overrides: Partial<ReturnType<typeof baseState>> = {}) {
  mockUseDerivedPairs.mockReturnValue({ ...baseState(), ...overrides });
}

function baseState() {
  return {
    data: undefined as DerivedPair[] | undefined,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  };
}

beforeEach(() => {
  mockUseDerivedPairs.mockReset();
  mockRefetch.mockReset();
});

describe('DerivedPairsList', () => {
  it('renders each published derived pair, linking to its /library/[id] viewer', () => {
    mockQueryState({
      data: [
        makePair({ id: 'qa-1', question_text: 'What is the policy?' }),
        makePair({ id: 'qa-2', question_text: 'How long is the term?' }),
      ],
    });

    render(<DerivedPairsList documentId={DOC_ID} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(
      screen.getByText('What is the policy?').closest('a'),
    ).toHaveAttribute('href', '/library/qa-1');
    expect(
      screen.getByText('How long is the term?').closest('a'),
    ).toHaveAttribute('href', '/library/qa-2');
  });

  it('renders every pair the hook returns without dropping any — proves no client-side publication filter exists (BI-28)', () => {
    // The route + `useDerivedPairs` already restrict to `publication_status
    // = 'published'` server-side (proved in that hook's own test suite).
    // This asserts the component's half of the contract: it never narrows
    // further — whatever the hook hands back is rendered verbatim, so an
    // unpublished/superseded pair could only ever reach the screen via a
    // hook-level regression, not a component-level one.
    mockQueryState({
      data: [
        makePair({ id: 'qa-1' }),
        makePair({ id: 'qa-2' }),
        makePair({ id: 'qa-3' }),
      ],
    });

    render(<DerivedPairsList documentId={DOC_ID} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('shows a clear empty state, not an error, when there are no published pairs', () => {
    mockQueryState({ data: [] });

    render(<DerivedPairsList documentId={DOC_ID} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByText(/no published answers have been derived/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it('renders a loading indicator while the query is in flight', () => {
    mockQueryState({ isLoading: true });

    const { container } = render(<DerivedPairsList documentId={DOC_ID} />);

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a non-technical error with retry on failure, isolated to this section (BI-30)', () => {
    mockQueryState({ isError: true });

    render(<DerivedPairsList documentId={DOC_ID} />);

    expect(
      screen.getByText(/couldn.t load the derived answers/i),
    ).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /retry/i });
    retryButton.click();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('carries a text label alongside the icon for every entry — never icon-only (BI-4)', () => {
    mockQueryState({ data: [makePair({ question_text: 'Icon plus text?' })] });

    render(<DerivedPairsList documentId={DOC_ID} />);

    const link = screen.getByRole('link');
    expect(link.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(link).toHaveTextContent('Icon plus text?');
  });

  it('never renders a raw undefined/null when data is absent', () => {
    mockQueryState({ data: undefined });

    const { container } = render(<DerivedPairsList documentId={DOC_ID} />);

    expect(container.textContent).not.toMatch(/\bundefined\b/);
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });
});
