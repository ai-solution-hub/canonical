/**
 * WorkspacesContent Component Tests
 *
 * Tests the workspaces page content: subtitle text, viewer empty state,
 * editor empty state, and ARIA attributes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockCanEdit, mockCanAdmin } = vi.hoisted(() => ({
  mockCanEdit: { value: false },
  mockCanAdmin: { value: false },
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: mockCanAdmin.value ? 'admin' : mockCanEdit.value ? 'editor' : 'viewer',
    loading: false,
    canEdit: mockCanEdit.value,
    canAdmin: mockCanAdmin.value,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/components/workspace-create-dialog', () => ({
  WorkspaceCreateDialog: () => null,
}));

vi.mock('@/components/workspace-detail-sheet', () => ({
  WorkspaceDetailSheet: () => null,
}));

vi.mock('@/lib/tablist-keyboard', () => ({
  handleTablistKeyDown: vi.fn(),
}));

import { WorkspacesContent } from '@/app/workspaces/workspaces-content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderContent(
  workspaces: Parameters<typeof WorkspacesContent>[0]['initialWorkspaces'] = [],
  counts: Parameters<typeof WorkspacesContent>[0]['initialCounts'] = {},
  loadError?: string,
) {
  return render(
    <WorkspacesContent
      initialWorkspaces={workspaces}
      initialCounts={counts}
      loadError={loadError}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacesContent', () => {
  beforeEach(() => {
    mockCanEdit.value = false;
    mockCanAdmin.value = false;
  });

  describe('subtitle', () => {
    it('displays "Bids and content collections." as subtitle', () => {
      renderContent();
      expect(screen.getByText('Bids and content collections.')).toBeInTheDocument();
    });

    it('does not display old subtitle text', () => {
      renderContent();
      expect(screen.queryByText('Manage your workspace collections.')).not.toBeInTheDocument();
    });
  });

  describe('viewer empty state', () => {
    it('shows viewer-appropriate message when no workspaces and user is viewer', () => {
      mockCanEdit.value = false;
      renderContent();
      expect(
        screen.getByText('No workspaces available. Contact your admin to get access.'),
      ).toBeInTheDocument();
    });

    it('does not show "Create Workspace" button for viewers', () => {
      mockCanEdit.value = false;
      renderContent();
      expect(screen.queryByText('Create Workspace')).not.toBeInTheDocument();
    });

    it('does not show "New Workspace" header button for viewers', () => {
      mockCanEdit.value = false;
      renderContent();
      expect(screen.queryByText('New Workspace')).not.toBeInTheDocument();
    });
  });

  describe('editor empty state', () => {
    it('shows editor-appropriate message with create button when user can edit', () => {
      mockCanEdit.value = true;
      renderContent();
      expect(
        screen.getByText(/No workspaces yet\. Create your first workspace/),
      ).toBeInTheDocument();
      expect(screen.getByText('Create Workspace')).toBeInTheDocument();
    });

    it('shows "New Workspace" header button for editors', () => {
      mockCanEdit.value = true;
      renderContent();
      expect(screen.getByText('New Workspace')).toBeInTheDocument();
    });
  });
});
