/**
 * WorkspaceSubNav — admin gating for the Filter rules tab (S157 WP2, C6).
 *
 * Asserts that a viewer role does NOT see the "Filter rules" tab, while an
 * admin role DOES. Other tabs (Overview, Sources, Articles, Metrics,
 * Settings) must remain visible for every role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const { mockUseUserRole, mockUsePathname } = vi.hoisted(() => ({
  mockUseUserRole: vi.fn(),
  mockUsePathname: vi.fn(),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

// Import AFTER mocks
import { WorkspaceSubNav } from '@/components/intelligence/workspace-sub-nav';

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function configureViewer() {
  mockUseUserRole.mockReturnValue({
    role: 'viewer',
    canEdit: false,
    canAdmin: false,
    loading: false,
  });
}

function configureEditor() {
  mockUseUserRole.mockReturnValue({
    role: 'editor',
    canEdit: true,
    canAdmin: false,
    loading: false,
  });
}

function configureAdmin() {
  mockUseUserRole.mockReturnValue({
    role: 'admin',
    canEdit: true,
    canAdmin: true,
    loading: false,
  });
}

describe('WorkspaceSubNav — admin gating (S157 WP2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue(`/intelligence/${WORKSPACE_ID}`);
  });

  it('hides the Filter rules tab from viewers', () => {
    configureViewer();
    render(<WorkspaceSubNav workspaceId={WORKSPACE_ID} />);

    expect(screen.queryByText('Filter rules')).not.toBeInTheDocument();
    // Sanity: other tabs remain visible for viewers.
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Articles')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('hides the Filter rules tab from editors (admin-only per spec)', () => {
    configureEditor();
    render(<WorkspaceSubNav workspaceId={WORKSPACE_ID} />);

    expect(screen.queryByText('Filter rules')).not.toBeInTheDocument();
  });

  it('shows the Filter rules tab to admins', () => {
    configureAdmin();
    render(<WorkspaceSubNav workspaceId={WORKSPACE_ID} />);

    expect(screen.getByText('Filter rules')).toBeInTheDocument();
    // And all other tabs.
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Articles')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('hides the Filter rules tab while the role is still loading', () => {
    mockUseUserRole.mockReturnValue({
      role: null,
      canEdit: false,
      canAdmin: false,
      loading: true,
    });

    render(<WorkspaceSubNav workspaceId={WORKSPACE_ID} />);
    expect(screen.queryByText('Filter rules')).not.toBeInTheDocument();
  });
});
