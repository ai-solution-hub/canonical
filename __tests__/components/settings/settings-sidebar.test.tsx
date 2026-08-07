/**
 * SettingsSidebar Component Tests
 *
 * Covers the desktop and mobile sidebar:
 * - `getValidSection` resolution — unknown, retired, and legacy-redirect params
 * - Group visibility and nav entry counts for admin vs non-admin
 * - Active-section highlighting, click handling, and Provenance navigation
 *
 * Merged from the former `__tests__/components/settings-sidebar.test.tsx`,
 * which tested the same production component
 * (`components/settings/settings-sidebar.tsx`) from a second location. The two
 * files carried largely disjoint coverage, so both sets are retained here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockOnSectionChange, mockRouterPush } = vi.hoisted(() => ({
  mockOnSectionChange: vi.fn(),
  mockRouterPush: vi.fn(),
}));

// SidebarNav uses useRouter + usePathname; the mobile trigger reads
// useSearchParams.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

import {
  SettingsSidebar,
  SettingsMobileSidebar,
  getValidSection,
} from '@/components/settings/settings-sidebar';

// ---------------------------------------------------------------------------
// getValidSection — section resolution
// ---------------------------------------------------------------------------

describe('getValidSection — unknown and retired sections', () => {
  it('falls back to profile for unknown sections regardless of role', () => {
    expect(getValidSection('unknown-section', true)).toBe('profile');
    expect(getValidSection('unknown-section', false)).toBe('profile');
  });

  it('falls back to profile for the retired reviewer-assignments section (id-420)', () => {
    expect(getValidSection('reviewer-assignments', true)).toBe('profile');
    expect(getValidSection('reviewer-assignments', false)).toBe('profile');
  });

  it('falls back to "profile" for the retired "taxonomy" param', () => {
    expect(getValidSection('taxonomy', true)).toBe('profile');
  });

  it('falls back to profile for non-admin accessing an admin section', () => {
    expect(getValidSection('team', false)).toBe('profile');
  });
});

describe('getValidSection — legacy redirects', () => {
  it('maps legacy developer-setup to connections for admin users', () => {
    expect(getValidSection('developer-setup', true)).toBe('connections');
  });

  it('maps legacy developer-setup to connections for non-admin users', () => {
    expect(getValidSection('developer-setup', false)).toBe('connections');
  });

  it('redirects legacy "integrations" param to "connections"', () => {
    expect(getValidSection('integrations', false)).toBe('connections');
  });
});

// ---------------------------------------------------------------------------
// SettingsSidebar — group visibility, entry counts, and labels
// ---------------------------------------------------------------------------

describe('SettingsSidebar — group and entry visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows all three groups for admin users', () => {
    render(
      <SettingsSidebar
        isAdmin={true}
        activeSection="profile"
        onSectionChange={mockOnSectionChange}
      />,
    );

    const nav = screen.getAllByLabelText('Settings navigation')[0];
    expect(within(nav).getByText('Personal')).toBeInTheDocument();
    expect(within(nav).getByText('Content Management')).toBeInTheDocument();
    expect(within(nav).getByText('System')).toBeInTheDocument();

    // All section buttons should be present
    expect(within(nav).getByText('Profile')).toBeInTheDocument();
    expect(within(nav).getByText('Connections')).toBeInTheDocument();
    expect(within(nav).getByText('Content Owners')).toBeInTheDocument();
    expect(within(nav).getByText('Organisations & People')).toBeInTheDocument();
    expect(within(nav).getByText('Guides')).toBeInTheDocument();
    expect(within(nav).getByText('Team')).toBeInTheDocument();
    expect(within(nav).getByText('Quality Review')).toBeInTheDocument();
    expect(within(nav).getByText('Provenance')).toBeInTheDocument();
  });

  it('shows only Personal group for non-admin users', () => {
    render(
      <SettingsSidebar
        isAdmin={false}
        activeSection="profile"
        onSectionChange={mockOnSectionChange}
      />,
    );

    const nav = screen.getAllByLabelText('Settings navigation')[0];
    expect(within(nav).getByText('Personal')).toBeInTheDocument();
    expect(within(nav).getByText('Profile')).toBeInTheDocument();
    expect(within(nav).getByText('Connections')).toBeInTheDocument();

    // Admin-only groups should not be present
    expect(
      within(nav).queryByText('Content Management'),
    ).not.toBeInTheDocument();
    expect(within(nav).queryByText('System')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Team')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Developer Setup')).not.toBeInTheDocument();
  });

  it('renders 10 nav entries for admin users (no Developer Setup; includes Organisation + Tag Morphology; Content Organisation retired with the taxonomy/layers admin surface; Reviewer Assignments retired into id-420)', () => {
    render(
      <SettingsSidebar
        isAdmin
        activeSection="profile"
        onSectionChange={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', {
      name: 'Settings navigation',
    });
    const buttons = nav.querySelectorAll('button');
    expect(buttons).toHaveLength(10);
  });

  it('renders 2 nav entries for non-admin users (Profile + Connections)', () => {
    render(
      <SettingsSidebar
        isAdmin={false}
        activeSection="profile"
        onSectionChange={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', {
      name: 'Settings navigation',
    });
    const buttons = nav.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
  });

  it('does not have a Developer Setup entry for admin users', () => {
    // Removed in P1-20 — content folded into the admin-only "For developers"
    // accordion inside Connections.
    render(
      <SettingsSidebar
        isAdmin
        activeSection="profile"
        onSectionChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Developer Setup')).not.toBeInTheDocument();
  });

  it('does not have a Reviewer Assignments entry for admin users (retired into id-420)', () => {
    render(
      <SettingsSidebar
        isAdmin
        activeSection="profile"
        onSectionChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Reviewer Assignments')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SettingsSidebar — active state and interaction
// ---------------------------------------------------------------------------

describe('SettingsSidebar — active state and interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('highlights the active section with aria-current="page"', () => {
    render(
      <SettingsSidebar
        isAdmin={true}
        activeSection="team"
        onSectionChange={mockOnSectionChange}
      />,
    );

    const teamButton = screen.getByText('Team').closest('button');
    expect(teamButton).toHaveAttribute('aria-current', 'page');

    const profileButton = screen.getByText('Profile').closest('button');
    expect(profileButton).not.toHaveAttribute('aria-current');
  });

  it('calls onSectionChange when a section is clicked', async () => {
    const user = userEvent.setup();
    render(
      <SettingsSidebar
        isAdmin={true}
        activeSection="profile"
        onSectionChange={mockOnSectionChange}
      />,
    );

    await user.click(screen.getByText('Quality Review'));
    expect(mockOnSectionChange).toHaveBeenCalledWith('governance');
  });

  it('navigates to /provenance when Provenance is clicked', async () => {
    const user = userEvent.setup();
    render(
      <SettingsSidebar
        isAdmin={true}
        activeSection="profile"
        onSectionChange={mockOnSectionChange}
      />,
    );

    await user.click(screen.getByText('Provenance'));
    expect(mockRouterPush).toHaveBeenCalledWith('/provenance');
    expect(mockOnSectionChange).not.toHaveBeenCalled();
  });
});

describe('SettingsMobileSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders trigger button showing active section label for admin', async () => {
    const user = userEvent.setup();
    render(
      <SettingsMobileSidebar
        isAdmin={true}
        activeSection="governance"
        onSectionChange={mockOnSectionChange}
      />,
    );

    const triggerButton = screen.getByRole('button', {
      name: /Quality Review/i,
    });
    expect(triggerButton).toBeInTheDocument();

    await user.click(triggerButton);

    const nav = screen.getAllByLabelText('Settings navigation')[0];
    expect(nav).toBeInTheDocument();
  });
});
