/**
 * ContentDedupRowCard Component Tests
 *
 * Pure presentation — renders title, metadata, publication-status badge,
 * and a scrollable content body. Verifies labels distinguish subject vs
 * canonical and that DD/MM/YYYY formatting is applied to created_at.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { ContentDedupRowCard } from '@/components/admin/content-dedup/content-dedup-row-card';
import type { SuspectedDuplicateRow } from '@/lib/query/fetchers';

function buildRow(
  overrides: Partial<SuspectedDuplicateRow> = {},
): SuspectedDuplicateRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Cloud security policy v3',
    content: 'Lorem ipsum body',
    dedup_status: 'suspected_duplicate',
    created_at: '2026-04-28T12:00:00Z',
    domain_primary: 'tech-it',
    content_owner_id: null,
    ingest_source: 'url_import',
    superseded_by: null,
    publication_status: 'in_review',
    metadata: null,
    ...overrides,
  };
}

describe('ContentDedupRowCard', () => {
  it('renders subject label, title, DD/MM/YYYY date, source, domain, status', () => {
    render(<ContentDedupRowCard row={buildRow()} label="subject" />);

    expect(screen.getByTestId('row-card-label-subject')).toHaveTextContent(
      /Subject \(suspected\)/,
    );
    expect(screen.getByText('Cloud security policy v3')).toBeInTheDocument();
    expect(screen.getByText('28/04/2026')).toBeInTheDocument();
    expect(screen.getByText('url_import')).toBeInTheDocument();
    expect(screen.getByText('tech-it')).toBeInTheDocument();
    expect(screen.getByText('in_review')).toBeInTheDocument();
  });

  it('renders canonical label when label="canonical"', () => {
    render(<ContentDedupRowCard row={buildRow()} label="canonical" />);
    expect(screen.getByTestId('row-card-label-canonical')).toHaveTextContent(
      /Canonical \(existing\)/,
    );
  });

  it('falls back to "Untitled" / "—" / "(empty)" placeholders', () => {
    render(
      <ContentDedupRowCard
        row={buildRow({
          title: null,
          content: null,
          domain_primary: null,
          ingest_source: null,
        })}
        label="subject"
      />,
    );

    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    // Two "—" placeholders: source + domain
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes the content body as a scrollable region', () => {
    render(<ContentDedupRowCard row={buildRow()} label="subject" />);
    const region = screen.getByRole('region', {
      name: /Subject \(suspected\) content body/i,
    });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('tabindex', '0');
  });
});
