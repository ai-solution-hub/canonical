/**
 * NearDuplicatesEmptyState Component Tests
 *
 * Verifies the empty-state panel surfaces the active threshold and links
 * back to the §1.7 exact-hash queue (AC10).
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { NearDuplicatesEmptyState } from '@/components/admin/content-dedup/near-duplicates/near-duplicates-empty-state';

describe('NearDuplicatesEmptyState', () => {
  it('renders the empty heading with the active threshold', () => {
    render(<NearDuplicatesEmptyState threshold={0.95} />);
    expect(
      screen.getByRole('heading', {
        name: /no near-duplicate pairs above threshold 0\.95/i,
      }),
    ).toBeInTheDocument();
  });

  it('shows guidance to lower the threshold or clear the domain filter', () => {
    render(<NearDuplicatesEmptyState threshold={0.92} />);
    expect(
      screen.getByText(/lowering the threshold|clear the domain filter/i),
    ).toBeInTheDocument();
  });

  it('links back to the §1.7 exact-hash queue', () => {
    render(<NearDuplicatesEmptyState threshold={0.95} />);
    const link = screen.getByRole('link', { name: /\/admin\/content-dedup/i });
    expect(link).toHaveAttribute('href', '/admin/content-dedup');
  });
});
