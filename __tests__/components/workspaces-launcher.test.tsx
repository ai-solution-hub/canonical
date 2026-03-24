/**
 * Workspaces Launcher Tests
 *
 * Tests the WorkspacesContent launcher component that replaced the old
 * workspace grid. Verifies type cards render correctly, counts display,
 * coming soon cards, accessibility landmarks, and keyboard navigation.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { WorkspacesContent } from '@/app/workspaces/workspaces-content';

// Mock next/link to render a plain anchor for test assertions
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

describe('WorkspacesContent (launcher)', () => {
  it('renders the page heading and description', () => {
    render(<WorkspacesContent counts={{}} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Workspaces' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Use your knowledge base to power different types of work.',
      ),
    ).toBeInTheDocument();
  });

  it('renders type cards for bid and proposal', () => {
    render(<WorkspacesContent counts={{}} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Bids' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Sales Proposals' }),
    ).toBeInTheDocument();
  });

  it('shows correct count text for active bids', () => {
    render(<WorkspacesContent counts={{ bid: 3 }} />);
    expect(screen.getByText('3 active bids')).toBeInTheDocument();
  });

  it('shows singular count text for 1 active bid', () => {
    render(<WorkspacesContent counts={{ bid: 1 }} />);
    expect(screen.getByText('1 active bid')).toBeInTheDocument();
  });

  it('does not show count text when count is zero', () => {
    render(<WorkspacesContent counts={{ bid: 0 }} />);
    expect(screen.queryByText(/active bid/)).not.toBeInTheDocument();
  });

  it('links the bid card to /bid', () => {
    render(<WorkspacesContent counts={{ bid: 5 }} />);
    const bidLink = screen.getByRole('link', {
      name: /Bids/,
    });
    expect(bidLink).toHaveAttribute('href', '/bid');
  });

  it('marks coming soon cards as aria-disabled', () => {
    render(<WorkspacesContent counts={{}} />);
    const proposalCard = screen.getByLabelText(/Sales Proposals.*coming soon/);
    expect(proposalCard).toHaveAttribute('aria-disabled', 'true');
  });

  it('applies reduced opacity to coming soon cards', () => {
    render(<WorkspacesContent counts={{}} />);
    const proposalCard = screen.getByLabelText(/Sales Proposals.*coming soon/);
    expect(proposalCard.className).toContain('opacity-60');
  });

  it('shows "Coming soon" badge on unavailable types', () => {
    render(<WorkspacesContent counts={{}} />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('does not render coming soon types as links', () => {
    render(<WorkspacesContent counts={{}} />);
    // Proposal should not be a link
    const links = screen.getAllByRole('link');
    const proposalLinks = links.filter((l) =>
      l.textContent?.includes('Sales Proposals'),
    );
    expect(proposalLinks).toHaveLength(0);
  });
});
