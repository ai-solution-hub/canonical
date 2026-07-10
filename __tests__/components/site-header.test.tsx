/**
 * SiteHeader Component Tests
 *
 * Tests the SiteHeader component against the id-118 three-zone nav IA
 * (DR-041): desktop zone disclosures (DropdownMenu), mobile labelled zone
 * sections, role gating (BI-20/BI-21), active-state + a11y (BI-23/24/25),
 * and non-regression of the persistent search box / settings / sign-out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRouter, mockPathname, mockUserRole } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockPathname: { value: '/' },
  mockUserRole: {
    role: 'editor' as string | null,
    loading: false,
    canEdit: true,
    canAdmin: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname.value,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole,
}));

// Stub complex child components to isolate SiteHeader logic
vi.mock('@/components/browse/search-bar', () => ({
  SearchBar: ({ variant }: { variant?: string }) => (
    <div data-testid="search-bar" data-variant={variant}>
      Search Bar
    </div>
  ),
}));

vi.mock('@/components/shell/theme-settings', () => ({
  ThemeSettings: () => <div data-testid="theme-settings">ThemeSettings</div>,
}));

vi.mock('@/components/shell/sign-out-button', () => ({
  SignOutButton: ({ variant }: { variant?: string }) => (
    <div data-testid={`sign-out-button-${variant ?? 'desktop'}`}>
      SignOutButton
    </div>
  ),
}));

// Import AFTER mocks
import { SiteHeader } from '@/components/shell/site-header';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEGACY_LABELS = ['Workspaces', 'Bids', 'Browse', 'Q&A Library'];

/**
 * Radix DropdownMenu.Content renders into a portal and is unmounted until
 * the trigger is activated (jsdom applies no CSS, so `hidden`/breakpoint
 * classes are meaningless — the portal element is the ground truth). Click
 * the named zone trigger in the desktop nav and return its content portal.
 */
async function openDesktopZone(
  user: ReturnType<typeof userEvent.setup>,
  zoneHeader: 'Applications' | 'Knowledge' | 'Governance',
): Promise<HTMLElement> {
  const nav = screen.getByLabelText('Main navigation');
  const trigger = within(nav).getByRole('button', { name: zoneHeader });
  await user.click(trigger);
  const content = document.querySelector('[data-slot="dropdown-menu-content"]');
  if (!content) {
    throw new Error(`Dropdown content not found for zone "${zoneHeader}"`);
  }
  return content as HTMLElement;
}

describe('SiteHeader', () => {
  beforeEach(() => {
    mockPathname.value = '/';
    mockUserRole.role = 'editor';
    mockUserRole.loading = false;
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = false;
    mockRouter.push.mockClear();
  });

  it('renders the site title as a link to home', () => {
    render(<SiteHeader />);
    const homeLink = screen.getByText('Canonical');
    expect(homeLink).toBeInTheDocument();
    expect(homeLink.closest('a')).toHaveAttribute('href', '/');
  });

  // ── id-118 (DR-041): three zone headers on the desktop bar ──

  it('renders exactly the three ratified zone headers on the desktop bar', () => {
    render(<SiteHeader />);
    const nav = screen.getByLabelText('Main navigation');
    expect(
      within(nav).getByRole('button', { name: 'Applications' }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole('button', { name: 'Knowledge' }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole('button', { name: 'Governance' }),
    ).toBeInTheDocument();
  });

  it('never renders legacy IMS-era labels (BI-16)', () => {
    render(<SiteHeader />);
    for (const label of LEGACY_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('lists the Applications zone members for an editor', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const content = await openDesktopZone(user, 'Applications');
    expect(within(content).getByText('Procurement')).toBeInTheDocument();
    expect(within(content).getByText('Intelligence')).toBeInTheDocument();
  });

  it('lists the Knowledge zone members and never lists the reserved Concepts entry (BI-8)', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const content = await openDesktopZone(user, 'Knowledge');
    expect(within(content).getByText('Search')).toBeInTheDocument();
    expect(within(content).getByText('Answers')).toBeInTheDocument();
    expect(within(content).getByText('External sources')).toBeInTheDocument();
    expect(within(content).queryByText('Concepts')).not.toBeInTheDocument();
  });

  it('routes Search to /search and External sources to /reference', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const content = await openDesktopZone(user, 'Knowledge');
    expect(within(content).getByText('Search').closest('a')).toHaveAttribute(
      'href',
      '/search',
    );
    expect(
      within(content).getByText('External sources').closest('a'),
    ).toHaveAttribute('href', '/reference');
  });

  it('lists the Governance zone members for an editor (Provenance excluded — admin only)', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const content = await openDesktopZone(user, 'Governance');
    expect(within(content).getByText('Review')).toBeInTheDocument();
    expect(within(content).getByText('Coverage')).toBeInTheDocument();
    expect(within(content).getByText('Change reports')).toBeInTheDocument();
    expect(within(content).getByText('Activity')).toBeInTheDocument();
    expect(within(content).queryByText('Provenance')).not.toBeInTheDocument();
  });

  it('shows Provenance in the Governance zone for an admin', async () => {
    const user = userEvent.setup();
    mockUserRole.role = 'admin';
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = true;
    render(<SiteHeader />);
    const content = await openDesktopZone(user, 'Governance');
    expect(within(content).getByText('Provenance')).toBeInTheDocument();
  });

  // ── BI-20: Knowledge zone is role-uniform ──

  it('shows the full Knowledge zone to a viewer (BI-20 role-uniform)', async () => {
    const user = userEvent.setup();
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    render(<SiteHeader />);
    const content = await openDesktopZone(user, 'Knowledge');
    expect(within(content).getByText('Search')).toBeInTheDocument();
    expect(within(content).getByText('Answers')).toBeInTheDocument();
    expect(within(content).getByText('External sources')).toBeInTheDocument();
  });

  // ── BI-21: existing per-entry gating preserved elsewhere ──

  it('hides edit-gated Applications entries for a viewer, keeps role-uniform ones', async () => {
    const user = userEvent.setup();
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    render(<SiteHeader />);

    const appsContent = await openDesktopZone(user, 'Applications');
    expect(within(appsContent).getByText('Procurement')).toBeInTheDocument();
    expect(
      within(appsContent).queryByText('Intelligence'),
    ).not.toBeInTheDocument();
  });

  it('hides edit-gated Governance entries for a viewer, keeps role-uniform ones', async () => {
    const user = userEvent.setup();
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    render(<SiteHeader />);

    const govContent = await openDesktopZone(user, 'Governance');
    expect(within(govContent).getByText('Change reports')).toBeInTheDocument();
    expect(within(govContent).getByText('Activity')).toBeInTheDocument();
    expect(within(govContent).queryByText('Review')).not.toBeInTheDocument();
    expect(within(govContent).queryByText('Coverage')).not.toBeInTheDocument();
    expect(
      within(govContent).queryByText('Provenance'),
    ).not.toBeInTheDocument();
  });

  // ── BI-23/BI-24: active leaf + zone affordance ──

  it('marks the active leaf with aria-current and its zone header with a non-colour affordance', async () => {
    const user = userEvent.setup();
    mockPathname.value = '/library';
    render(<SiteHeader />);

    const nav = screen.getByLabelText('Main navigation');
    const knowledgeTrigger = within(nav).getByRole('button', {
      name: 'Knowledge',
    });
    expect(knowledgeTrigger).toHaveClass('underline');
    expect(knowledgeTrigger).toHaveClass('font-semibold');

    const appsTrigger = within(nav).getByRole('button', {
      name: 'Applications',
    });
    expect(appsTrigger).not.toHaveClass('underline');

    const content = await openDesktopZone(user, 'Knowledge');
    expect(within(content).getByText('Answers').closest('a')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(content).getByText('External sources').closest('a'),
    ).not.toHaveAttribute('aria-current');
  });

  it('matches active state for nested sub-paths', async () => {
    const user = userEvent.setup();
    mockPathname.value = '/library/some-category';
    render(<SiteHeader />);
    const content = await openDesktopZone(user, 'Knowledge');
    expect(within(content).getByText('Answers').closest('a')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  // ── mobile drawer: labelled always-expanded zone sections (BI-26) ──

  it('renders mobile menu button', () => {
    render(<SiteHeader />);
    expect(screen.getByLabelText('Open navigation menu')).toBeInTheDocument();
  });

  it('opens mobile menu and shows Home at top, zone sections, and Settings/Sign-out at the foot', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    const menuButton = screen.getByLabelText('Open navigation menu');
    await user.click(menuButton);

    const mobileNav = screen.getByLabelText('Mobile navigation');
    expect(mobileNav).toBeInTheDocument();
    expect(within(mobileNav).getByText('Home')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Applications')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Knowledge')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Governance')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Settings')).toBeInTheDocument();
    expect(
      within(mobileNav).getByTestId('sign-out-button-mobile'),
    ).toBeInTheDocument();
  });

  it('lists zone members always-expanded (no disclosure) in the mobile drawer', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    await user.click(screen.getByLabelText('Open navigation menu'));
    const mobileNav = screen.getByLabelText('Mobile navigation');

    expect(within(mobileNav).getByText('Procurement')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Search')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Answers')).toBeInTheDocument();
    expect(within(mobileNav).getByText('External sources')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Change reports')).toBeInTheDocument();
  });

  it('never renders legacy IMS-era labels in the mobile drawer', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    await user.click(screen.getByLabelText('Open navigation menu'));
    const mobileNav = screen.getByLabelText('Mobile navigation');
    for (const label of LEGACY_LABELS) {
      expect(within(mobileNav).queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('hides edit/admin-gated entries from the mobile drawer for a viewer', async () => {
    const user = userEvent.setup();
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    render(<SiteHeader />);
    await user.click(screen.getByLabelText('Open navigation menu'));
    const mobileNav = screen.getByLabelText('Mobile navigation');

    expect(
      within(mobileNav).queryByText('Intelligence'),
    ).not.toBeInTheDocument();
    expect(within(mobileNav).queryByText('Review')).not.toBeInTheDocument();
    expect(within(mobileNav).queryByText('Coverage')).not.toBeInTheDocument();
    expect(within(mobileNav).queryByText('Provenance')).not.toBeInTheDocument();
    expect(within(mobileNav).getByText('Change reports')).toBeInTheDocument();
  });

  // ── Settings / search / sign-out non-regression ──

  it('renders settings button that navigates to /settings', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const settingsButton = screen.getByLabelText('Settings');
    await user.click(settingsButton);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
  });

  it('renders settings button', () => {
    render(<SiteHeader />);
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });

  it('renders the SearchBar component in desktop view', () => {
    render(<SiteHeader />);
    expect(screen.getByTestId('search-bar')).toBeInTheDocument();
  });

  it('renders the desktop Sign out button in the header action cluster', () => {
    render(<SiteHeader />);
    expect(screen.getByTestId('sign-out-button-desktop')).toBeInTheDocument();
  });

  it('renders the mobile Sign out button inside the mobile drawer', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    // The mobile variant should not be present before the drawer is opened
    expect(
      screen.queryByTestId('sign-out-button-mobile'),
    ).not.toBeInTheDocument();

    const menuButton = screen.getByLabelText('Open navigation menu');
    await user.click(menuButton);

    const mobileNav = screen.getByLabelText('Mobile navigation');
    expect(
      within(mobileNav).getByTestId('sign-out-button-mobile'),
    ).toBeInTheDocument();
  });

  it('no longer exposes a direct "Claude" link in the header or drawer', async () => {
    // The header previously had a ghost button with a link to claude.ai/new
    // and the mobile drawer had an "Open Claude" row. Both were removed as
    // part of the Sign out button roll-out; this test locks that behaviour in
    // so it cannot be reintroduced without updating the AI visibility policy.
    const user = userEvent.setup();
    render(<SiteHeader />);

    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Open Claude in a new tab'),
    ).not.toBeInTheDocument();

    const menuButton = screen.getByLabelText('Open navigation menu');
    await user.click(menuButton);
    expect(screen.queryByText('Open Claude')).not.toBeInTheDocument();
  });

  // ── ID-135.10 (kept green per TECH §C6): /search in the Knowledge zone ──

  it('/search (Search) is present in the Knowledge zone, visible to a viewer', async () => {
    const user = userEvent.setup();
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.loading = false;
    render(<SiteHeader />);

    const content = await openDesktopZone(user, 'Knowledge');
    const searchLink = within(content).getByText('Search');
    expect(searchLink).toBeInTheDocument();
    expect(searchLink.closest('a')).toHaveAttribute('href', '/search');
  });

  it('shows active state on the Search link when on /search', async () => {
    const user = userEvent.setup();
    mockPathname.value = '/search';
    render(<SiteHeader />);

    const content = await openDesktopZone(user, 'Knowledge');
    const searchLink = within(content).getByText('Search').closest('a');
    expect(searchLink).toHaveAttribute('aria-current', 'page');

    const answersLink = within(content).getByText('Answers').closest('a');
    expect(answersLink).not.toHaveAttribute('aria-current');
  });
});
