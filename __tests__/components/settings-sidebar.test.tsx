/**
 * SettingsSidebar Component Tests
 *
 * Tests the desktop and mobile sidebar — group visibility for admin/non-admin,
 * active state highlighting, click handling, and conditional rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockOnSectionChange } = vi.hoisted(() => ({
  mockOnSectionChange: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

import {
  SettingsSidebar,
  SettingsMobileSidebar,
  getValidSection,
} from '@/components/settings/settings-sidebar';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsSidebar', () => {
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

    // All 9 section buttons should be present
    expect(within(nav).getByText('Profile')).toBeInTheDocument();
    expect(within(nav).getByText('Connections')).toBeInTheDocument();
    expect(within(nav).getByText('Content Organisation')).toBeInTheDocument();
    expect(within(nav).getByText('Organisations & People')).toBeInTheDocument();
    expect(within(nav).getByText('Guides')).toBeInTheDocument();
    expect(within(nav).getByText('Team')).toBeInTheDocument();
    expect(within(nav).getByText('Quality Review')).toBeInTheDocument();
    expect(within(nav).getByText('Activity')).toBeInTheDocument();
    expect(within(nav).getByText('Developer Setup')).toBeInTheDocument();
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

  it('falls back to profile for non-admin accessing admin section', () => {
    const result = getValidSection('team', false);
    expect(result).toBe('profile');
  });

  it('redirects legacy "integrations" param to "connections"', () => {
    const result = getValidSection('integrations', false);
    expect(result).toBe('connections');
  });

  it('redirects legacy "taxonomy" param to "content-organisation"', () => {
    const result = getValidSection('taxonomy', true);
    expect(result).toBe('content-organisation');
  });

  it('resolves "developer-setup" for admin users', () => {
    const result = getValidSection('developer-setup', true);
    expect(result).toBe('developer-setup');
  });

  it('falls back to profile for "developer-setup" when non-admin', () => {
    const result = getValidSection('developer-setup', false);
    expect(result).toBe('profile');
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
