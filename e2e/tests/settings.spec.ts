import { test, expect } from '../fixtures';
import { getSettingsNav, navigateToSettingsSection } from '../helpers/responsive';

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
    const settingsNav = await getSettingsNav(page);

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
    const settingsNav = await getSettingsNav(page);
    const profileButton = settingsNav.getByText('Profile');
    await expect(profileButton).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Integrations section', async ({ authenticatedPage: page }) => {
    await navigateToSettingsSection(page, 'Integrations');

    // URL should update
    await expect(page).toHaveURL(/section=integrations/);

    // Verify by re-opening nav and checking active state
    const settingsNav = await getSettingsNav(page);
    await expect(
      settingsNav.getByText('Integrations'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Taxonomy section', async ({ authenticatedPage: page }) => {
    await navigateToSettingsSection(page, 'Taxonomy');

    await expect(page).toHaveURL(/section=taxonomy/);

    const settingsNav = await getSettingsNav(page);
    await expect(
      settingsNav.getByText('Taxonomy'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Tags section', async ({ authenticatedPage: page }) => {
    await navigateToSettingsSection(page, 'Tags');

    await expect(page).toHaveURL(/section=tags/);

    const settingsNav = await getSettingsNav(page);
    await expect(
      settingsNav.getByText('Tags'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Team section', async ({ authenticatedPage: page }) => {
    await navigateToSettingsSection(page, 'Team');

    await expect(page).toHaveURL(/section=team/);

    const settingsNav = await getSettingsNav(page);
    await expect(
      settingsNav.getByText('Team'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Governance section', async ({ authenticatedPage: page }) => {
    await navigateToSettingsSection(page, 'Governance');

    await expect(page).toHaveURL(/section=governance/);

    const settingsNav = await getSettingsNav(page);
    await expect(
      settingsNav.getByText('Governance'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Activity section', async ({ authenticatedPage: page }) => {
    await navigateToSettingsSection(page, 'Activity');

    await expect(page).toHaveURL(/section=activity/);

    const settingsNav = await getSettingsNav(page);
    await expect(
      settingsNav.getByText('Activity'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('settings page loads directly via section query param', async ({ authenticatedPage: page }) => {
    // Navigate directly to the team section via URL
    await page.goto('/settings?section=team');
    await page.waitForLoadState('networkidle');

    const settingsNav = await getSettingsNav(page);
    await expect(
      settingsNav.getByText('Team'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('invalid section param falls back to profile', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=nonexistent');
    await page.waitForLoadState('networkidle');

    // Should fall back to the profile section
    const settingsNav = await getSettingsNav(page);
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
    // Scope to the main content area to avoid matching sidebar/header text
    const main = page.locator('main');
    await expect(
      main.getByText('Profile Information'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('integrations section loads', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=integrations');
    await page.waitForLoadState('networkidle');

    // Integrations section should show MCP connection details
    // Scope to the main content area to avoid matching sidebar text
    const main = page.locator('main');
    await expect(
      main.getByText(/MCP/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('team section shows user management for admins', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=team');
    await page.waitForLoadState('networkidle');

    // Team section should show the Team Members heading
    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Settings — navigation via site header', () => {
  test('settings button in header navigates to settings page', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the Settings icon button in the site header (not the ThemeSettings
    // "Appearance settings" button). Scope to <header> and use exact: true.
    const header = page.locator('header');
    await header.getByRole('button', { name: 'Settings', exact: true }).click();

    await expect(page).toHaveURL(/\/settings/);
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible();
  });
});
