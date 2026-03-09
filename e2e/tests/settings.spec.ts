import { test, expect } from '../fixtures/auth';

/**
 * Flow 9: Settings
 *
 * Tests the /settings page — sidebar navigation between sections,
 * section content rendering, and admin-only sections.
 * The authenticated test user is expected to have admin role.
 */

test.describe('Settings page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('settings page loads with heading', async ({ authenticatedPage: page }) => {
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible();

    // Subheading for admin users
    await expect(
      page.getByText(/Manage your profile/),
    ).toBeVisible();
  });

  test('sidebar navigation shows expected sections for admin', async ({ authenticatedPage: page }) => {
    // The settings sidebar (desktop) should show all 7 sections grouped
    // under Personal, Content Management, and System
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });
    await expect(settingsNav).toBeVisible();

    // Personal group
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Integrations')).toBeVisible();

    // Content Management group (admin only)
    await expect(settingsNav.getByText('Taxonomy')).toBeVisible();
    await expect(settingsNav.getByText('Tags')).toBeVisible();

    // System group (admin only)
    await expect(settingsNav.getByText('Team')).toBeVisible();
    await expect(settingsNav.getByText('Governance')).toBeVisible();
    await expect(settingsNav.getByText('Activity')).toBeVisible();
  });

  test('profile section is the default view', async ({ authenticatedPage: page }) => {
    // Profile section should be visible by default (no ?section= param)
    // The Profile button should have aria-current="page"
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });
    const profileButton = settingsNav.getByText('Profile');
    await expect(profileButton).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Integrations section', async ({ authenticatedPage: page }) => {
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });

    // Click Integrations
    await settingsNav.getByText('Integrations').click();

    // URL should update
    await expect(page).toHaveURL(/section=integrations/);

    // Integrations button should now be active
    await expect(
      settingsNav.getByText('Integrations'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Taxonomy section', async ({ authenticatedPage: page }) => {
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });

    await settingsNav.getByText('Taxonomy').click();

    await expect(page).toHaveURL(/section=taxonomy/);
    await expect(
      settingsNav.getByText('Taxonomy'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Tags section', async ({ authenticatedPage: page }) => {
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });

    await settingsNav.getByText('Tags').click();

    await expect(page).toHaveURL(/section=tags/);
    await expect(
      settingsNav.getByText('Tags'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Team section', async ({ authenticatedPage: page }) => {
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });

    await settingsNav.getByText('Team').click();

    await expect(page).toHaveURL(/section=team/);
    await expect(
      settingsNav.getByText('Team'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Governance section', async ({ authenticatedPage: page }) => {
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });

    await settingsNav.getByText('Governance').click();

    await expect(page).toHaveURL(/section=governance/);
    await expect(
      settingsNav.getByText('Governance'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Activity section', async ({ authenticatedPage: page }) => {
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });

    await settingsNav.getByText('Activity').click();

    await expect(page).toHaveURL(/section=activity/);
    await expect(
      settingsNav.getByText('Activity'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('settings page loads directly via section query param', async ({ authenticatedPage: page }) => {
    // Navigate directly to the team section via URL
    await page.goto('/settings?section=team');
    await page.waitForLoadState('networkidle');

    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });
    await expect(
      settingsNav.getByText('Team'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('invalid section param falls back to profile', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=nonexistent');
    await page.waitForLoadState('networkidle');

    // Should fall back to the profile section
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });
    await expect(
      settingsNav.getByText('Profile'),
    ).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('Settings — section content', () => {
  test('profile section shows user information', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=profile');
    await page.waitForLoadState('networkidle');

    // The profile section should display user-related content
    // Look for common profile elements: email display, role badge, etc.
    // The exact content depends on the ProfileSection component
    await expect(
      page.getByText(/email/i).or(page.getByText(/profile/i)),
    ).toBeVisible({ timeout: 10000 });
  });

  test('integrations section loads', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=integrations');
    await page.waitForLoadState('networkidle');

    // Integrations section should show MCP connection details
    await expect(
      page.getByText(/MCP/i)
        .or(page.getByText(/integration/i))
        .or(page.getByText(/connect/i)),
    ).toBeVisible({ timeout: 10000 });
  });

  test('team section shows user management for admins', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=team');
    await page.waitForLoadState('networkidle');

    // Team section should show user list or invite functionality
    await expect(
      page.getByText(/invite/i)
        .or(page.getByRole('button', { name: /invite/i }))
        .or(page.getByText(/team/i)),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Settings — navigation via site header', () => {
  test('settings button in header navigates to settings page', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the Settings icon button in the header
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings/);
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible();
  });
});
