/**
 * CorpusRelatedRecords / RelatedRecordsRail — ID-135 {135.20}.
 *
 * `RelatedRecordsRail` is a pure presenter (records/isLoading/isError/onRetry
 * props) — exercised directly with fixture rows, no hook or network mocking
 * needed (mirrors `DerivedPairsList`'s test pattern one level down). The
 * connected container, `CorpusRelatedRecords`, owns the id-131/id-133 MOCKED
 * fetcher internally; because that fetcher genuinely resolves (no network
 * call, no throw — see the component's file-level doc comment), it is safe
 * to let it run for real under a QueryClientProvider rather than mock it,
 * which proves the wiring end-to-end and proves today's honest default:
 * a clear empty state, since the real ontology-grounded RPC hasn't shipped.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { RelatedRecord } from '@/types/corpus-search';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import {
  RelatedRecordsRail,
  CorpusRelatedRecords,
} from '@/components/corpus-search/corpus-related-records';

function makeRecord(overrides: Partial<RelatedRecord> = {}): RelatedRecord {
  return {
    id: 'rec-1',
    kind: 'document',
    title: 'Supplier terms.pdf',
    ...overrides,
  };
}

describe('RelatedRecordsRail', () => {
  it('renders each related record, each linking to its correct surface', () => {
    render(
      <RelatedRecordsRail
        records={[
          makeRecord({
            id: 'doc-1',
            kind: 'document',
            title: 'Supplier terms.pdf',
          }),
          makeRecord({
            id: 'ans-1',
            kind: 'answer',
            title: 'What is VAT registration?',
          }),
          makeRecord({
            id: 'ref-1',
            kind: 'reference',
            title: 'GOV.UK — VAT guidance',
          }),
        ]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(screen.getByText('Supplier terms.pdf').closest('a')).toHaveAttribute(
      'href',
      '/documents/doc-1',
    );
    expect(
      screen.getByText('What is VAT registration?').closest('a'),
    ).toHaveAttribute('href', '/library');
    expect(
      screen.getByText('GOV.UK — VAT guidance').closest('a'),
    ).toHaveAttribute('href', '/reference/ref-1');
  });

  it('preserves server-supplied ordering — no client-side re-ranking', () => {
    render(
      <RelatedRecordsRail
        records={[
          makeRecord({ id: 'c', title: 'Third result' }),
          makeRecord({ id: 'a', title: 'First result' }),
          makeRecord({ id: 'b', title: 'Second result' }),
        ]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Third result'),
      expect.stringContaining('First result'),
      expect.stringContaining('Second result'),
    ]);
  });

  it('shows a clear empty state, not an error, when there are no related records', () => {
    render(
      <RelatedRecordsRail
        records={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/no related records found/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it('renders a loading indicator while the query is in flight', () => {
    const { container } = render(
      <RelatedRecordsRail
        records={[]}
        isLoading={true}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/no related records/i)).not.toBeInTheDocument();
  });

  it('renders a non-technical error with retry on failure, using the shared SectionErrorState', () => {
    const onRetry = vi.fn();
    render(
      <RelatedRecordsRail
        records={[]}
        isLoading={false}
        isError={true}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText(/couldn.t load related records/i),
    ).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /retry/i });
    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('carries a text label alongside an icon for every entry — never icon-only (BI-4)', () => {
    render(
      <RelatedRecordsRail
        records={[makeRecord({ title: 'Icon plus text?' })]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const link = screen.getByRole('link');
    expect(link.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(link).toHaveTextContent('Icon plus text?');
    expect(link).toHaveTextContent('Document');
  });

  it('never renders similarity/score/AI-suggested chrome (BI-3)', () => {
    render(
      <RelatedRecordsRail
        records={[
          makeRecord({ title: 'A related record' }),
          makeRecord({ id: 'rec-2', title: 'Another related record' }),
        ]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const rail = screen.getByRole('region', { name: /related/i });
    expect(rail.textContent).not.toMatch(/similarity|score|ai.suggested/i);
  });

  it('never renders a raw undefined/null', () => {
    const { container } = render(
      <RelatedRecordsRail
        records={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(container.textContent).not.toMatch(/\bundefined\b/);
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });
});

describe('CorpusRelatedRecords (connected container)', () => {
  function renderContainer(
    recordId: string,
    recordKind: RelatedRecord['kind'],
  ) {
    const { Wrapper } = createQueryWrapper();
    return render(
      <CorpusRelatedRecords recordId={recordId} recordKind={recordKind} />,
      { wrapper: Wrapper },
    );
  }

  it('renders the clear empty state today — the id-131/id-133 RPC is not yet shipped, so the mocked fetcher resolves to zero rows', async () => {
    renderContainer('doc-1', 'document');

    await waitFor(() =>
      expect(screen.getByText(/no related records found/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
