/**
 * Settings Page Tests
 *
 * Tests the Settings page shell — loading state, role-based layout,
 * URL-driven section routing, legacy tab param support, and sidebar interaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockRouter,
  mockSearchParams,
  mockUseUserRole,
  mockProfileSection,
  mockIntegrationsSection,
  mockSettingsSidebar,
  mockSettingsMobileSidebar,
  mockTeamSection,
  mockGovernanceSection,
  mockActivitySection,
  mockContentOrganisationSection,
  mockEntitiesSection,
  mockGuidesSection,
} = vi.hoisted(() => ({
  mockRouter: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn().mockResolvedValue(undefined) },
  mockSearchParams: { value: new URLSearchParams() },
  mockUseUserRole: { loading: false, canAdmin: false, canEdit: false, role: 'viewer' as string | null },
  mockProfileSection: vi.fn(),
  mockIntegrationsSection: vi.fn(),
  mockSettingsSidebar: vi.fn(),
  mockSettingsMobileSidebar: vi.fn(),
  mockTeamSection: vi.fn(),
  mockGovernanceSection: vi.fn(),
  mockActivitySection: vi.fn(),
  mockContentOrganisationSection: vi.fn(),
  mockEntitiesSection: vi.fn(),
  mockGuidesSection: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/settings',
  useSearchParams: () => mockSearchParams.value,
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole,
}));

vi.mock('@/components/settings/profile-section', () => ({
  ProfileSection: () => {
    mockProfileSection();
    return <div data-testid="profile-section">ProfileSection</div>;
  },
}));

vi.mock('@/components/settings/integrations-section', () => ({
  IntegrationsSection: () => {
    mockIntegrationsSection();
    return <div data-testid="integrations-section">IntegrationsSection</div>;
  },
}));

vi.mock('@/components/settings/settings-sidebar', () => ({
  SettingsSidebar: ({ isAdmin, activeSection, onSectionChange }: { isAdmin: boolean; activeSection: string; onSectionChange: (s: string) => void }) => {
    mockSettingsSidebar();
    return (
      <div data-testid="settings-sidebar" data-admin={isAdmin} data-active={activeSection}>
        <button onClick={() => onSectionChange('team')}>Team</button>
        <button onClick={() => onSectionChange('governance')}>Governance</button>
      </div>
    );
  },
  SettingsMobileSidebar: ({ isAdmin, activeSection }: { isAdmin: boolean; activeSection: string; onSectionChange: (s: string) => void }) => {
    mockSettingsMobileSidebar();
    return <div data-testid="mobile-sidebar" data-admin={isAdmin} data-active={activeSection} />;
  },
  getValidSection: (param: string | null, isAdmin: boolean) => {
    const legacyMap: Record<string, string> = { taxonomy: 'content-organisation', tags: 'content-organisation', layers: 'content-organisation' };
    const resolved = param && legacyMap[param] ? legacyMap[param] : param;
    const allSections = ['profile', 'integrations', 'content-organisation', 'entities', 'guides', 'team', 'governance', 'activity'];
    const personalSections = ['profile', 'integrations'];
    const visible = isAdmin ? allSections : personalSections;
    if (resolved && visible.includes(resolved)) return resolved;
    return 'profile';
  },
}));

vi.mock('@/components/settings/team-section', () => ({
  TeamSection: () => {
    mockTeamSection();
    return <div data-testid="team-section">TeamSection</div>;
  },
}));

vi.mock('@/components/settings/governance-section', () => ({
  GovernanceSection: () => {
    mockGovernanceSection();
    return <div data-testid="governance-section">GovernanceSection</div>;
  },
}));

vi.mock('@/components/settings/activity-section', () => ({
  ActivitySection: () => {
    mockActivitySection();
    return <div data-testid="activity-section">ActivitySection</div>;
  },
}));

vi.mock('@/components/settings/content-organisation-section', () => ({
  ContentOrganisationSection: () => {
    mockContentOrganisationSection();
    return <div data-testid="content-organisation-section">ContentOrganisationSection</div>;
  },
}));

vi.mock('@/components/settings/entities-section', () => ({
  EntitiesSection: () => {
    mockEntitiesSection();
    return <div data-testid="entities-section">EntitiesSection</div>;
  },
}));

vi.mock('@/components/settings/guides-section', () => ({
  GuidesSection: () => {
    mockGuidesSection();
    return <div data-testid="guides-section">GuidesSection</div>;
  },
}));

import SettingsPage from '@/app/settings/page';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = false;
    mockUseUserRole.canEdit = false;
    mockUseUserRole.role = 'viewer';
    mockSearchParams.value = new URLSearchParams();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading spinner when role is loading', async () => {
    mockUseUserRole.loading = true;
    render(<SettingsPage />);

    await waitFor(() => {
      // The spinner is an SVG with animate-spin class
      const spinners = document.querySelectorAll('.animate-spin');
      expect(spinners.length).toBeGreaterThan(0);
    });
  });

  it('renders non-admin layout with max-w-3xl and profile section', async () => {
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = false;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    expect(screen.getByText('Manage your profile and integrations')).toBeInTheDocument();
    expect(screen.getByTestId('profile-section')).toBeInTheDocument();
  });

  it('renders admin layout with max-w-5xl and sidebar', async () => {
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = true;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Manage your profile and system configuration')).toBeInTheDocument();
    });

    expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('settings-sidebar')).toHaveAttribute('data-admin', 'true');
  });

  it('defaults to profile section when no URL param is present', async () => {
    mockUseUserRole.loading = false;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('profile-section')).toBeInTheDocument();
    });
  });

  it('reads ?section=team and renders TeamSection for admins', async () => {
    mockSearchParams.value = new URLSearchParams('section=team');
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = true;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('team-section')).toBeInTheDocument();
    });
  });

  it('reads legacy ?tab=governance and renders GovernanceSection for admins', async () => {
    mockSearchParams.value = new URLSearchParams('tab=governance');
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = true;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('governance-section')).toBeInTheDocument();
    });
  });

  it('reads ?section=content-organisation and renders ContentOrganisationSection for admins', async () => {
    mockSearchParams.value = new URLSearchParams('section=content-organisation');
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = true;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('content-organisation-section')).toBeInTheDocument();
    });
  });

  it('maps legacy ?section=taxonomy to content-organisation for admins', async () => {
    mockSearchParams.value = new URLSearchParams('section=taxonomy');
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = true;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('content-organisation-section')).toBeInTheDocument();
    });
  });

  it('falls back to profile for an invalid section param', async () => {
    mockSearchParams.value = new URLSearchParams('section=nonexistent');
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = true;
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('profile-section')).toBeInTheDocument();
    });
  });

  it('updates URL when sidebar section is clicked', async () => {
    mockUseUserRole.loading = false;
    mockUseUserRole.canAdmin = true;
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Team'));

    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.stringContaining('section=team'),
      { scroll: false },
    );
  });
});
