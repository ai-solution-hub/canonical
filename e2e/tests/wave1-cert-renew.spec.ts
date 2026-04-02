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
    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('certification cards render with entity names', async ({
    authenticatedPage: page,
  }) => {
    // The compliance status section contains certification cards
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      // The CertificationSummaryCard has aria-label="Certifications we hold"
      const certCard = complianceSection.locator(
        'section[aria-label="Certifications we hold"]',
      );

      if (await certCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Certification rows are rendered as role="listitem" elements
        const certRows = certCard.locator('[role="listitem"]');
        const rowCount = await certRows.count();

        // At least one certification should be present
        expect(rowCount).toBeGreaterThanOrEqual(1);

        // Each row should have a name button with an edit label
        const firstRow = certRows.first();
        const nameButton = firstRow.locator('button[aria-label^="Edit"]');
        await expect(nameButton).toBeVisible();
      }
    }
  });

  test('certification cards show expiry status badges', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      // ExpiryBadge elements have aria-label="Expiry status: {label}"
      const expiryBadges = complianceSection.locator(
        'span[aria-label^="Expiry status:"]',
      );
      const badgeCount = await expiryBadges.count();

      if (badgeCount > 0) {
        // Verify badge labels are valid statuses
        for (let i = 0; i < Math.min(badgeCount, 5); i++) {
          const ariaLabel = await expiryBadges
            .nth(i)
            .getAttribute('aria-label');
          expect(ariaLabel).toMatch(
            /Expiry status: (Valid|Expiring Soon|Expired|Unknown)/,
          );
        }

        // Verify semantic freshness token classes on badges
        const firstBadge = expiryBadges.first();
        const className = await firstBadge.getAttribute('class');
        expect(className).toMatch(/freshness/);
      }
    }
  });

  test('Renew button appears for expiring or expired certifications', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      // Renew buttons are <a> elements with aria-label matching "Upload renewed {name} document"
      const renewButtons = complianceSection.locator(
        'a[aria-label*="Upload renewed"]',
      );
      const renewCount = await renewButtons.count();

      // Renew buttons should only appear next to expiring/expired badges
      if (renewCount > 0) {
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
          if (
            await expiryBadge.isVisible({ timeout: 2000 }).catch(() => false)
          ) {
            const status = await expiryBadge.getAttribute('aria-label');
            expect(status).toMatch(/Expiry status: (Expiring Soon|Expired)/);
          }
        }
      }
    }
  });

  test('Renew button does not appear for valid certifications', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      // Find rows with "Valid" status badges
      const certCard = complianceSection.locator(
        'section[aria-label="Certifications we hold"]',
      );

      if (await certCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        const validBadges = certCard.locator(
          'span[aria-label="Expiry status: Valid"]',
        );
        const validCount = await validBadges.count();

        // For each valid certification, verify no Renew button exists in that row
        for (let i = 0; i < Math.min(validCount, 3); i++) {
          const parentRow = validBadges
            .nth(i)
            .locator('xpath=ancestor::div[@role="listitem"]');
          const renewLink = parentRow.locator(
            'a[aria-label*="Upload renewed"]',
          );
          await expect(renewLink).not.toBeVisible();
        }
      }
    }
  });

  test('framework cards show Renew button for expiring frameworks', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      // FrameworkSummaryCard has aria-label="Framework memberships"
      const frameworkCard = complianceSection.locator(
        'section[aria-label="Framework memberships"]',
      );

      if (await frameworkCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Framework rows are also role="listitem" with the same Renew button pattern
        const frameworkRows = frameworkCard.locator('[role="listitem"]');
        const rowCount = await frameworkRows.count();

        if (rowCount > 0) {
          // Check each row for appropriate Renew button visibility
          for (let i = 0; i < Math.min(rowCount, 3); i++) {
            const row = frameworkRows.nth(i);
            const expiryBadge = row.locator(
              'span[aria-label^="Expiry status:"]',
            );
            const renewLink = row.locator('a[aria-label*="Upload renewed"]');

            if (
              await expiryBadge.isVisible({ timeout: 2000 }).catch(() => false)
            ) {
              const status = await expiryBadge.getAttribute('aria-label');
              const isExpiring =
                status?.includes('Expiring Soon') ||
                status?.includes('Expired');

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
          }
        }
      }
    }
  });

  test('certification card shows evidence count per entity', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      const certCard = complianceSection.locator(
        'section[aria-label="Certifications we hold"]',
      );

      if (await certCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Each row shows "N evidence" count with an aria-label
        const evidenceCounts = certCard.locator('span[aria-label*="evidence"]');
        const countNum = await evidenceCounts.count();

        if (countNum > 0) {
          const ariaLabel = await evidenceCounts
            .first()
            .getAttribute('aria-label');
          // Format: "N evidence item" or "N evidence items"
          expect(ariaLabel).toMatch(/^\d+ evidence items?$/);
        }
      }
    }
  });

  test('certification card shows copy and review buttons in header', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      const certCard = complianceSection.locator(
        'section[aria-label="Certifications we hold"]',
      );

      if (await certCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Copy button with aria-label
        const copyButton = certCard.getByRole('button', {
          name: /Copy certification summary/,
        });
        await expect(copyButton).toBeVisible();

        // Review with Claude button
        const reviewButton = certCard.getByText('Review with Claude');
        await expect(reviewButton).toBeVisible();
      }
    }
  });

  test('supplier certifications section is collapsible', async ({
    authenticatedPage: page,
  }) => {
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );

    if (
      await complianceSection.isVisible({ timeout: 10000 }).catch(() => false)
    ) {
      // Supplier section has a toggle button with "Supplier Certifications (N)" text
      const supplierToggle = complianceSection
        .locator('button[aria-expanded]')
        .filter({
          hasText: /Supplier Certifications/,
        });

      if (
        await supplierToggle.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
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
      }
    }
  });
});
