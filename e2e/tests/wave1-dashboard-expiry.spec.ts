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
    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('compliance status section renders with the seeded data', async ({
    authenticatedPage: page,
  }) => {
    // ComplianceStatusSection renders when certification data exists (it
    // returns null otherwise). The worker fixture seeds 4 entity_relationships
    // ('holds') + entity_mentions for ISO 27001 / Cyber Essentials Plus /
    // G-Cloud 14, so the populated branch must render. The previous
    // conditional `if (await section.isVisible())` masked missing-fixture
    // regressions per `feedback_e2e_conditional_false_pass`.
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });
    await expect(section.getByText('Compliance Status')).toBeVisible();
  });

  test('compliance section shows certification cards when data exists', async ({
    authenticatedPage: page,
  }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // The section contains CertificationSummaryCard and/or FrameworkSummaryCard
    // CertificationSummaryCard has aria-label="Certifications we hold"
    const certSection = section.locator(
      'section[aria-label="Certifications we hold"]',
    );
    const frameworkSection = section.locator(
      'section[aria-label="Framework memberships"]',
    );

    // At least one of these should be present
    await expect(certSection.or(frameworkSection)).toBeVisible({
      timeout: 5000,
    });
  });

  test('certification cards show expiry status badges', async ({
    authenticatedPage: page,
  }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // Expiry badges have aria-label="Expiry status: {label}". Worker fixture
    // seeds at least one self-held certification (ISO 27001 → Valid) plus one
    // expiring (Cyber Essentials Plus → Expiring Soon), so at least one badge
    // must render. Previous `if (badgeCount > 0)` conditional silently passed
    // on empty DBs per `feedback_e2e_conditional_false_pass`.
    const expiryBadges = section.locator('span[aria-label^="Expiry status:"]');
    await expect(expiryBadges.first()).toBeVisible({ timeout: 10000 });

    // Verify the badge label is one of the valid statuses
    const ariaLabel = await expiryBadges.first().getAttribute('aria-label');
    expect(ariaLabel).toMatch(
      /Expiry status: (Valid|Expiring Soon|Expired|Unknown)/,
    );
  });

  test('expiring certifications show Renew button', async ({
    authenticatedPage: page,
  }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // The Renew button appears for items with expiring_soon or expired status.
    // Worker fixture seeds Cyber Essentials Plus (expiring_soon) and G-Cloud
    // 14 (expiring_soon framework), so at least one Renew link must render.
    // Previous `if (renewCount > 0)` conditional silently passed on empty DBs
    // per `feedback_e2e_conditional_false_pass`.
    const renewLinks = section.locator('a[aria-label*="Upload renewed"]');
    await expect(renewLinks.first()).toBeVisible({ timeout: 10000 });

    // Verify the Renew link points to an item detail page with renewal_entity param
    const href = await renewLinks.first().getAttribute('href');
    expect(href).toMatch(/\/item\/[a-f0-9-]+\?renewal_entity=/);

    // The link should contain "Renew" text
    await expect(renewLinks.first().getByText('Renew')).toBeVisible();
  });

  test('compliance section shows expiring count badge in heading', async ({
    authenticatedPage: page,
  }) => {
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // When certifications are expiring, a count badge appears in the heading
    const expiringBadge = section.locator('span[aria-label*="expiring soon"]');

    await expect(expiringBadge).toBeVisible({ timeout: 3000 });
    const ariaLabel = await expiringBadge.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/^\d+ expiring soon$/);
  });
});
