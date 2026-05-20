/**
 * WorkspaceCard Component Tests
 *
 * Tests the workspace card component: item count pill styling,
 * card structure, and accessibility.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

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

function makeWorkspace(
  overrides: Partial<WorkspaceWithCounts> = {},
): WorkspaceWithCounts {
  return {
    id: 'ws-1',
    name: 'Test Workspace',
    description: 'A test workspace',
    // Post-T2: workspace.type is sourced from application_types.key via JOIN.
    // Registry keys are 'procurement' (label 'Procurement'), 'intelligence', 'proposal'.
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
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCard', () => {
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

    it('shows badge label from registry for procurement type', () => {
      renderCard({ type: 'procurement' });
      expect(screen.getByText('Procurement')).toBeInTheDocument();
    });

    it('shows badge label from registry for intelligence type', () => {
      renderCard({ type: 'intelligence' });
      expect(screen.getByText('Intelligence Stream')).toBeInTheDocument();
    });

    it('shows no badge for unknown workspace type', () => {
      renderCard({ type: 'unknown_type' });
      expect(screen.queryByText('Procurement')).not.toBeInTheDocument();
      expect(screen.queryByText('Intelligence Stream')).not.toBeInTheDocument();
    });

    it('shows arrow icon for types with a route', () => {
      renderCard({ type: 'procurement' });
      expect(
        screen.getByTitle('Opens procurement detail page'),
      ).toBeInTheDocument();
    });

    it('does not show arrow icon for types without a route', () => {
      // 'proposal' is registered but has route: null (Coming Soon).
      renderCard({ type: 'proposal' });
      expect(
        screen.queryByTitle(/Opens .* detail page/),
      ).not.toBeInTheDocument();
    });
  });
});
