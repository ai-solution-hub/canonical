/**
 * SettingsSidebar Component Tests
 *
 * Covers:
 * - Unknown/retired section resolution falls back to profile
 * - P1-20: Developer Setup sidebar entry removed; legacy deep-link redirects to connections
 * - Sidebar nav entry count for admin vs non-admin
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SettingsSidebar,
  getValidSection,
} from '@/components/settings/settings-sidebar';

// ---------------------------------------------------------------------------
// Mock next/navigation (SidebarNav uses useRouter + usePathname)
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings',
}));

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
});

describe('getValidSection — developer-setup legacy redirect', () => {
  it('maps legacy developer-setup to connections for admin users', () => {
    expect(getValidSection('developer-setup', true)).toBe('connections');
  });

  it('maps legacy developer-setup to connections for non-admin users', () => {
    expect(getValidSection('developer-setup', false)).toBe('connections');
  });
});

// ---------------------------------------------------------------------------
// SettingsSidebar — nav entry count and labels
// ---------------------------------------------------------------------------

describe('SettingsSidebar — nav entry count', () => {
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
