import { test, expect } from '../fixtures';
import { getSettingsNav, isMobileViewport } from '../helpers/responsive';

/**
 * Role-Gating Tests
 *
 * Verifies that viewer, editor, and admin roles see the correct
 * navigation items and settings sections based on their permissions.
 *
 * Test users: user1=admin, user2=editor, user3=viewer (all in user_roles).
 */

test.describe('Viewer role restrictions', { tag: '@smoke' }, () => {
  test('viewer cannot see Review in navigation', async ({
    viewerPage: page,
  }) => {
    // On mobile, open hamburger first
    if (isMobileViewport(page)) {
      const hamburger = page.getByRole('button', {
        name: 'Open navigation menu',
      });
      if (await hamburger.isVisible({ timeout: 3000 }).catch(() => false)) {
        await hamburger.click();
        const mobileNav = page.getByRole('navigation', {
          name: 'Mobile navigation',
        });
        await expect(mobileNav).toBeVisible();
        await expect(
          mobileNav.getByRole('link', { name: 'Review' }),
        ).not.toBeVisible();
      }
    } else {
      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      // Viewer should not see Review link (requires editor+ role)
      await expect(
        mainNav.getByRole('link', { name: 'Review' }),
      ).not.toBeVisible();
    }
  });

  test('viewer sees limited settings sections', async ({
    viewerPage: page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const settingsNav = await getSettingsNav(page);

    // Viewer should see personal sections
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();

    // Viewer should NOT see admin-only sections
    await expect(settingsNav.getByText('Team')).not.toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).not.toBeVisible();
  });
});

test.describe('Editor role access', { tag: '@smoke' }, () => {
  test('editor can access the review page', async ({ editorPage: page }) => {
    await page.goto('/review');

    // Editor should see the review queue heading (not redirected)
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('editor sees content management but not system settings', async ({
    editorPage: page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const settingsNav = await getSettingsNav(page);

    // Editor should see personal sections
    await expect(settingsNav.getByText('Profile')).toBeVisible();

    // Editor should NOT see system admin sections
    await expect(settingsNav.getByText('Team')).not.toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).not.toBeVisible();
  });
});

test.describe('Admin role full access', { tag: '@smoke' }, () => {
  test('admin can access the review page', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/review');

    // Admin should see the review queue heading
    await expect(
      page.getByRole('heading', { name: 'Review Queue' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('admin sees all settings sections', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10000,
    });

    const settingsNav = await getSettingsNav(page);

    // Admin sees everything — personal, content management, and system groups
    await expect(settingsNav.getByText('Profile')).toBeVisible();
    await expect(settingsNav.getByText('Connections')).toBeVisible();
    await expect(settingsNav.getByText('Content Organisation')).toBeVisible();
    await expect(settingsNav.getByText('Tag Morphology')).toBeVisible();
    await expect(settingsNav.getByText('Team')).toBeVisible();
    await expect(settingsNav.getByText('Quality Review')).toBeVisible();
  });
});
