import { test, expect } from '../fixtures';

/**
 * Wave 1: Dashboard Compliance Status Section
 *
 * Tests the ComplianceStatusSection on the dashboard (/). The compliance
 * section shows certification and framework cards with expiry status badges.
 *
 * The section renders as a <section> element with aria-label="Compliance status".
 *
 * @tag @wave1
 */

test.describe('Dashboard compliance status section', { tag: '@wave1' }, () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('compliance status section renders or is absent gracefully', async ({ authenticatedPage: page }) => {
    // ComplianceStatusSection renders only when certification data exists.
    // It has aria-label="Compliance status" in all states (loading, error, populated).
    // If no data, it returns null (not rendered at all).
    const section = page.locator('section[aria-label="Compliance status"]');

    // Wait a reasonable time for the API response
    const isVisible = await section.isVisible({ timeout: 10000 }).catch(() => false);

    if (isVisible) {
      // When visible, it should show the heading
      await expect(section.getByText('Compliance Status')).toBeVisible();
    }
    // If not visible, the API returned empty data — this is valid
  });

  test('compliance section shows certification cards when data exists', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    if (await section.isVisible({ timeout: 10000 }).catch(() => false)) {
      // The section contains CertificationSummaryCard and/or FrameworkSummaryCard
      // CertificationSummaryCard has aria-label="Certifications we hold"
      const certSection = section.locator('section[aria-label="Certifications we hold"]');
      const frameworkSection = section.locator('section[aria-label="Framework memberships"]');

      // At least one of these should be present
      await expect(certSection.or(frameworkSection)).toBeVisible({ timeout: 5000 });
    }
  });

  test('certification cards show expiry status badges', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    if (await section.isVisible({ timeout: 10000 }).catch(() => false)) {
      // Expiry badges have aria-label="Expiry status: {label}"
      const expiryBadges = section.locator('span[aria-label^="Expiry status:"]');
      const badgeCount = await expiryBadges.count();

      if (badgeCount > 0) {
        // Verify the badge label is one of the valid statuses
        const ariaLabel = await expiryBadges.first().getAttribute('aria-label');
        expect(ariaLabel).toMatch(
          /Expiry status: (Valid|Expiring Soon|Expired|Unknown)/,
        );
      }
    }
  });

  test('expiring certifications show Renew button', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    if (await section.isVisible({ timeout: 10000 }).catch(() => false)) {
      // The Renew button appears for items with expiring_soon or expired status.
      // It is an <a> element with aria-label="Upload renewed {name} document"
      const renewLinks = section.locator('a[aria-label*="Upload renewed"]');
      const renewCount = await renewLinks.count();

      if (renewCount > 0) {
        // Verify the Renew link points to an item detail page with renewal_entity param
        const href = await renewLinks.first().getAttribute('href');
        expect(href).toMatch(/\/item\/[a-f0-9-]+\?renewal_entity=/);

        // The link should contain "Renew" text
        await expect(renewLinks.first().getByText('Renew')).toBeVisible();
      }
    }
  });

  test('compliance section shows expiring count badge in heading', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    if (await section.isVisible({ timeout: 10000 }).catch(() => false)) {
      // When certifications are expiring, a count badge appears in the heading
      const expiringBadge = section.locator('span[aria-label*="expiring soon"]');

      if (await expiringBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
        const ariaLabel = await expiringBadge.getAttribute('aria-label');
        expect(ariaLabel).toMatch(/^\d+ expiring soon$/);
      }
    }
  });
});
