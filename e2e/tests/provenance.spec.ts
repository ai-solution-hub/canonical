import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Provenance surface
 *
 * Tests the /provenance admin-only page: access control, tab navigation,
 * deep-linking, legacy route redirects, and command palette entry.
 *
 * The authenticated test user (user1) is expected to have admin role.
 * Editor (user2) and viewer (user3) should see AccessDenied.
 */

test.describe('Provenance -- admin access and tab navigation', () => {
  test('admin can access /provenance and sees tab navigation', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/provenance');

    // Should see the Provenance heading
    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible(
      { timeout: 15000 },
    );

    // Should see all five tab triggers
    await expect(page.getByRole('tab', { name: 'Per-item' })).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Pipeline Health' }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Audit' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Cost' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Disputes' })).toBeVisible();
  });

  test('viewer sees AccessDenied on /provenance', async ({
    viewerPage: page,
  }) => {
    await page.goto('/provenance');

    // Should show the access-denied alert. Next.js also injects a visually-
    // hidden #__next-route-announcer__ div with role="alert" on every page
    // (route-change a11y announcer), which a bare getByRole('alert')
    // strict-mode-violates against (reproduced identically across two
    // independent runs, S457 finding). `role="alert"` has "Name from:
    // author" only per the ARIA spec (NOT "contents"), so getByRole's
    // `name` option — which matches the computed ACCESSIBLE NAME, not
    // visible text — cannot discriminate here: neither alert has an
    // explicit aria-label, so both have an empty accessible name. Filter by
    // text content instead (components/provenance/access-denied.tsx's
    // role="alert" div contains the "Admin access required" heading; the
    // route-announcer never does).
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Admin access required' });
    await expect(alert).toBeVisible({ timeout: 15000 });
    await expect(alert).toContainText('Admin access required');

    // Tab navigation should NOT be visible
    await expect(page.getByRole('tab', { name: 'Per-item' })).not.toBeVisible();
  });

  test('editor sees AccessDenied on /provenance', async ({
    editorPage: page,
  }) => {
    await page.goto('/provenance');

    // Should show the access-denied alert (see the viewer test above for
    // why this is filtered by text content, not getByRole's `name` option).
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Admin access required' });
    await expect(alert).toBeVisible({ timeout: 15000 });
    await expect(alert).toContainText('Admin access required');

    // Tab navigation should NOT be visible
    await expect(page.getByRole('tab', { name: 'Per-item' })).not.toBeVisible();
  });
});

test.describe('Provenance -- deep-linking and redirects', () => {
  test('deep-link /provenance?tab=pipeline-health shows Pipeline Health tab', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/provenance?tab=pipeline-health');

    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible(
      { timeout: 15000 },
    );

    // The Pipeline Health tab should be selected
    const pipelineTab = page.getByRole('tab', { name: 'Pipeline Health' });
    await expect(pipelineTab).toBeVisible();
    await expect(pipelineTab).toHaveAttribute('aria-selected', 'true');
  });

  test('/activity redirects to /provenance?tab=audit', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/activity');

    // Should redirect to /provenance with audit tab
    await expect(page).toHaveURL(/\/provenance\?tab=audit/, {
      timeout: 15000,
    });

    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible(
      { timeout: 10000 },
    );
  });

  test('/settings?section=activity redirects to /provenance?tab=audit', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings?section=activity');

    // The settings page does a client-side redirect to /provenance?tab=audit
    await expect(page).toHaveURL(/\/provenance\?tab=audit/, {
      timeout: 15000,
    });

    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible(
      { timeout: 10000 },
    );
  });
});

test.describe('Provenance -- command palette', () => {
  test('command palette "Provenance" entry navigates to /provenance', async ({
    authenticatedPage: page,
  }) => {
    test.skip(
      isMobileViewport(page),
      'Command palette is a desktop-only feature (Cmd+K)',
    );

    // Open command palette with Cmd+K
    await page.keyboard.press('Meta+k');

    // Wait for the command palette dialog to appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Type "Provenance" to filter commands
    await dialog.getByRole('combobox').fill('Provenance');

    // Select the Provenance > Audit entry
    const provenanceItem = dialog.getByText('Provenance');
    await expect(provenanceItem.first()).toBeVisible({ timeout: 5000 });
    await provenanceItem.first().click();

    // Should navigate to /provenance
    await expect(page).toHaveURL(/\/provenance/, { timeout: 10000 });
  });
});
