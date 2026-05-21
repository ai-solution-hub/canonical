/**
 * Workspaces Launcher Tests
 *
 * Tests the WorkspacesContent launcher component that replaced the old
 * workspace grid. Verifies type cards render correctly, counts display,
 * coming soon cards, accessibility landmarks, and keyboard navigation.
 *
 * Post-ID-29.7: launcher consumes `useLauncherTypes()` (TanStack hook). Tests
 * wrap in a `QueryClientProvider` and stub `fetch` to return the 6
 * application_types seed rows.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const SEED_ROWS_SNAKE = [
  {
    key: 'procurement',
    label: 'Procurement',
    label_plural: 'Procurements',
    description:
      'Manage bid responses and tender submissions using your knowledge base',
    default_icon: 'briefcase',
    default_colour: '#d4880f',
  },
  {
    key: 'intelligence',
    label: 'Intelligence Stream',
    label_plural: 'Intelligence Streams',
    description:
      'Sector and competitor news feeds tailored to your company profile.',
    default_icon: 'newspaper',
    default_colour: '#059669',
  },
  {
    key: 'sales_proposal',
    label: 'Sales Proposal',
    label_plural: 'Sales Proposals',
    description:
      'Draft and manage sales proposals drawing on your knowledge base',
    default_icon: 'file-signature',
    default_colour: '#0d9488',
  },
  {
    key: 'product_guide',
    label: 'Product Guide',
    label_plural: 'Product Guides',
    description: 'Product Guide',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'competitor_research',
    label: 'Competitor Research',
    label_plural: 'Competitor Researchs',
    description: 'Competitor Research',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'training_onboarding',
    label: 'Training Onboarding',
    label_plural: 'Training Onboardings',
    description: 'Training Onboarding',
    default_icon: null,
    default_colour: null,
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('WorkspacesContent (launcher)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        url,
        json: async () => SEED_ROWS_SNAKE,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the page heading and description', () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
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
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
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
    render(<WorkspacesContent counts={{ procurement: 3 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(screen.getByText('3 active procurements')).toBeInTheDocument();
    });
  });

  it('shows singular count text for 1 active procurement', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 1 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(screen.getByText('1 active procurement')).toBeInTheDocument();
    });
  });

  it('does not show count text when count is zero', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 0 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      // Confirm the hook resolved
      expect(screen.getByText('Procurements')).toBeInTheDocument();
    });
    expect(screen.queryByText(/active procurement/)).not.toBeInTheDocument();
  });

  it('links the bid card to /bid', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 5 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      const bidLink = screen.getByRole('link', {
        name: /Procurements/,
      });
      expect(bidLink).toHaveAttribute('href', '/procurement');
    });
  });

  it('marks coming soon cards as aria-disabled', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Sales Proposals.*coming soon/),
      ).toBeInTheDocument();
    });
    const proposalCard = screen.getByLabelText(/Sales Proposals.*coming soon/);
    expect(proposalCard).toHaveAttribute('aria-disabled', 'true');
  });

  it('applies reduced opacity to coming soon cards', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Sales Proposals.*coming soon/),
      ).toBeInTheDocument();
    });
    const proposalCard = screen.getByLabelText(/Sales Proposals.*coming soon/);
    expect(proposalCard.className).toContain('opacity-60');
  });

  it('shows "Coming soon" badge on unavailable types', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
    await waitFor(() => {
      // Multiple 'Coming soon' badges exist (Sales Proposals + Intelligence Streams + 3 unrouted seed types)
      expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does not render coming soon types as links', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
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
