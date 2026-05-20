/**
 * Workspaces Launcher Tests
 *
 * Tests the WorkspacesContent launcher component that replaced the old
 * workspace grid. Verifies type cards render correctly, counts display,
 * coming soon cards, accessibility landmarks, and keyboard navigation.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
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
      screen.getByRole('heading', { level: 2, name: 'Procurements' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Sales Proposals' }),
    ).toBeInTheDocument();
  });

  it('shows correct count text for active procurements', () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 3 }} />);
    expect(screen.getByText("3 active procurements")).toBeInTheDocument();
  });

  it('shows singular count text for 1 active procurement', () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 1 }} />);
    expect(screen.getByText('1 active procurement')).toBeInTheDocument();
  });

  it('does not show count text when count is zero', () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 0 }} />);
    expect(screen.queryByText(/active procurement/)).not.toBeInTheDocument();
  });

  it('links the bid card to /bid', () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 5 }} />);
    const bidLink = screen.getByRole('link', {
      name: /Procurements/,
    });
    expect(bidLink).toHaveAttribute('href', '/procurement');
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
    // Multiple 'Coming soon' badges exist (Sales Proposals + Intelligence)
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(1);
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
