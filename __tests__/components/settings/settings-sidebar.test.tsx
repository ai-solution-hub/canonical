/**
 * SettingsSidebar Component Tests
 *
 * Covers admin gating + section resolution for reviewer-assignments entry
 * (P0-7 WP3). Also regression-guards the System-group nav position.
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
// getValidSection — reviewer-assignments resolution
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
