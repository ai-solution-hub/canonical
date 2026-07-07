import { test, expect } from '../fixtures';

/**
 * Flow: Layer Suggestion
 *
 * Tests the layer feature surfaces that remain live:
 * - Layer filter in the browse page filter panel
 * - Layer badges on content cards
 *
 * {S452 orphan-cluster} bl-405 Q3: the `LayerSuggestionBanner` on the manual
 * create page (/item/new) was deleted — its only production caller was
 * removed under {131.18} and its PATCH /api/items/:id/metadata target no
 * longer exists (the app/api/items/ tree was deleted at {131.17}). The
 * "layer" concept persists as a PRODUCT GUIDES surface (see
 * specs/product-guide-workspaces), just not via this retired suggestion
 * banner — hence the browse-filter and content-card coverage below stays.
 */

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
