/**
 * SiteHeader Component Tests
 *
 * Tests the SiteHeader component — navigation links, mobile menu,
 * role-gated items, active state, and settings/search controls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRouter, mockPathname, mockUserRole, mockToggleSidebar } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockPathname: { value: '/' },
  mockUserRole: { role: 'editor' as string | null, loading: false, canEdit: true, canAdmin: false },
  mockToggleSidebar: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname.value,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => <a href={href as string} {...props}>{children as React.ReactNode}</a>,
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole,
}));

vi.mock('@/hooks/use-copilot-sidebar', () => ({
  useCopilotSidebar: () => ({ toggle: mockToggleSidebar }),
}));

// Stub complex child components to isolate SiteHeader logic
vi.mock('@/components/search-bar', () => ({
  SearchBar: ({ variant }: { variant?: string }) => (
    <div data-testid="search-bar" data-variant={variant}>Search Bar</div>
  ),
}));

vi.mock('@/components/notification-bell', () => ({
  NotificationBell: ({ mobile }: { mobile?: boolean }) => (
    <div data-testid={mobile ? 'notification-bell-mobile' : 'notification-bell'}>NotificationBell</div>
  ),
}));

vi.mock('@/components/theme-settings', () => ({
  ThemeSettings: () => <div data-testid="theme-settings">ThemeSettings</div>,
}));

// Import AFTER mocks
import { SiteHeader } from '@/components/site-header';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SiteHeader', () => {
  beforeEach(() => {
    mockPathname.value = '/';
    mockUserRole.role = 'editor';
    mockUserRole.loading = false;
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = false;
    mockRouter.push.mockClear();
    mockToggleSidebar.mockClear();
  });

  it('renders the site title as a link to home', () => {
    render(<SiteHeader />);
    const homeLink = screen.getByText('Knowledge Hub');
    expect(homeLink).toBeInTheDocument();
    expect(homeLink.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders all main navigation links for an editor', () => {
    render(<SiteHeader />);
    // Desktop nav contains these links (one instance each in desktop nav)
    expect(screen.getAllByText('Browse').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Q&A Library').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Coverage').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bids').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Review').length).toBeGreaterThanOrEqual(1);
  });

  it('links navigate to correct paths', () => {
    render(<SiteHeader />);
    // Find all Browse links and check href
    const browseLinks = screen.getAllByText('Browse');
    expect(browseLinks[0].closest('a')).toHaveAttribute('href', '/browse');

    const libraryLinks = screen.getAllByText('Q&A Library');
    expect(libraryLinks[0].closest('a')).toHaveAttribute('href', '/library');

    const coverageLinks = screen.getAllByText('Coverage');
    expect(coverageLinks[0].closest('a')).toHaveAttribute('href', '/coverage');

    const bidLinks = screen.getAllByText('Bids');
    expect(bidLinks[0].closest('a')).toHaveAttribute('href', '/bid');

    const reviewLinks = screen.getAllByText('Review');
    expect(reviewLinks[0].closest('a')).toHaveAttribute('href', '/review');
  });

  it('shows correct active state for the current path', () => {
    mockPathname.value = '/browse';
    render(<SiteHeader />);
    // The desktop Browse link should have aria-current="page"
    const browseLinks = screen.getAllByText('Browse');
    const desktopBrowse = browseLinks[0].closest('a');
    expect(desktopBrowse).toHaveAttribute('aria-current', 'page');

    // Other links should NOT have aria-current
    const libraryLinks = screen.getAllByText('Q&A Library');
    const desktopLibrary = libraryLinks[0].closest('a');
    expect(desktopLibrary).not.toHaveAttribute('aria-current');
  });

  it('matches active state for sub-paths', () => {
    mockPathname.value = '/browse/some-category';
    render(<SiteHeader />);
    const browseLinks = screen.getAllByText('Browse');
    const desktopBrowse = browseLinks[0].closest('a');
    expect(desktopBrowse).toHaveAttribute('aria-current', 'page');
  });

  it('hides Review link for viewers (non-editors)', () => {
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    mockUserRole.loading = false;
    render(<SiteHeader />);

    // Review requires edit permission; it should be hidden for viewers
    // Desktop nav should not show Review
    const nav = screen.getByLabelText('Main navigation');
    expect(within(nav).queryByText('Review')).not.toBeInTheDocument();
  });

  it('shows Review link for editors', () => {
    mockUserRole.role = 'editor';
    mockUserRole.canEdit = true;
    mockUserRole.loading = false;
    render(<SiteHeader />);

    const nav = screen.getByLabelText('Main navigation');
    expect(within(nav).getByText('Review')).toBeInTheDocument();
  });

  it('renders mobile menu button', () => {
    render(<SiteHeader />);
    expect(screen.getByLabelText('Open navigation menu')).toBeInTheDocument();
  });

  it('opens mobile menu on click and shows mobile navigation', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    const menuButton = screen.getByLabelText('Open navigation menu');
    await user.click(menuButton);

    // Mobile nav should now be visible with a "Home" link
    const mobileNav = screen.getByLabelText('Mobile navigation');
    expect(mobileNav).toBeInTheDocument();
    expect(within(mobileNav).getByText('Home')).toBeInTheDocument();
    expect(within(mobileNav).getByText('Settings')).toBeInTheDocument();
  });

  it('renders settings button that navigates to /settings', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const settingsButton = screen.getByLabelText('Settings');
    await user.click(settingsButton);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
  });

  it('renders AI assistant toggle button', async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const aiButton = screen.getByLabelText('Toggle AI assistant');
    expect(aiButton).toBeInTheDocument();
    await user.click(aiButton);
    expect(mockToggleSidebar).toHaveBeenCalledOnce();
  });

  it('renders the SearchBar component in desktop view', () => {
    render(<SiteHeader />);
    expect(screen.getByTestId('search-bar')).toBeInTheDocument();
  });
});
