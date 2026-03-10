import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * Flow 9: Settings
 *
 * Tests the /settings page — sidebar navigation between sections,
 * section content rendering, and admin-only sections.
 * The authenticated test user is expected to have admin role.
 */

// ---------------------------------------------------------------------------
// Helper: navigate settings sections on both desktop and mobile viewports
// ---------------------------------------------------------------------------
// On desktop (md+), the sidebar <nav aria-label="Settings navigation"> is
// visible. On mobile (Pixel 5), it is hidden and replaced by a Sheet trigger
// button showing the current section name.

/**
 * Open the settings sidebar navigation.  On desktop the sidebar is already
 * visible so this is a no-op.  On mobile it clicks the Sheet trigger to
 * reveal the navigation drawer, then returns the visible nav element.
 */
async function openSettingsNav(page: Page) {
  const desktopNav = page.getByRole('navigation', { name: 'Settings navigation' });

  // Desktop: sidebar nav is already visible
  if (await desktopNav.isVisible({ timeout: 2000 }).catch(() => false)) {
    return desktopNav;
  }

  // Mobile: click the Sheet trigger button (shows current section label + Menu icon)
  // The SettingsMobileSidebar renders inside a div.md:hidden
  const mobileTrigger = page.locator('.md\\:hidden').getByRole('button');
  await mobileTrigger.click();

  // After opening the Sheet, the nav inside it becomes visible
  const sheetNav = page.getByRole('navigation', { name: 'Settings navigation' });
  await expect(sheetNav).toBeVisible({ timeout: 5000 });
  return sheetNav;
}

/**
 * Navigate to a settings section via the sidebar (works on both viewports).
 */
async function navigateToSection(page: Page, sectionLabel: string) {
  const nav = await openSettingsNav(page);
  await nav.getByText(sectionLabel).click();
}

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
    // Open the settings navigation (desktop sidebar or mobile sheet)
    const settingsNav = await openSettingsNav(page);

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
    const settingsNav = await openSettingsNav(page);
    const profileButton = settingsNav.getByText('Profile');
    await expect(profileButton).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Integrations section', async ({ authenticatedPage: page }) => {
    await navigateToSection(page, 'Integrations');

    // URL should update
    await expect(page).toHaveURL(/section=integrations/);

    // Verify by re-opening nav and checking active state
    const settingsNav = await openSettingsNav(page);
    await expect(
      settingsNav.getByText('Integrations'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Taxonomy section', async ({ authenticatedPage: page }) => {
    await navigateToSection(page, 'Taxonomy');

    await expect(page).toHaveURL(/section=taxonomy/);

    const settingsNav = await openSettingsNav(page);
    await expect(
      settingsNav.getByText('Taxonomy'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Tags section', async ({ authenticatedPage: page }) => {
    await navigateToSection(page, 'Tags');

    await expect(page).toHaveURL(/section=tags/);

    const settingsNav = await openSettingsNav(page);
    await expect(
      settingsNav.getByText('Tags'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Team section', async ({ authenticatedPage: page }) => {
    await navigateToSection(page, 'Team');

    await expect(page).toHaveURL(/section=team/);

    const settingsNav = await openSettingsNav(page);
    await expect(
      settingsNav.getByText('Team'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Governance section', async ({ authenticatedPage: page }) => {
    await navigateToSection(page, 'Governance');

    await expect(page).toHaveURL(/section=governance/);

    const settingsNav = await openSettingsNav(page);
    await expect(
      settingsNav.getByText('Governance'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('can navigate to Activity section', async ({ authenticatedPage: page }) => {
    await navigateToSection(page, 'Activity');

    await expect(page).toHaveURL(/section=activity/);

    const settingsNav = await openSettingsNav(page);
    await expect(
      settingsNav.getByText('Activity'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('settings page loads directly via section query param', async ({ authenticatedPage: page }) => {
    // Navigate directly to the team section via URL
    await page.goto('/settings?section=team');
    await page.waitForLoadState('networkidle');

    const settingsNav = await openSettingsNav(page);
    await expect(
      settingsNav.getByText('Team'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('invalid section param falls back to profile', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=nonexistent');
    await page.waitForLoadState('networkidle');

    // Should fall back to the profile section
    const settingsNav = await openSettingsNav(page);
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
      main.getByText(/MCP/i),
    ).toBeVisible({ timeout: 10000 });
  });

  test('team section shows user management for admins', async ({ authenticatedPage: page }) => {
    await page.goto('/settings?section=team');
    await page.waitForLoadState('networkidle');

    // Team section should show user list or invite functionality
    // Scope to the main content area to avoid matching sidebar text
    const main = page.locator('main');
    await expect(
      main.getByRole('button', { name: /invite/i })
        .or(main.getByText(/team member/i))
        .or(main.getByText(/user/i)),
    ).toBeVisible({ timeout: 10000 });
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
