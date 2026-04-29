/**
 * NearDuplicatesPairRowCard Component Tests
 *
 * Pure presentation — verifies labels distinguish left vs right sides,
 * DD/MM/YYYY formatting on created_at, length-in-chars derivation, and
 * the scrollable content body region.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { NearDuplicatesPairRowCard } from '@/components/admin/content-dedup/near-duplicates/near-duplicates-pair-row-card';
import type { NearDupPairMember } from '@/lib/query/fetchers';

function buildMember(
  overrides: Partial<NearDupPairMember> = {},
): NearDupPairMember {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'How are elevated access rights reviewed?',
    content: 'Lorem ipsum body text',
    dedup_status: 'clean',
    created_at: '2026-04-21T12:00:00Z',
    primary_domain: 'access-control',
    content_type: 'q_a_pair',
    content_owner_id: null,
    ingest_source: 'example-client-reingest-2026-v2',
    superseded_by: null,
    archived_at: null,
    publication_status: 'published',
    ...overrides,
  };
}

describe('NearDuplicatesPairRowCard', () => {
  it('renders left label, title, DD/MM/YYYY date, source, domain, type, length, status', () => {
    render(<NearDuplicatesPairRowCard row={buildMember()} side="left" />);

    expect(
      screen.getByTestId('near-dup-row-card-label-left'),
    ).toHaveTextContent(/Left/);
    expect(
      screen.getByText('How are elevated access rights reviewed?'),
    ).toBeInTheDocument();
    expect(screen.getByText('21/04/2026')).toBeInTheDocument();
    expect(screen.getByText('example-client-reingest-2026-v2')).toBeInTheDocument();
    expect(screen.getByText('access-control')).toBeInTheDocument();
    expect(screen.getByText('q_a_pair')).toBeInTheDocument();
    expect(screen.getByText(/21 chars/)).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();
  });

  it('renders right label when side="right"', () => {
    render(<NearDuplicatesPairRowCard row={buildMember()} side="right" />);
    expect(
      screen.getByTestId('near-dup-row-card-label-right'),
    ).toHaveTextContent(/Right/);
  });

  it('falls back to "Untitled" / "—" / "(empty)" / "0 chars" placeholders', () => {
    render(
      <NearDuplicatesPairRowCard
        row={buildMember({
          title: null,
          content: null,
          primary_domain: null,
          ingest_source: null,
          content_type: null,
        })}
        side="left"
      />,
    );

    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText(/0 chars/)).toBeInTheDocument();
    // Three "—" placeholders: source + domain + type
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it('exposes the content body as a keyboard-focusable scrollable region', () => {
    render(<NearDuplicatesPairRowCard row={buildMember()} side="left" />);
    const region = screen.getByRole('region', {
      name: /Left content body/i,
    });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('tabindex', '0');
  });
});
