import { test, expect } from '../fixtures';

/**
 * Flow: Layer Suggestion
 *
 * Tests the layer suggestion feature across the application:
 * - LayerSuggestionBanner on the manual create page (/item/new)
 * - Layer filter in the browse page filter panel
 * - Layer badges on content cards
 *
 * The LayerSuggestionBanner appears after item creation and offers
 * Accept, Change, and Dismiss actions. It is rendered as a
 * role="region" with aria-label="Layer suggestion".
 */

test.describe('Layer suggestion banner on create page', () => {
  test('create page loads with expected form fields', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    // Verify the create page loaded
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Title input should be visible
    await expect(page.getByLabel(/Title/)).toBeVisible();

    // Content type select should be visible
    await expect(page.getByLabel('Content Type')).toBeVisible();

    // Save button should be present (disabled until fields filled)
    await expect(
      page.getByRole('button', { name: /Save/ }).first(),
    ).toBeVisible();
  });

  test('creating an item shows the layer suggestion banner', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Fill in the title
    await page
      .getByLabel(/Title/)
      .fill('E2E Layer Test: IT Service Desk Procedures');

    // Select content type — click the trigger then choose a type
    await page.getByLabel('Content Type').click();
    await page.getByRole('option', { name: 'Policy' }).click();

    // Fill in the TipTap content editor — it renders a contenteditable div
    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await editor.pressSequentially(
      'This document describes the IT service desk procedures for handling incidents, requests, and escalations. It covers P1 through P4 priority levels with defined SLAs.',
      { delay: 5 },
    );

    // Uncheck summary generation to speed up the test (avoid waiting for
    // external API calls). Classification is always-on server-side now
    // (`auto_classify` defaults to `true` in the validation schema) so there
    // is no user-facing toggle to uncheck.
    const summariseCheckbox = page.getByLabel('Generate summary');
    if (await summariseCheckbox.isChecked()) {
      await summariseCheckbox.uncheck();
    }

    // Submit the form — use the Save button (type="submit")
    const saveButton = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // After creation, the page either:
    // 1. Shows the layer suggestion banner (if layer inference returned a suggestion), or
    // 2. Redirects to the item detail page (if no suggestion or save-and-navigate)
    //
    // The layer suggestion banner has role="region" aria-label="Layer suggestion".
    // If the API returns a suggested_layer, the banner appears before redirect.
    const layerBanner = page.getByRole('region', { name: 'Layer suggestion' });
    const detailPage = page.getByRole('heading', { level: 1 });

    // Wait for either the banner or navigation to the detail page
    await expect(layerBanner.or(detailPage)).toBeVisible({ timeout: 30000 });

    // Hard-expect the banner appears — staging classifier should return a
    // layer suggestion for this content (IT service desk procedures). If the
    // banner is not shown, missing classification fixtures fail honestly.
    await expect(layerBanner).toBeVisible({ timeout: 2000 });

    // Banner should contain "Suggested layer:" text
    await expect(layerBanner.getByText('Suggested layer:')).toBeVisible();

    // Accept button should be present
    await expect(
      layerBanner.getByRole('button', { name: /Accept suggested layer/ }),
    ).toBeVisible();

    // Change button should be present
    await expect(
      layerBanner.getByRole('button', { name: 'Change suggested layer' }),
    ).toBeVisible();

    // Dismiss button should be present
    await expect(
      layerBanner.getByRole('button', { name: /Dismiss/ }).first(),
    ).toBeVisible();

    // Confidence label should be shown (High/Medium/Low)
    await expect(layerBanner.getByText(/confidence/i)).toBeVisible();
  });

  test('layer suggestion banner dismiss hides the banner', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Create an item to trigger the banner
    await page
      .getByLabel(/Title/)
      .fill('E2E Layer Dismiss Test: Cloud Migration Guide');

    await page.getByLabel('Content Type').click();
    await page.getByRole('option', { name: 'Methodology' }).click();

    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await editor.pressSequentially(
      'A comprehensive guide to cloud migration methodology covering assessment, planning, execution, and optimisation phases.',
      { delay: 5 },
    );

    // Uncheck summary generation (classification is always-on server-side)
    const summariseCheckbox = page.getByLabel('Generate summary');
    if (await summariseCheckbox.isChecked()) {
      await summariseCheckbox.uncheck();
    }

    const saveButton = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const layerBanner = page.getByRole('region', { name: 'Layer suggestion' });
    const detailPage = page.getByRole('heading', { level: 1 });

    await expect(layerBanner.or(detailPage)).toBeVisible({ timeout: 30000 });

    // Hard-expect the banner appears — staging classifier should return a
    // layer suggestion for this content (cloud migration methodology).
    await expect(layerBanner).toBeVisible({ timeout: 2000 });

    // Click dismiss (the X button with aria-label or the text Dismiss button)
    const dismissButton = layerBanner
      .getByRole('button', { name: /Dismiss/ })
      .first();
    await dismissButton.click();

    // Banner should disappear
    await expect(layerBanner).not.toBeVisible({ timeout: 5000 });
  });

  test('layer suggestion banner change mode shows layer dropdown', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');
    await expect(
      page.getByRole('heading', { name: 'Create New Content' }),
    ).toBeVisible({ timeout: 10000 });

    // Create an item to trigger the banner
    await page
      .getByLabel(/Title/)
      .fill('E2E Layer Change Test: Security Incident Response');

    await page.getByLabel('Content Type').click();
    await page.getByRole('option', { name: 'Policy' }).click();

    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await editor.pressSequentially(
      'Security incident response procedures for identifying, containing, eradicating, and recovering from security incidents.',
      { delay: 5 },
    );

    // Uncheck summary generation (classification is always-on server-side)
    const summariseCheckbox = page.getByLabel('Generate summary');
    if (await summariseCheckbox.isChecked()) {
      await summariseCheckbox.uncheck();
    }

    const saveButton = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const layerBanner = page.getByRole('region', { name: 'Layer suggestion' });
    const detailPage = page.getByRole('heading', { level: 1 });

    await expect(layerBanner.or(detailPage)).toBeVisible({ timeout: 30000 });

    // Hard-expect the banner appears — staging classifier should return a
    // layer suggestion for this content (security incident response).
    await expect(layerBanner).toBeVisible({ timeout: 2000 });

    // Click Change to switch to change mode
    const changeButton = layerBanner.getByRole('button', {
      name: 'Change suggested layer',
    });
    await changeButton.click();

    // The layer select dropdown should appear
    const layerSelect = layerBanner.getByRole('combobox', {
      name: 'Select a layer',
    });
    await expect(layerSelect).toBeVisible({ timeout: 5000 });

    // Apply and Cancel buttons should be visible
    await expect(
      layerBanner.getByRole('button', { name: /Apply layer/ }),
    ).toBeVisible();
    await expect(
      layerBanner.getByRole('button', { name: 'Cancel' }),
    ).toBeVisible();

    // Cancel should return to suggest mode
    await layerBanner.getByRole('button', { name: 'Cancel' }).click();

    // Accept button should be visible again (back to suggest mode)
    await expect(
      layerBanner.getByRole('button', { name: /Accept suggested layer/ }),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Browse page layer filter', () => {
  test('filter panel contains Content Layer section', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // Open the filter panel
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    // The filter panel is a Sheet dialog
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Look for the "Content Layer" filter section heading
    // The section may be collapsed by default (defaultOpen={false})
    await expect(sheet.getByText('Content Layer')).toBeVisible({
      timeout: 5000,
    });
  });

  test('layer filter shows layer options when expanded', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // Open the filter panel
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Click "Content Layer" to expand the section (it is collapsed by default)
    const layerSection = sheet.getByText('Content Layer');
    await layerSection.click();

    // After expanding, layer option buttons should be visible.
    // The filter panel renders layer vocabulary items as toggle buttons.
    // Check for the helper text that identifies this filter section.
    await expect(sheet.getByText('Filter by content depth layer')).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('Layer badge on content cards', () => {
  test('browse page content cards display layer badges when assigned', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // Content cards with an assigned layer show a layer badge (Badge component
    // with variant="outline"). The badge text comes from the layer vocabulary
    // (e.g. "Sales Brief", "Operational Detail", "Technical Reference").
    //
    // Not all items have a layer assigned, so we check if any layer badges
    // exist on the page. The layer badge is rendered by the LayerBadge component
    // inside ContentCard, only when content_layers feature is enabled and
    // metadata.layer is set.
    //
    // Known layer labels from the vocabulary:
    const layerLabels = [
      'Sales Brief',
      'Operational Detail',
      'Technical Reference',
      'Evidence',
      'Executive Summary',
      'Training Material',
    ];

    // Build a regex that matches any layer label
    const layerRegex = new RegExp(layerLabels.join('|'));

    // Look for any badge containing a layer label in the content grid.
    // Content cards are rendered as links with href="/item/..."
    const contentGrid = page.locator('a[href^="/item/"]').first();
    await expect(contentGrid).toBeVisible({ timeout: 10000 });

    // Check if at least one layer badge exists anywhere on the page.
    // Layer badges have a specific visual style but we match by text content.
    const layerBadge = page
      .locator('span')
      .filter({ hasText: layerRegex })
      .first();

    // Hard-expect at least one layer badge renders. Staging fixtures must
    // include items with assigned layers; missing fixtures fail honestly.
    await expect(layerBadge).toBeVisible({ timeout: 5000 });

    // Verify the badge text is one of the known layer labels
    const text = await layerBadge.textContent();
    expect(layerLabels.some((label) => text?.includes(label))).toBe(true);
  });
});
