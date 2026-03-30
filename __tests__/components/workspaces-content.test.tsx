/**
 * WorkspacesContent Component Tests
 *
 * Tests the workspaces launcher content component after the S110 rewrite.
 * The component now shows workspace type cards (Bids, Sales Proposals)
 * instead of individual workspace items.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

import { WorkspacesContent } from '@/app/workspaces/workspaces-content';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacesContent', () => {
  it('renders page description', () => {
    render(<WorkspacesContent counts={{}} />);
    expect(
      screen.getByText('Use your knowledge base to power different types of work.'),
    ).toBeInTheDocument();
  });

  it('renders Bids type card with count', () => {
    render(<WorkspacesContent counts={{ bid: 3 }} />);
    expect(screen.getByText('Bids')).toBeInTheDocument();
    expect(screen.getByText('3 active bids')).toBeInTheDocument();
  });

  it('renders Sales Proposals as coming soon', () => {
    render(<WorkspacesContent counts={{}} />);
    expect(screen.getByText('Sales Proposals')).toBeInTheDocument();
    // Multiple 'Coming soon' badges exist (Sales Proposals + Intelligence)
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(1);
  });

  it('links Bids card to /bid', () => {
    render(<WorkspacesContent counts={{ bid: 1 }} />);
    const link = screen.getByRole('link', { name: /bids/i });
    expect(link).toHaveAttribute('href', '/bid');
  });

  it('marks coming soon cards as aria-disabled', () => {
    render(<WorkspacesContent counts={{}} />);
    const proposalCard = screen.getByText('Sales Proposals').closest('[aria-disabled]');
    expect(proposalCard).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows singular "bid" for count of 1', () => {
    render(<WorkspacesContent counts={{ bid: 1 }} />);
    expect(screen.getByText('1 active bid')).toBeInTheDocument();
  });

  it('hides count text when count is 0 but includes in aria-label', () => {
    render(<WorkspacesContent counts={{ bid: 0 }} />);
    // Count text is not rendered visually when 0
    expect(screen.queryByText('0 active bids')).not.toBeInTheDocument();
    // But is present in the aria-label for accessibility
    const link = screen.getByRole('link', { name: /0 active bids/i });
    expect(link).toBeInTheDocument();
  });
});
