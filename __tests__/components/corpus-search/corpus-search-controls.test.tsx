/**
 * Corpus search controls — search box, kind-narrow, metadata filters
 * (ID-135 {135.8}).
 *
 * Behaviour-first (test-philosophy.md): no `useCorpusSearch` hook exists yet
 * ({135.9}+), so each control is directly URL-driven — these tests mock only
 * `next/navigation` and drive the REAL param read/write logic (set / delete /
 * replace against `URLSearchParams`), asserting the exact `router.push`
 * target for each interaction.
 *
 * Spec: PRODUCT.md BI-4, BI-9, BI-15, BI-16; TECH.md §3/§4.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockPush, navState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  navState: { search: '' },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navState.search),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/search',
}));

import {
  CorpusSearchBox,
  CorpusKindNarrow,
  CorpusFilterControls,
} from '@/components/corpus-search/corpus-search-controls';

beforeEach(() => {
  vi.clearAllMocks();
  navState.search = '';
});

// ---------------------------------------------------------------------------
// CorpusSearchBox (BI-9)
// ---------------------------------------------------------------------------

describe('CorpusSearchBox', () => {
  it('pushes ?q with the trimmed query on submit', () => {
    render(<CorpusSearchBox />);
    fireEvent.change(
      screen.getByPlaceholderText(/search answers, documents/i),
      { target: { value: '  procurement rules  ' } },
    );
    fireEvent.submit(screen.getByRole('search'));
    expect(mockPush).toHaveBeenCalledWith('/search?q=procurement+rules');
  });

  it('preserves the active kind/filter params when pushing a new query', () => {
    navState.search = 'kind=document&domain=finance';
    render(<CorpusSearchBox />);
    fireEvent.change(
      screen.getByPlaceholderText(/search answers, documents/i),
      { target: { value: 'invoices' } },
    );
    fireEvent.submit(screen.getByRole('search'));
    const [url] = mockPush.mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1]);
    expect(params.get('q')).toBe('invoices');
    expect(params.get('kind')).toBe('document');
    expect(params.get('domain')).toBe('finance');
  });

  it('removes ?q entirely when submitted empty (clears rather than sets a blank query)', () => {
    navState.search = 'q=old';
    render(<CorpusSearchBox />);
    fireEvent.change(screen.getByDisplayValue('old'), {
      target: { value: '   ' },
    });
    fireEvent.submit(screen.getByRole('search'));
    expect(mockPush).toHaveBeenCalledWith('/search');
  });

  it('renders the current ?q value as the initial input value (URL-driven)', () => {
    navState.search = 'q=existing+query';
    render(<CorpusSearchBox />);
    expect(screen.getByDisplayValue('existing query')).toBeInTheDocument();
  });

  it('the Clear button removes ?q but keeps other active params', () => {
    navState.search = 'q=old&kind=answer';
    render(<CorpusSearchBox />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(mockPush).toHaveBeenCalledWith('/search?kind=answer');
  });

  it('does not render a Clear button when there is no active query', () => {
    render(<CorpusSearchBox />);
    expect(
      screen.queryByRole('button', { name: /clear/i }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CorpusKindNarrow (BI-15 — narrows only, never widens)
// ---------------------------------------------------------------------------

describe('CorpusKindNarrow', () => {
  it('sets ?kind to the selected kind, narrowing from the ALL default', () => {
    render(<CorpusKindNarrow />);
    fireEvent.click(screen.getByRole('button', { name: /answers/i }));
    expect(mockPush).toHaveBeenCalledWith('/search?kind=answer');
  });

  it('never widens beyond a single kind — selecting a second kind replaces, not appends', () => {
    navState.search = 'kind=answer';
    render(<CorpusKindNarrow />);
    fireEvent.click(screen.getByRole('button', { name: /documents/i }));
    const [url] = mockPush.mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1]);
    expect(params.getAll('kind')).toEqual(['document']);
  });

  it('clearing (selecting "All kinds") removes ?kind and returns to ALL grains', () => {
    navState.search = 'kind=reference&q=x';
    render(<CorpusKindNarrow />);
    fireEvent.click(screen.getByRole('button', { name: /all kinds/i }));
    expect(mockPush).toHaveBeenCalledWith('/search?q=x');
  });

  it('preserves the active query param when narrowing', () => {
    navState.search = 'q=procurement';
    render(<CorpusKindNarrow />);
    fireEvent.click(screen.getByRole('button', { name: /references/i }));
    expect(mockPush).toHaveBeenCalledWith(
      '/search?q=procurement&kind=reference',
    );
  });

  it('marks the active kind as pressed for assistive tech (text+icon, never colour-only)', () => {
    navState.search = 'kind=document';
    render(<CorpusKindNarrow />);
    expect(screen.getByRole('button', { name: /documents/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /answers/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

// ---------------------------------------------------------------------------
// CorpusFilterControls (BI-16 — domain / subtopic / date)
// ---------------------------------------------------------------------------

describe('CorpusFilterControls', () => {
  it('pushes ?domain when a domain is entered', () => {
    render(<CorpusFilterControls />);
    fireEvent.change(screen.getByLabelText(/^domain$/i), {
      target: { value: 'finance' },
    });
    expect(mockPush).toHaveBeenCalledWith('/search?domain=finance');
  });

  it('pushes ?subtopic when a subtopic is entered', () => {
    render(<CorpusFilterControls />);
    fireEvent.change(screen.getByLabelText(/^subtopic$/i), {
      target: { value: 'invoicing' },
    });
    expect(mockPush).toHaveBeenCalledWith('/search?subtopic=invoicing');
  });

  // TECH §4 mandates the canonical URL param list `?q, ?domain, ?subtopic,
  // ?source, ?from, ?to` — the date-range keys are `from`/`to`, NOT
  // `dateFrom`/`dateTo` (that pair names the CorpusSearchFilters object
  // fields, not the URL keys). The {135.6} useCorpusSearch hook reads
  // `from`/`to` off the URL — these assertions lock the cross-component
  // contract so a param-key drift here fails fast instead of silently
  // no-op'ing date filtering in production.
  it('pushes ?from (not ?dateFrom) when the from-date is set', () => {
    render(<CorpusFilterControls />);
    fireEvent.change(screen.getByLabelText(/date from/i), {
      target: { value: '2026-01-01' },
    });
    expect(mockPush).toHaveBeenCalledWith('/search?from=2026-01-01');
  });

  it('pushes ?to (not ?dateTo) when the to-date is set', () => {
    render(<CorpusFilterControls />);
    fireEvent.change(screen.getByLabelText(/date to/i), {
      target: { value: '2026-02-01' },
    });
    expect(mockPush).toHaveBeenCalledWith('/search?to=2026-02-01');
  });

  it('reads the initial date-range values off ?from/?to (URL-driven)', () => {
    navState.search = 'from=2026-01-01&to=2026-02-01';
    render(<CorpusFilterControls />);
    expect(screen.getByLabelText(/date from/i)).toHaveValue('2026-01-01');
    expect(screen.getByLabelText(/date to/i)).toHaveValue('2026-02-01');
  });

  it('clearing all filters removes ?from/?to (not ?dateFrom/?dateTo)', () => {
    navState.search = 'q=x&from=2026-01-01&to=2026-02-01';
    render(<CorpusFilterControls />);
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    const [url] = mockPush.mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1]);
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
    expect(params.has('dateFrom')).toBe(false);
    expect(params.has('dateTo')).toBe(false);
    expect(params.get('q')).toBe('x');
  });

  it('preserves active query/kind params when a filter is set', () => {
    navState.search = 'q=x&kind=answer';
    render(<CorpusFilterControls />);
    fireEvent.change(screen.getByLabelText(/^domain$/i), {
      target: { value: 'finance' },
    });
    const [url] = mockPush.mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1]);
    expect(params.get('q')).toBe('x');
    expect(params.get('kind')).toBe('answer');
    expect(params.get('domain')).toBe('finance');
  });

  it('never renders a publication-status control — that restriction is server-side only (id-131 BI-20)', () => {
    render(<CorpusFilterControls />);
    expect(
      screen.queryByLabelText(/publication|status|published/i),
    ).not.toBeInTheDocument();
  });

  it('clearing all filters removes every filter param but preserves q/kind', () => {
    navState.search =
      'q=x&kind=document&domain=finance&subtopic=invoicing&from=2026-01-01&to=2026-02-01';
    render(<CorpusFilterControls />);
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(mockPush).toHaveBeenCalledWith('/search?q=x&kind=document');
  });

  it('does not render the clear-filters affordance when no filter is active', () => {
    render(<CorpusFilterControls />);
    expect(
      screen.queryByRole('button', { name: /clear filters/i }),
    ).not.toBeInTheDocument();
  });
});
