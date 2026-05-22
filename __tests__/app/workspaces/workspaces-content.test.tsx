/**
 * WorkspacesContent Component Tests
 *
 * Tests the workspaces launcher content component after the S110 rewrite.
 * The component now shows workspace type cards (Procurements, Sales Proposals,
 * Intelligence Streams) instead of individual workspace items.
 *
 * Post-ID-29.7: launcher consumes `useLauncherTypes()` (TanStack hook). Tests
 * wrap in a `QueryClientProvider` (via `createQueryWrapper()`) and stub
 * `fetch` (via `stubApplicationTypesFetch()`) to return the 6
 * application_types seed rows. Assertions use `waitFor` because the hook
 * resolves asynchronously (~50ms in jsdom).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { WorkspacesContent } from '@/app/workspaces/workspaces-content';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { stubApplicationTypesFetch } from '@/__tests__/helpers/workspace-type-fixtures';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacesContent', () => {
  beforeEach(() => {
    stubApplicationTypesFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders page description', () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createQueryWrapper().Wrapper });
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
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      expect(screen.getByText('Procurements')).toBeInTheDocument();
    });
    expect(screen.getByText('3 active procurements')).toBeInTheDocument();
  });

  it('renders Sales Proposals as coming soon', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createQueryWrapper().Wrapper });
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
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /procurements/i });
      expect(link).toHaveAttribute('href', '/procurement');
    });
  });

  it('marks coming soon cards as aria-disabled', async () => {
    render(<WorkspacesContent counts={{}} />, { wrapper: createQueryWrapper().Wrapper });
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
      wrapper: createQueryWrapper().Wrapper,
    });
    await waitFor(() => {
      expect(screen.getByText('1 active procurement')).toBeInTheDocument();
    });
  });

  it('hides count text when count is 0 but includes in aria-label', async () => {
    // Post-T2: counts key is the application_types.key ('procurement', not 'bid')
    render(<WorkspacesContent counts={{ procurement: 0 }} />, {
      wrapper: createQueryWrapper().Wrapper,
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
