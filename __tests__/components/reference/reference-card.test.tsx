/**
 * ReferenceCard — single list/search card tests (ID-111.10).
 *
 * Behaviour-first (test-philosophy.md): the card is a pure presentational
 * component over `ReferenceListItem`; we assert the rendered output for the
 * list shape AND the search shape (with scores), proving one card serves both
 * and that scores are NEVER rendered (B-23).
 *
 * Spec: PRODUCT.md B-11, B-17, B-23, B-26, B-27.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { ReferenceCard } from '@/components/reference/reference-card';
import type { ReferenceListItem } from '@/types/reference';

const REFERENCE_ID = '11111111-1111-4111-8111-111111111111';

function makeItem(
  overrides: Partial<ReferenceListItem> = {},
): ReferenceListItem {
  return {
    reference_id: REFERENCE_ID,
    title: 'UK SMB Procurement Trends 2026',
    summary_preview: 'A concise summary preview of procurement trends.',
    body_preview: 'Body preview text.',
    source_url: 'https://example.com/a',
    published_at: '2026-01-15T00:00:00Z',
    primary_domain: 'procurement',
    primary_subtopic: 'tendering',
    layer: 'detail',
    ingestion_source: 'url_import',
    source_document_id: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

describe('ReferenceCard', () => {
  it('links the card to /reference/<id>', () => {
    render(<ReferenceCard reference={makeItem()} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `/reference/${REFERENCE_ID}`);
  });

  it('renders the title and the summary preview', () => {
    render(<ReferenceCard reference={makeItem()} />);
    expect(
      screen.getByText('UK SMB Procurement Trends 2026'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A concise summary preview of procurement trends.'),
    ).toBeInTheDocument();
  });

  it('falls back to the body preview when summary_preview is empty', () => {
    render(<ReferenceCard reference={makeItem({ summary_preview: null })} />);
    expect(screen.getByText('Body preview text.')).toBeInTheDocument();
  });

  it('renders domain, subtopic and layer badges when present', () => {
    render(<ReferenceCard reference={makeItem()} />);
    expect(screen.getByText('procurement')).toBeInTheDocument();
    expect(screen.getByText('tendering')).toBeInTheDocument();
    expect(screen.getByText('detail')).toBeInTheDocument();
  });

  it('omits a badge when its column is null', () => {
    render(
      <ReferenceCard
        reference={makeItem({ primary_subtopic: null, layer: null })}
      />,
    );
    expect(screen.getByText('procurement')).toBeInTheDocument();
    expect(screen.queryByText('tendering')).not.toBeInTheDocument();
    expect(screen.queryByText('detail')).not.toBeInTheDocument();
  });

  it('shows the URL-import source in plain language, never the raw enum', () => {
    render(<ReferenceCard reference={makeItem()} />);
    expect(screen.getByText('URL import')).toBeInTheDocument();
    expect(screen.queryByText('url_import')).not.toBeInTheDocument();
  });

  it('shows the RSS-feed source in plain language', () => {
    render(
      <ReferenceCard reference={makeItem({ ingestion_source: 'rss_feed' })} />,
    );
    expect(screen.getByText('RSS feed')).toBeInTheDocument();
    expect(screen.queryByText('rss_feed')).not.toBeInTheDocument();
  });

  it('renders published_at as DD/MM/YYYY when present', () => {
    render(<ReferenceCard reference={makeItem()} />);
    expect(screen.getByText('15/01/2026')).toBeInTheDocument();
  });

  it('shows an explicit "No publication date" when published_at is null', () => {
    render(<ReferenceCard reference={makeItem({ published_at: null })} />);
    expect(screen.getByText('No publication date')).toBeInTheDocument();
  });

  it('NEVER renders the raw embedding/fulltext scores (B-23, AI-invisible)', () => {
    render(
      <ReferenceCard
        reference={makeItem({ embedding_score: 0.873, fulltext_score: 0.421 })}
      />,
    );
    // Same card shape for search rows — the scores are not surfaced anywhere.
    expect(screen.queryByText(/0\.873/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.421/)).not.toBeInTheDocument();
  });
});
