import { test, expect } from '../fixtures';
import {
  getSettingsNav,
  navigateToSettingsSection,
} from '../helpers/responsive';

/**
 * Flow 9: Settings
 *
 * Tests the /settings page — sidebar navigation between sections,
 * section content rendering, and admin-only sections.
 * The authenticated test user is expected to have admin role.
 */

test.describe('Settings page', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('settings page loads with heading', async ({
    authenticatedPage: page,
  }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Subheading for admin users
    await expect(page.getByText(/Manage your profile/)).toBeVisible();
  });

  test('sidebar navigation shows expected sections for admin', async ({
    authenticatedPage: page,
  }) => {
    const settingsNav = await getSettingsNav(page);

    // Personal group
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Content Management group (admin only)
    await expect(settingsNav.getByText('Content Organisation')).toBeVisible();
    await expect(settingsNav.getByText('Tag Morphology')).toBeVisible();

    // System group (admin only)
    await expect(settingsNav.getByText('Team')).toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).toBeVisible();
  });

  test('profile section is the default view', async ({
    authenticatedPage: page,
  }) => {
    const settingsNav = await getSettingsNav(page);
    const profileButton = settingsNav.getByText('Profile');
    await expect(profileButton).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Connections section', async ({
    authenticatedPage: page,
  }) => {
    await navigateToSettingsSection(page, 'Connections');

    // URL should update
    await expect(page).toHaveURL(/section=connections/);

    // Verify by re-opening nav and checking active state
    const settingsNav = await getSettingsNav(page);
    await expect(settingsNav.getByText('Connections')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('can navigate to Content Organisation section', async ({
    authenticatedPage: page,
  }) => {
    await navigateToSettingsSection(page, 'Content Organisation');

    await expect(page).toHaveURL(/section=content-organisation/);

    const settingsNav = await getSettingsNav(page);
    await expect(settingsNav.getByText('Content Organisation')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('can navigate to Tag Morphology section', async ({
    authenticatedPage: page,
  }) => {
    await navigateToSettingsSection(page, 'Tag Morphology');

    await expect(page).toHaveURL(/section=tag-morphology/);

    const settingsNav = await getSettingsNav(page);
    await expect(settingsNav.getByText('Tag Morphology')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('can navigate to Team section', async ({ authenticatedPage: page }) => {
    await navigateToSettingsSection(page, 'Team');

    await expect(page).toHaveURL(/section=team/);

    const settingsNav = await getSettingsNav(page);
    await expect(settingsNav.getByText('Team')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('can navigate to Quality Review section', async ({
    authenticatedPage: page,
  }) => {
    await navigateToSettingsSection(page, 'Quality Review');

    await expect(page).toHaveURL(/section=governance/);

    const settingsNav = await getSettingsNav(page);
    await expect(settingsNav.getByText('Quality Review')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('settings page loads directly via section query param', async ({
    authenticatedPage: page,
  }) => {
    // Navigate directly to the team section via URL
    await page.goto('/settings?section=team');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const settingsNav = await getSettingsNav(page);
    await expect(settingsNav.getByText('Team')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('invalid section param falls back to profile', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=nonexistent');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    // Should fall back to the profile section
    const settingsNav = await getSettingsNav(page);
    await expect(settingsNav.getByText('Profile')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('Settings — section content', { tag: '@smoke' }, () => {
  test('profile section shows user information', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=profile');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    // The profile section should display user-related content
    // Scope to the main content area to avoid matching sidebar/header text
    const main = page.locator('main');
    await expect(main.getByText('Profile Information')).toBeVisible({
      timeout: 10000,
    });
  });

  test('connections section loads', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=connections');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    // Connections section should show MCP connection details
    // Scope to the main content area to avoid matching sidebar text
    const main = page.locator('main');
    await expect(main.getByText(/MCP/i).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('team section shows user management for admins', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=team');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    // Team section should show the Team Members heading
    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: /team members/i }),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe(
  'Settings — navigation via site header',
  { tag: '@smoke' },
  () => {
    test('settings button in header navigates to settings page', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/');
      await expect(
        page.getByRole('link', { name: 'Knowledge Hub' }),
      ).toBeVisible({ timeout: 10000 });

      // Click the Settings icon button in the site header (not the ThemeSettings
      // "Appearance settings" button). Scope to <header> and use exact: true.
      const header = page.locator('header');
      await header
        .getByRole('button', { name: 'Settings', exact: true })
        .click();

      await expect(page).toHaveURL(/\/settings/);
      await expect(
        page.getByRole('heading', { name: 'Settings' }),
      ).toBeVisible();
    });
  },
);
