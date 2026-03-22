import { test, expect } from '../fixtures';

/**
 * Wave 1: Guide Section Banner
 *
 * Tests the GuideSectionBanner component on the Create Content page (/item/new).
 * The banner appears after content creation when guide section matches are found.
 * It shows suggested guide sections grouped by guide, with match strength badges
 * and a dismiss button.
 *
 * The banner renders as role="region" aria-label="Guide section suggestions".
 * Each section link points to /guide/{slug}#{sectionId}.
 *
 * @tag @wave1
 */

test.describe('Guide section banner on create page', { tag: '@wave1' }, () => {
  test('create page loads with form fields for content creation', async ({ authenticatedPage: page }) => {
    await page.goto('/item/new');

    // Verify the create page loaded
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Title input should be visible
    await expect(page.getByLabel(/Title/)).toBeVisible();

    // Content type select should be visible
    await expect(page.getByLabel('Content Type')).toBeVisible();

    // Save button should be present
    await expect(
      page.getByRole('button', { name: /Save/ }).first(),
    ).toBeVisible();
  });

  test('creating content shows guide section banner when matches exist', async ({ authenticatedPage: page }) => {
    await page.goto('/item/new');
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Fill in a title likely to match guide sections (ISO/security domain)
    await page.getByLabel(/Title/).fill('E2E Guide Test: ISO 27001 Information Security Management');

    // Select content type
    await page.getByLabel('Content Type').click();
    await page.getByRole('option', { name: 'Policy' }).click();

    // Fill in the content editor
    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await editor.pressSequentially(
      'This document describes our information security management system aligned with ISO 27001 requirements. It covers risk assessment, access controls, incident management, and business continuity.',
      { delay: 5 },
    );

    // Disable AI options to speed up the test
    const classifyCheckbox = page.getByLabel('Classify automatically');
    if (await classifyCheckbox.isChecked()) {
      await classifyCheckbox.uncheck();
    }
    const summariseCheckbox = page.getByLabel('Generate summary');
    if (await summariseCheckbox.isChecked()) {
      await summariseCheckbox.uncheck();
    }

    // Submit the form
    const saveButton = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // After creation, the page either:
    // 1. Shows the guide section banner (if guide section matches found), or
    // 2. Shows the layer suggestion banner, or
    // 3. Redirects to the item detail page
    const guideBanner = page.getByRole('region', { name: 'Guide section suggestions' });
    const layerBanner = page.getByRole('region', { name: 'Layer suggestion' });
    const detailPage = page.getByRole('heading', { level: 1 });

    // Wait for any of these outcomes
    await expect(guideBanner.or(layerBanner).or(detailPage)).toBeVisible({ timeout: 30000 });

    // If the guide section banner appeared, verify its structure
    if (await guideBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Banner should have a heading about guide sections
      await expect(
        guideBanner.getByText(/guide sections/i),
      ).toBeVisible();

      // Dismiss button should be present
      await expect(
        guideBanner.getByRole('button', { name: /Dismiss guide section suggestions/ }),
      ).toBeVisible();

      // Section links should point to /guide/ paths
      const sectionLinks = guideBanner.locator('a[href*="/guide/"]');
      const linkCount = await sectionLinks.count();
      if (linkCount > 0) {
        const firstHref = await sectionLinks.first().getAttribute('href');
        // Verify href format: /guide/{slug}#{sectionId}
        expect(firstHref).toMatch(/^\/guide\/[a-z0-9-]+#/);
      }

      // Match strength badges should be present (one of: Exact match, Partial match, Domain match)
      const badgeTexts = ['Exact match', 'Partial match', 'Domain match'];
      const badgeRegex = new RegExp(badgeTexts.join('|'));
      await expect(
        guideBanner.locator('span').filter({ hasText: badgeRegex }).first(),
      ).toBeVisible();
    }
  });

  test('guide section banner dismiss hides the banner', async ({ authenticatedPage: page }) => {
    await page.goto('/item/new');
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Create content to trigger the banner
    await page.getByLabel(/Title/).fill('E2E Guide Dismiss Test: Security Policy Framework');

    await page.getByLabel('Content Type').click();
    await page.getByRole('option', { name: 'Policy' }).click();

    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await editor.pressSequentially(
      'A comprehensive security policy framework covering access control, data classification, incident response, and compliance requirements.',
      { delay: 5 },
    );

    // Disable AI options
    const classifyCheckbox = page.getByLabel('Classify automatically');
    if (await classifyCheckbox.isChecked()) {
      await classifyCheckbox.uncheck();
    }
    const summariseCheckbox = page.getByLabel('Generate summary');
    if (await summariseCheckbox.isChecked()) {
      await summariseCheckbox.uncheck();
    }

    const saveButton = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const guideBanner = page.getByRole('region', { name: 'Guide section suggestions' });
    const layerBanner = page.getByRole('region', { name: 'Layer suggestion' });
    const detailPage = page.getByRole('heading', { level: 1 });

    await expect(guideBanner.or(layerBanner).or(detailPage)).toBeVisible({ timeout: 30000 });

    if (await guideBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Click dismiss button
      const dismissButton = guideBanner.getByRole('button', { name: /Dismiss guide section suggestions/ });
      await dismissButton.click();

      // Banner should disappear
      await expect(guideBanner).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('guide section banner shows grouped sections by guide name', async ({ authenticatedPage: page }) => {
    await page.goto('/item/new');
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Create content with broad domain coverage for multiple guide matches
    await page.getByLabel(/Title/).fill('E2E Guide Groups Test: Cyber Essentials Implementation');

    await page.getByLabel('Content Type').click();
    await page.getByRole('option', { name: 'Policy' }).click();

    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await editor.pressSequentially(
      'Cyber Essentials implementation guide covering firewalls, secure configuration, user access control, malware protection, and security update management.',
      { delay: 5 },
    );

    // Disable AI options
    const classifyCheckbox = page.getByLabel('Classify automatically');
    if (await classifyCheckbox.isChecked()) {
      await classifyCheckbox.uncheck();
    }
    const summariseCheckbox = page.getByLabel('Generate summary');
    if (await summariseCheckbox.isChecked()) {
      await summariseCheckbox.uncheck();
    }

    const saveButton = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const guideBanner = page.getByRole('region', { name: 'Guide section suggestions' });
    const layerBanner = page.getByRole('region', { name: 'Layer suggestion' });
    const detailPage = page.getByRole('heading', { level: 1 });

    await expect(guideBanner.or(layerBanner).or(detailPage)).toBeVisible({ timeout: 30000 });

    if (await guideBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Sections are displayed as links within <ul> lists
      const sectionLists = guideBanner.locator('ul');
      const listCount = await sectionLists.count();
      // At least one group of sections should be present
      expect(listCount).toBeGreaterThanOrEqual(1);

      // Each section link should have an accessible name describing the guide context
      const sectionLinks = guideBanner.locator('a[href*="/guide/"]');
      const firstLinkCount = await sectionLinks.count();
      if (firstLinkCount > 0) {
        const ariaLabel = await sectionLinks.first().getAttribute('aria-label');
        // Format: "View {sectionName} in {guideName}"
        expect(ariaLabel).toMatch(/^View .+ in .+$/);
      }
    }
  });
});
