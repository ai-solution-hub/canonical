/**
 * WorkspacesContent Component Tests
 *
 * Tests the workspaces launcher content component after the S110 rewrite.
 * The component now shows workspace type cards (Procurements, Sales Proposals,
 * Intelligence Streams) instead of individual workspace items.
 *
 * Post-ID-29.7: launcher consumes `useLauncherTypes()` (TanStack hook). Tests
 * wrap in a `QueryClientProvider` and stub `fetch` to return the 6
 * application_types seed rows. Assertions use `waitFor` because the hook
 * resolves asynchronously (~50ms in jsdom).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { WorkspacesContent } from '@/app/workspaces/workspaces-content';

// ---------------------------------------------------------------------------
// Hook fixture — 6 seed rows verbatim from GET /api/application-types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacesContent', () => {
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

  it('renders page description', () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
    // Header is rendered on first paint regardless of hook state.
    expect(
      screen.getByText(
        'Use your knowledge base to power different types of work.',
      ),
    ).toBeInTheDocument();
  });

  it('renders Bids type card with count', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 3 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(screen.getByText('Procurements')).toBeInTheDocument();
    });
    expect(screen.getByText('3 active procurements')).toBeInTheDocument();
  });

  it('renders Sales Proposals as coming soon', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Sales Proposals')).toBeInTheDocument();
    });
    // Multiple 'Coming soon' badges exist (Sales Proposals + Intelligence Streams +
    // the 3 non-rendered seed types — product_guide, competitor_research,
    // training_onboarding — all `available: false` from CLIENT_CONFIG default).
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(1);
  });

  it('links Bids card to /bid', async () => {
    render(<WorkspacesContent counts={{ procurement: 1 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /procurements/i });
      expect(link).toHaveAttribute('href', '/procurement');
    });
  });

  it('marks coming soon cards as aria-disabled', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Sales Proposals')).toBeInTheDocument();
    });
    const proposalCard = screen
      .getByText('Sales Proposals')
      .closest('[aria-disabled]');
    expect(proposalCard).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows singular "bid" for count of 1', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 1 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(screen.getByText('1 active procurement')).toBeInTheDocument();
    });
  });

  it('hides count text when count is 0 but includes in aria-label', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 0 }} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      // Confirm the hook resolved (Procurements card present)
      expect(screen.getByText('Procurements')).toBeInTheDocument();
    });
    // Count text is not rendered visually when 0
    expect(screen.queryByText('0 active procurements')).not.toBeInTheDocument();
    // But is present in the aria-label for accessibility
    const link = screen.getByRole('link', { name: /0 active procurements/i });
    expect(link).toBeInTheDocument();
  });
});
