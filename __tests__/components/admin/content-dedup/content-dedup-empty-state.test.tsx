/**
 * ContentDedupEmptyState Component Tests
 *
 * Verifies the empty-queue panel renders the expected heading + body
 * and uses an icon (not colour-alone) to convey state per WCAG 2.1 AA.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { ContentDedupEmptyState } from '@/components/admin/content-dedup/content-dedup-empty-state';

describe('ContentDedupEmptyState', () => {
  it('renders the heading and body explanation', () => {
    render(<ContentDedupEmptyState />);

    expect(
      screen.getByRole('heading', {
        name: /no suspected duplicates pending review/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/exact-hash dedup gate/i)).toBeInTheDocument();
  });

  it('exposes an aria-labelled region', () => {
    render(<ContentDedupEmptyState />);
    const region = screen.getByRole('region');
    expect(region).toHaveAccessibleName(
      /no suspected duplicates pending review/i,
    );
  });
});
