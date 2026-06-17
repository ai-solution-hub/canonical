/**
 * Workspaces Launcher Tests
 *
 * Tests the WorkspacesContent launcher component that replaced the old
 * workspace grid. Verifies type cards render correctly, counts display,
 * coming soon cards, accessibility landmarks, and keyboard navigation.
 *
 * Post-ID-29.7: launcher consumes `useLauncherTypes()` (TanStack hook). Tests
 * wrap in a `QueryClientProvider` (via `createQueryWrapper()`) and stub
 * `fetch` (via `stubApplicationTypesFetch()`) to return the 6
 * application_types seed rows.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkspacesContent } from '@/app/workspaces/workspaces-content';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import {
  stubApplicationTypesFetch,
  SEED_APPLICATION_TYPE_ROWS,
} from '@/__tests__/helpers/workspace-type-fixtures';

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

// Post-ID-29.7 SSR-hydration fix: WorkspacesContent requires the
// `initialApplicationTypes` seed (the rows the Server Component pre-fetches),
// threaded into useLauncherTypes() as initialData — same pattern as the
// sibling workspaces-content.test.tsx.
const SEED = SEED_APPLICATION_TYPE_ROWS;

describe('WorkspacesContent (launcher)', () => {
  beforeEach(() => {
    stubApplicationTypesFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the page heading and description', () => {
    render(<WorkspacesContent counts={{}} initialApplicationTypes={SEED} />, {
      wrapper: createQueryWrapper().Wrapper,
    });
    // Header is rendered on first paint regardless of hook state.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Workspaces' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Use your knowledge base to power different types of work.',
      ),
    ).toBeInTheDocument();
  });

  it('renders type cards for bid and proposal', async () => {
    render(<WorkspacesContent counts={{}} initialApplicationTypes={SEED} />, {
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: 'Procurements' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Sales Proposals' }),
    ).toBeInTheDocument();
  });

  it('shows correct count text for active procurements', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(
      <WorkspacesContent
        counts={{ procurement: 3 }}
        initialApplicationTypes={SEED}
      />,
      {
        wrapper: createQueryWrapper().Wrapper,
      },
    );
    await waitFor(() => {
      expect(screen.getByText('3 active procurements')).toBeInTheDocument();
    });
  });

  it('shows singular count text for 1 active procurement', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(
      <WorkspacesContent
        counts={{ procurement: 1 }}
        initialApplicationTypes={SEED}
      />,
      {
        wrapper: createQueryWrapper().Wrapper,
      },
    );
    await waitFor(() => {
      expect(screen.getByText('1 active procurement')).toBeInTheDocument();
    });
  });

  it('does not show count text when count is zero', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(
      <WorkspacesContent
        counts={{ procurement: 0 }}
        initialApplicationTypes={SEED}
      />,
      {
        wrapper: createQueryWrapper().Wrapper,
      },
    );
    await waitFor(() => {
      // Confirm the hook resolved
      expect(screen.getByText('Procurements')).toBeInTheDocument();
    });
    expect(screen.queryByText(/active procurement/)).not.toBeInTheDocument();
  });

  it('links the bid card to /bid', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(
      <WorkspacesContent
        counts={{ procurement: 5 }}
        initialApplicationTypes={SEED}
      />,
      {
        wrapper: createQueryWrapper().Wrapper,
      },
    );
    await waitFor(() => {
      const bidLink = screen.getByRole('link', {
        name: /Procurements/,
      });
      expect(bidLink).toHaveAttribute('href', '/procurement');
    });
  });

  it('marks coming soon cards as aria-disabled', async () => {
    render(<WorkspacesContent counts={{}} initialApplicationTypes={SEED} />, {
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Sales Proposals.*coming soon/),
      ).toBeInTheDocument();
    });
    const proposalCard = screen.getByLabelText(/Sales Proposals.*coming soon/);
    expect(proposalCard).toHaveAttribute('aria-disabled', 'true');
  });

  it('applies reduced opacity to coming soon cards', async () => {
    render(<WorkspacesContent counts={{}} initialApplicationTypes={SEED} />, {
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Sales Proposals.*coming soon/),
      ).toBeInTheDocument();
    });
    const proposalCard = screen.getByLabelText(/Sales Proposals.*coming soon/);
    expect(proposalCard.className).toContain('opacity-60');
  });

  it('shows "Coming soon" badge on unavailable types', async () => {
    render(<WorkspacesContent counts={{}} initialApplicationTypes={SEED} />, {
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      // Multiple 'Coming soon' badges exist (Sales Proposals + Intelligence Streams + 3 unrouted seed types)
      expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  it('does not render coming soon types as links', async () => {
    render(<WorkspacesContent counts={{}} initialApplicationTypes={SEED} />, {
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      expect(screen.getByText('Sales Proposals')).toBeInTheDocument();
    });
    // Proposal should not be a link
    const links = screen.getAllByRole('link');
    const proposalLinks = links.filter((l) =>
      l.textContent?.includes('Sales Proposals'),
    );
    expect(proposalLinks).toHaveLength(0);
  });
});
