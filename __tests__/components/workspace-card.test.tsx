/**
 * WorkspaceCard Component Tests
 *
 * Tests the workspace card component: item count pill styling,
 * card structure, and accessibility.
 *
 * Post-ID-29.7: workspace-card consumes `useWorkspaceType()` (TanStack hook).
 * Tests wrap renders in a `QueryClientProvider` and stub `fetch` to return
 * the 6 application_types seed rows verbatim (snake_case). The hook's
 * `select:` callback normalises to camelCase and joins the static client
 * config — see hooks/workspaces/use-application-types.ts.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/format', () => ({
  formatRelativeDate: (date: string) => date,
}));

import {
  WorkspaceCard,
  type WorkspaceWithCounts,
} from '@/components/workspace/workspace-card';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The 6 seed rows returned by GET /api/application-types (snake_case).
 * Matches the fixture used in __tests__/hooks/workspaces/use-application-types.test.ts
 * so the hook's `select:` selector produces the same WorkspaceTypeConfig
 * shape the static registry used to provide synchronously.
 */
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

function makeWorkspace(
  overrides: Partial<WorkspaceWithCounts> = {},
): WorkspaceWithCounts {
  return {
    id: 'ws-1',
    name: 'Test Workspace',
    description: 'A test workspace',
    // Post-T2: workspace.type is sourced from application_types.key via JOIN.
    // Registry keys are 'procurement' (label 'Procurement'), 'intelligence', 'sales_proposal'.
    type: 'procurement',
    status: 'active',
    icon: 'folder',
    color: '#3b82f6',
    is_archived: false,
    domain_metadata: null,
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'user-1',
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: null,
    item_count: 5,
    last_activity: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<WorkspaceWithCounts> = {},
  readOnly = false,
) {
  const workspace = makeWorkspace(overrides);
  return render(
    <WorkspaceCard
      workspace={workspace}
      onEdit={vi.fn()}
      onArchiveToggle={vi.fn()}
      readOnly={readOnly}
    />,
    { wrapper: createWrapper() },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCard', () => {
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

  describe('item count pill', () => {
    it('renders item count as a link', () => {
      renderCard({ item_count: 12 });
      const link = screen.getByText('12 items');
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe('A');
    });

    it('uses warm primary styling on item count pill', () => {
      renderCard({ item_count: 3 });
      const pill = screen.getByText('3 items');
      expect(pill.className).toContain('bg-primary/10');
      expect(pill.className).toContain('text-primary');
      expect(pill.className).toContain('font-medium');
    });

    it('shows singular "item" for count of 1', () => {
      renderCard({ item_count: 1 });
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });

    it('shows plural "items" for count of 0', () => {
      renderCard({ item_count: 0 });
      expect(screen.getByText('0 items')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has aria-label on the workspace open button', () => {
      renderCard({ name: 'My Procurement' });
      expect(screen.getByLabelText('Open My Procurement')).toBeInTheDocument();
    });
  });

  describe('card structure', () => {
    it('renders workspace name', () => {
      renderCard({ name: 'Alpha Procurement' });
      expect(screen.getByText('Alpha Procurement')).toBeInTheDocument();
    });

    it('renders workspace description', () => {
      renderCard({ description: 'Procurement for council contract' });
      expect(
        screen.getByText('Procurement for council contract'),
      ).toBeInTheDocument();
    });

    it('shows badge label from registry for procurement type', async () => {
      renderCard({ type: 'procurement' });
      await waitFor(() => {
        expect(screen.getByText('Procurement')).toBeInTheDocument();
      });
    });

    it('shows badge label from registry for intelligence type', async () => {
      renderCard({ type: 'intelligence' });
      // Hook resolves with DB label 'Intelligence Stream'
      await waitFor(() => {
        expect(screen.getByText('Intelligence Stream')).toBeInTheDocument();
      });
    });

    it('shows no badge for unknown workspace type', async () => {
      renderCard({ type: 'unknown_type' });
      // Allow hook to resolve, then assert badge absent (typeConfig is undefined)
      await waitFor(() => {
        // Wait until at least one render after fetch resolves
        expect(global.fetch).toHaveBeenCalled();
      });
      expect(screen.queryByText('Procurement')).not.toBeInTheDocument();
      expect(screen.queryByText('Intelligence Stream')).not.toBeInTheDocument();
    });

    it('shows arrow icon for types with a route', async () => {
      renderCard({ type: 'procurement' });
      await waitFor(() => {
        expect(
          screen.getByTitle('Opens procurement detail page'),
        ).toBeInTheDocument();
      });
    });

    it('does not show arrow icon for types without a route', async () => {
      // Post-ID-29.7: DB seed key is 'sales_proposal' (CLIENT_CONFIG.sales_proposal
      // has route: null, available: false). The static registry's legacy 'proposal'
      // key no longer exists in the DB.
      renderCard({ type: 'sales_proposal' });
      await waitFor(() => {
        // Confirm the hook resolved (sales_proposal label appears in the badge)
        expect(screen.getByText('Sales Proposal')).toBeInTheDocument();
      });
      expect(
        screen.queryByTitle(/Opens .* detail page/),
      ).not.toBeInTheDocument();
    });
  });
});
