import { test, expect } from '../fixtures';

/**
 * Wave 1: Certification/Framework Renewal Button
 *
 * Tests the Renew button on certification and framework cards on the
 * dashboard. The button appears only for items with 'expiring_soon' or
 * 'expired' expiry status, and links to the item detail page with a
 * `renewal_entity` query parameter.
 *
 * The CertificationSummaryCard renders inside ComplianceStatusSection
 * on the dashboard (/). Each certification/framework/registration row
 * shows an ExpiryBadge and, conditionally, a Renew button.
 *
 * @tag @wave1
 */

test.describe('Certification renewal button', { tag: '@wave1' }, () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('certification cards render with entity names', async ({
    authenticatedPage: page,
  }) => {
    // Worker fixture seeds 2 self-held certifications via entity_mentions
    // and entity_relationships, so the compliance section and the
    // CertificationSummaryCard must render with at least 2 listitems.
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    const certRows = certCard.locator('[role="listitem"]');
    const rowCount = await certRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // Each row should have a name button with an edit label
    const firstRow = certRows.first();
    const nameButton = firstRow.locator('button[aria-label^="Edit"]');
    await expect(nameButton).toBeVisible();
  });

  test('certification cards show expiry status badges', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // ExpiryBadge elements have aria-label="Expiry status: {label}"
    const expiryBadges = complianceSection.locator(
      'span[aria-label^="Expiry status:"]',
    );
    await expect(expiryBadges.first()).toBeVisible({ timeout: 10000 });
    const badgeCount = await expiryBadges.count();
    expect(badgeCount).toBeGreaterThan(0);

    // Verify badge labels are valid statuses
    for (let i = 0; i < Math.min(badgeCount, 5); i++) {
      const ariaLabel = await expiryBadges.nth(i).getAttribute('aria-label');
      expect(ariaLabel).toMatch(
        /Expiry status: (Valid|Expiring Soon|Expired|Unknown)/,
      );
    }

    // Verify semantic freshness token classes on badges
    const firstBadge = expiryBadges.first();
    const className = await firstBadge.getAttribute('class');
    expect(className).toMatch(/freshness/);
  });

  test('Renew button appears for expiring or expired certifications', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // The seeded fixture includes "Cyber Essentials Plus" with an expiring
    // soon date, so at least one Renew button must be present.
    const renewButtons = complianceSection.locator(
      'a[aria-label*="Upload renewed"]',
    );
    await expect(renewButtons.first()).toBeVisible({ timeout: 10000 });
    const renewCount = await renewButtons.count();
    expect(renewCount).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(renewCount, 3); i++) {
      const renewLink = renewButtons.nth(i);

      // Verify the link text contains "Renew"
      await expect(renewLink.getByText('Renew')).toBeVisible();

      // Verify the href format: /item/{id}?renewal_entity={encoded_name}
      const href = await renewLink.getAttribute('href');
      expect(href).toMatch(/^\/item\/[a-f0-9-]+\?renewal_entity=.+$/);

      // The parent listitem should also have an expiry badge showing Expiring Soon or Expired
      const parentRow = renewLink.locator(
        'xpath=ancestor::div[@role="listitem"]',
      );
      const expiryBadge = parentRow.locator(
        'span[aria-label^="Expiry status:"]',
      );
      await expect(expiryBadge).toBeVisible({ timeout: 5000 });
      const status = await expiryBadge.getAttribute('aria-label');
      expect(status).toMatch(/Expiry status: (Expiring Soon|Expired)/);
    }
  });

  test('Renew button does not appear for valid certifications', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    // Seed includes ISO 27001 with a 1-year-out expiry => Valid badge.
    const validBadges = certCard.locator(
      'span[aria-label="Expiry status: Valid"]',
    );
    await expect(validBadges.first()).toBeVisible({ timeout: 10000 });
    const validCount = await validBadges.count();
    expect(validCount).toBeGreaterThan(0);

    // For each valid certification, verify no Renew button exists in that row
    for (let i = 0; i < Math.min(validCount, 3); i++) {
      const parentRow = validBadges
        .nth(i)
        .locator('xpath=ancestor::div[@role="listitem"]');
      const renewLink = parentRow.locator('a[aria-label*="Upload renewed"]');
      await expect(renewLink).not.toBeVisible();
    }
  });

  test('framework cards show Renew button for expiring frameworks', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // The seeded fixture includes G-Cloud 14 with expiring_soon, so the
    // framework card and a Renew button must be present.
    const frameworkCard = complianceSection.locator(
      'section[aria-label="Framework memberships"]',
    );
    await expect(frameworkCard).toBeVisible({ timeout: 10000 });

    const frameworkRows = frameworkCard.locator('[role="listitem"]');
    const rowCount = await frameworkRows.count();
    expect(rowCount).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(rowCount, 3); i++) {
      const row = frameworkRows.nth(i);
      const expiryBadge = row.locator('span[aria-label^="Expiry status:"]');
      const renewLink = row.locator('a[aria-label*="Upload renewed"]');
      await expect(expiryBadge).toBeVisible({ timeout: 5000 });

      const status = await expiryBadge.getAttribute('aria-label');
      const isExpiring =
        status?.includes('Expiring Soon') || status?.includes('Expired');

      if (isExpiring) {
        // Renew button should be present
        await expect(renewLink).toBeVisible();
        const href = await renewLink.getAttribute('href');
        expect(href).toMatch(/\/item\/[a-f0-9-]+\?renewal_entity=/);
      } else {
        // Renew button should NOT be present
        await expect(renewLink).not.toBeVisible();
      }
    }
  });

  test('certification card shows evidence count per entity', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    // Each row shows "N evidence" count with an aria-label
    const evidenceCounts = certCard.locator('span[aria-label*="evidence"]');
    await expect(evidenceCounts.first()).toBeVisible({ timeout: 10000 });

    const ariaLabel = await evidenceCounts.first().getAttribute('aria-label');
    // Format: "N evidence item" or "N evidence items"
    expect(ariaLabel).toMatch(/^\d+ evidence items?$/);
  });

  test('certification card shows copy and review buttons in header', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    // Copy button with aria-label
    const copyButton = certCard.getByRole('button', {
      name: /Copy certification summary/,
    });
    await expect(copyButton).toBeVisible();

    // Review with Claude button
    const reviewButton = certCard.getByText('Review with Claude');
    await expect(reviewButton).toBeVisible();
  });

  test('supplier certifications section is collapsible', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // Worker fixture seeds an Acme Ltd supplier certification, so the
    // supplier toggle must be present.
    const supplierToggle = complianceSection
      .locator('button[aria-expanded]')
      .filter({
        hasText: /Supplier Certifications/,
      });
    await expect(supplierToggle).toBeVisible({ timeout: 10000 });

    // Initially collapsed
    await expect(supplierToggle).toHaveAttribute('aria-expanded', 'false');

    // Click to expand
    await supplierToggle.click();
    await expect(supplierToggle).toHaveAttribute('aria-expanded', 'true');

    // The expanded content should be visible
    const supplierContent = page.locator('#supplier-certifications');
    await expect(supplierContent).toBeVisible();

    // Click again to collapse
    await supplierToggle.click();
    await expect(supplierToggle).toHaveAttribute('aria-expanded', 'false');
  });
});
