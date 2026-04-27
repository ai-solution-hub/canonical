import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Provenance Audit PDF export
 *
 * Tests that clicking "Export PDF" on the Audit tab triggers a download.
 * Does NOT validate PDF contents — only that the download event fires.
 *
 * The authenticated test user (user1) has admin role.
 */

test.describe('Provenance -- Audit PDF export', () => {
  test('clicking "Export PDF" triggers a download', async ({
    authenticatedPage: page,
  }) => {
    test.skip(
      isMobileViewport(page),
      'PDF export download test is desktop-only to avoid mobile layout issues',
    );

    await page.goto('/provenance?tab=audit');
    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible(
      { timeout: 15000 },
    );

    // Wait for the Export PDF button to appear
    const exportButton = page.getByRole('button', { name: /Export PDF/ });
    await expect(exportButton).toBeVisible({ timeout: 10000 });

    // The export uses a programmatic <a> click which triggers a download.
    // Set up the download listener BEFORE clicking.
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

    await exportButton.click();

    const download = await downloadPromise;

    // Verify the suggested filename matches the expected pattern
    expect(download.suggestedFilename()).toMatch(
      /verification-history-.*\.pdf$/,
    );
  });
});
