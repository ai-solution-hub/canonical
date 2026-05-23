/**
 * WorkspaceCard Component Tests
 *
 * Tests the workspace card component: item count pill styling,
 * card structure, and accessibility.
 *
 * Post-ID-29.7: workspace-card consumes `useWorkspaceType()` (TanStack hook).
 * Tests wrap renders in a `QueryClientProvider` (via the project-wide
 * `createQueryWrapper()` helper) and stub `fetch` (via
 * `stubApplicationTypesFetch()`) to return the 6 application_types seed rows
 * verbatim (snake_case). The hook's `select:` callback normalises to
 * camelCase and joins the static client config — see
 * `hooks/workspaces/use-application-types.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/format', () => ({
  formatRelativeDate: (date: string) => date,
}));

import {
  WorkspaceCard,
  type WorkspaceWithCounts,
} from '@/components/workspace/workspace-card';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { stubApplicationTypesFetch } from '@/__tests__/helpers/workspace-type-fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const { Wrapper } = createQueryWrapper();
  return render(
    <WorkspaceCard
      workspace={workspace}
      onEdit={vi.fn()}
      onArchiveToggle={vi.fn()}
      readOnly={readOnly}
    />,
    { wrapper: Wrapper },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCard', () => {
  let mockFetch: ReturnType<typeof stubApplicationTypesFetch>;

  beforeEach(() => {
    mockFetch = stubApplicationTypesFetch();
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
      // The hook resolves with `typeConfig === undefined` for unknown keys,
      // producing no observable DOM transition (no badge appears at any
      // point). Wait for the fetch to fire so we know the hook's loading
      // phase has progressed past first paint, then assert absent.
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
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
