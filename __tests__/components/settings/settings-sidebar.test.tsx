/**
 * SettingsSidebar Component Tests
 *
 * Covers:
 * - Admin gating + section resolution for reviewer-assignments entry (P0-7 WP3)
 * - System-group nav position regression guard
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

describe('getValidSection — reviewer-assignments', () => {
  it('returns reviewer-assignments for admin users', () => {
    expect(getValidSection('reviewer-assignments', true)).toBe(
      'reviewer-assignments',
    );
  });

  it('falls back to profile for non-admin users', () => {
    expect(getValidSection('reviewer-assignments', false)).toBe('profile');
  });

  it('falls back to profile for unknown sections regardless of role', () => {
    expect(getValidSection('unknown-section', true)).toBe('profile');
    expect(getValidSection('unknown-section', false)).toBe('profile');
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
  it('renders 10 nav entries for admin users (no Developer Setup)', () => {
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
});

// ---------------------------------------------------------------------------
// SettingsSidebar — admin gating of reviewer-assignments entry
// ---------------------------------------------------------------------------

describe('SettingsSidebar — reviewer-assignments nav entry', () => {
  it('renders the entry for admin users', () => {
    render(
      <SettingsSidebar
        isAdmin
        activeSection="profile"
        onSectionChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Reviewer Assignments')).toBeInTheDocument();
  });

  it('hides the entry from non-admin users', () => {
    render(
      <SettingsSidebar
        isAdmin={false}
        activeSection="profile"
        onSectionChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Reviewer Assignments')).not.toBeInTheDocument();
  });

  it('places the entry in the System group between Quality Review and Provenance', () => {
    render(
      <SettingsSidebar
        isAdmin
        activeSection="profile"
        onSectionChange={vi.fn()}
      />,
    );

    const systemGroup = screen.getByRole('group', { name: 'System' });
    const buttons = systemGroup.querySelectorAll('button');
    const labels = Array.from(buttons).map((b) => b.textContent?.trim() ?? '');

    const qualityIdx = labels.indexOf('Quality Review');
    const assignmentsIdx = labels.indexOf('Reviewer Assignments');
    const provenanceIdx = labels.indexOf('Provenance');

    expect(qualityIdx).toBeGreaterThanOrEqual(0);
    expect(assignmentsIdx).toBe(qualityIdx + 1);
    expect(provenanceIdx).toBe(assignmentsIdx + 1);
  });
});
