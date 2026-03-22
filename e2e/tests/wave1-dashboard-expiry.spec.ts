import { test, expect } from '../fixtures';

/**
 * Wave 1: Dashboard Expiring Content Section + Compliance Status
 *
 * Tests the ExpiringContentSection and ComplianceStatusSection on the
 * dashboard (/). The expiring content section shows items expiring within
 * 30 days with urgency-based colour coding. The compliance section shows
 * certification and framework cards with expiry status badges.
 *
 * Both sections render as <section> elements with aria-label attributes.
 * The expiring content section uses freshness semantic tokens for urgency
 * (expired/imminent/approaching).
 *
 * @tag @wave1
 */

test.describe('Dashboard expiring content section', { tag: '@wave1' }, () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/');
    // Wait for dashboard to fully load (Knowledge Hub heading visible)
    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('expiring content section renders on dashboard', async ({ authenticatedPage: page }) => {
    // The ExpiringContentSection always renders (loading, empty, or with items)
    // It has aria-label="Expiring content"
    const section = page.locator('section[aria-label="Expiring content"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // The section heading should say "Expiring Content"
    await expect(section.getByText('Expiring Content')).toBeVisible();
  });

  test('expiring content section shows items or empty state', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Expiring content"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Either items are shown (as a list) or the empty state message
    const itemList = section.locator('ul[role="list"]');
    const emptyMessage = section.getByText('No content expiring in the next 30 days');

    await expect(itemList.or(emptyMessage)).toBeVisible({ timeout: 10000 });
  });

  test('expiring content items link to detail pages', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Expiring content"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // If there are expiring items, they should contain links to item detail pages
    const itemLinks = section.locator('a[href*="/items/"]');
    const linkCount = await itemLinks.count();

    if (linkCount > 0) {
      // First link should point to an item detail page
      const href = await itemLinks.first().getAttribute('href');
      expect(href).toMatch(/\/items\/[a-f0-9-]+/);
    }
  });

  test('expiring content shows urgency badges with semantic classes', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Expiring content"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    const itemList = section.locator('ul[role="list"]');

    // Only test badges if items exist
    if (await itemList.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Each item has an urgency badge (Expired, N days, or N day)
      const badges = section.locator('span').filter({
        hasText: /^(Expired|\d+ days?|within \d+ days?)$/,
      });

      const badgeCount = await badges.count();
      if (badgeCount > 0) {
        // Verify badges use semantic freshness token classes (not raw Tailwind)
        const firstBadge = badges.first();
        const className = await firstBadge.getAttribute('class');
        // Should contain freshness semantic tokens
        expect(className).toMatch(/freshness/);
      }
    }
  });

  test('expiring content shows date in DD/MM/YYYY format', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Expiring content"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    const itemList = section.locator('ul[role="list"]');

    if (await itemList.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Dates should be displayed in UK format DD/MM/YYYY
      const datePattern = section.locator('span').filter({
        hasText: /^\d{2}\/\d{2}\/\d{4}$/,
      });

      const dateCount = await datePattern.count();
      if (dateCount > 0) {
        const dateText = await datePattern.first().textContent();
        // Verify UK date format (day should be 01-31, month 01-12)
        expect(dateText).toMatch(/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/);
      }
    }
  });

  test('expiring content shows count badge in heading', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Expiring content"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // When items exist, the heading shows a count badge
    const countBadge = section.locator('span[aria-label*="items expiring"]');
    const emptyMessage = section.getByText('No content expiring in the next 30 days');

    // Either the count badge is shown (items exist) or the empty state is shown
    // Both are valid states depending on DB content
    if (await countBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      const ariaLabel = await countBadge.getAttribute('aria-label');
      expect(ariaLabel).toMatch(/^\d+ items expiring$/);
    } else {
      // Empty state is also valid
      await expect(emptyMessage).toBeVisible();
    }
  });

  test('expiring content shows summary badges for expired and imminent items', async ({ authenticatedPage: page }) => {
    const section = page.locator('section[aria-label="Expiring content"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Summary badges appear in a role="status" container when expired/imminent items exist
    const statusContainer = section.locator('[role="status"]');

    if (await statusContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should contain "N expired" and/or "N within 7 days" badges
      const expiredBadge = statusContainer.getByText(/\d+ expired/);
      const imminentBadge = statusContainer.getByText(/\d+ within 7 days/);

      // At least one summary badge should be visible
      await expect(expiredBadge.or(imminentBadge)).toBeVisible();
    }
  });
});

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
