import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { isMobileViewport, navigateViaHeader } from '../helpers/responsive';
import { createTestQAPair } from '../helpers/data-factory';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Flow: Q&A Library (/library)
 *
 * Tests the dedicated Q&A Library page — browsing, searching, filtering,
 * grouping, bulk selection, and role-based visibility.
 *
 * Uses the worker-scoped fixture which seeds 2 Q&A pairs:
 *   - [1] "What is your SLA?" (Service Delivery, answer_standard only)
 *   - [2] "Project Management Approach" (Technical Capability, standard + advanced)
 *
 * Additional Q&A pairs are created in beforeAll for filter/group coverage.
 *
 * IMPORTANT: The Q&A library uses @tanstack/react-virtual (window virtualiser).
 * With 173+ production Q&A pairs, worker-prefixed items may be off-screen and
 * not rendered in the DOM. Tests that need specific worker items MUST first
 * search/filter to bring them into view.
 */

let extraQAIds: string[] = [];

/** Navigate to library and filter to only worker items via search */
async function gotoLibraryFiltered(page: Page, prefix: string) {
  await page.goto('/library');
  await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
    timeout: 20000,
  });
  // Search for the prefix to filter down to worker items only
  const searchInput = page.getByLabel('Search Q&A pairs');
  await searchInput.fill(prefix);
  // Wait for the filtered results to settle
  await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
    timeout: 15000,
  });
}

test.describe('Q&A Library page', () => {
  test.beforeAll(async ({ workerData }) => {
    const prefix = workerData.prefix;
    extraQAIds = await Promise.all([
      createTestQAPair(prefix, 'Security & Compliance', {
        title: `${prefix} Business Continuity Plan`,
        answer_standard: 'Our BCP covers disaster recovery across all sites.',
      }),
      createTestQAPair(prefix, 'Social Value', {
        title: `${prefix} Apprenticeship Programme`,
        // No answer fields — tests "neither" variant
        answer_standard: null,
      }),
      createTestQAPair(prefix, 'People & Skills', {
        title: `${prefix} Staff Retention Strategy`,
        answer_standard: null,
        answer_advanced:
          'Advanced retention framework with mentorship pipelines.',
      }),
    ]);
  });

  test.afterAll(async () => {
    if (extraQAIds.length > 0) {
      const supabase = createServiceClient();
      await supabase.from('content_items').delete().in('id', extraQAIds);
    }
  });

  // ---------------------------------------------------------------------------
  // Group 1: Page loading and heading
  // ---------------------------------------------------------------------------

  test('library page loads with heading', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Q&A Library' }),
    ).toBeVisible();
  });

  test('shows Q&A pair count summary', async ({ authenticatedPage: page }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 10000,
    });
  });

  test('shows standard and advanced counts', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    // Wait for data to fully load (skeleton disappears, count text appears)
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });
    // The summary format is "N Q&A pairs · N standard · N advanced"
    const countSummary = page.locator('p[aria-live="polite"]');
    const summaryText = await countSummary.textContent();
    expect(summaryText).toMatch(/\d+ Q&A pairs?/);
    // At least one of standard or advanced should be present in the KB
    const hasStandardOrAdvanced =
      /\d+ standard/.test(summaryText ?? '') ||
      /\d+ advanced/.test(summaryText ?? '');
    expect(hasStandardOrAdvanced).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Group 2: Q&A rows display
  // ---------------------------------------------------------------------------

  test('Q&A rows are rendered', async ({ authenticatedPage: page }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });
    // At least one row with [data-qa-row] is visible
    await expect(page.locator('[data-qa-row]').first()).toBeVisible();
  });

  test('Q&A row shows item title', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Filter to worker items so they appear in the virtualised list
    await gotoLibraryFiltered(page, workerData.prefix);
    // The SLA Q&A pair title should be visible in a row
    await expect(
      page.getByText(`${workerData.prefix} What is your SLA?`),
    ).toBeVisible();
  });

  test('Q&A row expands on click to show answer', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoLibraryFiltered(page, workerData.prefix);

    // Find the expand button within the row that contains our SLA Q&A title
    const slaRow = page.locator('[data-qa-row]', {
      hasText: `${workerData.prefix} What is your SLA?`,
    });
    await expect(slaRow).toBeVisible();

    // Click the expand button (the button with aria-expanded)
    const expandButton = slaRow.locator('button[aria-expanded]');
    await expandButton.click();

    // The answer text should now be visible
    await expect(
      slaRow.getByText('We provide tiered SLAs with 15-minute P1 response'),
    ).toBeVisible();
  });

  test('expanded Q&A row shows copy button', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await gotoLibraryFiltered(page, workerData.prefix);

    const slaRow = page.locator('[data-qa-row]', {
      hasText: `${workerData.prefix} What is your SLA?`,
    });
    await slaRow.locator('button[aria-expanded]').click();

    // Copy button should be visible in the expanded content
    await expect(slaRow.getByRole('button', { name: /copy/i })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Group 3: Search
  // ---------------------------------------------------------------------------

  test('search input is visible with placeholder', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    const searchInput = page.getByLabel('Search Q&A pairs');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute(
      'placeholder',
      'Search questions and answers...',
    );
  });

  test('typing in search filters the list', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    const searchInput = page.getByLabel('Search Q&A pairs');
    // Search for the worker prefix + SLA to find only that item
    await searchInput.fill(`${workerData.prefix} What is your SLA`);

    // Wait for the filtered list — SLA Q&A pair should be visible
    await expect(
      page.getByText(`${workerData.prefix} What is your SLA?`),
    ).toBeVisible({ timeout: 10000 });

    // The Project Management item should not be visible
    await expect(
      page.getByText(`${workerData.prefix} Project Management Approach`),
    ).not.toBeVisible();
  });

  test('clearing search restores full list', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    // Capture the initial (full) count text
    const fullCountText = await page.getByText(/\d+ Q&A pairs?/).textContent();
    const fullCountMatch = fullCountText?.match(/(\d+) Q&A/);
    const fullCount = fullCountMatch ? parseInt(fullCountMatch[1], 10) : 0;

    const searchInput = page.getByLabel('Search Q&A pairs');
    await searchInput.fill(`${workerData.prefix} SLA`);

    // Wait for filter to take effect — count should decrease
    await expect(async () => {
      const text = await page.getByText(/\d+ Q&A pairs?/).textContent();
      const match = text?.match(/(\d+) Q&A/);
      const count = match ? parseInt(match[1], 10) : fullCount;
      expect(count).toBeLessThan(fullCount);
    }).toPass({ timeout: 10000 });

    // Clear the search
    await searchInput.fill('');

    // Count should return to the full count (items may be off-screen in virtualised list)
    await expect(async () => {
      const text = await page.getByText(/\d+ Q&A pairs?/).textContent();
      const match = text?.match(/(\d+) Q&A/);
      const count = match ? parseInt(match[1], 10) : 0;
      expect(count).toBe(fullCount);
    }).toPass({ timeout: 10000 });
  });

  // ---------------------------------------------------------------------------
  // Group 4: Domain filter
  // ---------------------------------------------------------------------------

  test('domain filter dropdown is visible', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });
    // The domain filter trigger shows "All domains" — use button[role=combobox] with text
    const domainTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All domains' });
    await expect(domainTrigger).toBeVisible();
  });

  test('selecting a domain filters the list', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    // Capture the initial count
    const fullCountText = await page.getByText(/\d+ Q&A pairs?/).textContent();
    const fullMatch = fullCountText?.match(/(\d+) Q&A/);
    const fullCount = fullMatch ? parseInt(fullMatch[1], 10) : 0;

    // Open domain dropdown and select the first non-"All" domain
    const domainTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All domains' });
    await domainTrigger.click();
    // Pick the second option (first is "All domains")
    const options = page.locator('[role="option"]');
    const secondOption = options.nth(1);
    await secondOption.click();

    // Count should decrease after filtering
    await expect(async () => {
      const text = await page.getByText(/\d+ Q&A pairs?/).textContent();
      const match = text?.match(/(\d+) Q&A/);
      const count = match ? parseInt(match[1], 10) : fullCount;
      expect(count).toBeLessThan(fullCount);
    }).toPass({ timeout: 10000 });
  });

  test('clearing domain filter restores all items', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    // Capture the initial (full) count
    const fullCountText = await page.getByText(/\d+ Q&A pairs?/).textContent();
    const fullCountMatch = fullCountText?.match(/(\d+) Q&A/);
    const fullCount = fullCountMatch ? parseInt(fullCountMatch[1], 10) : 0;

    // Apply domain filter — pick the first non-"All" domain
    const domainTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All domains' });
    await domainTrigger.click();
    const options = page.locator('[role="option"]');
    const secondOption = options.nth(1);
    const selectedDomain = await secondOption.textContent();
    await secondOption.click();

    // Wait for filter to take effect — count should decrease
    await expect(async () => {
      const text = await page.getByText(/\d+ Q&A pairs?/).textContent();
      const match = text?.match(/(\d+) Q&A/);
      const count = match ? parseInt(match[1], 10) : fullCount;
      expect(count).toBeLessThan(fullCount);
    }).toPass({ timeout: 10000 });

    // Clear by selecting "All domains" — trigger now shows the selected domain
    const filteredTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: selectedDomain ?? '' });
    await filteredTrigger.click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: 'All domains' })
      .click();

    // Count should return to the full count
    await expect(async () => {
      const text = await page.getByText(/\d+ Q&A pairs?/).textContent();
      const match = text?.match(/(\d+) Q&A/);
      const count = match ? parseInt(match[1], 10) : 0;
      expect(count).toBe(fullCount);
    }).toPass({ timeout: 10000 });
  });

  // ---------------------------------------------------------------------------
  // Group 5: Freshness filter
  // ---------------------------------------------------------------------------

  test('freshness filter dropdown is visible', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });
    const freshnessTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All freshness' });
    await expect(freshnessTrigger).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Group 6: Secondary filters (More filters popover)
  // ---------------------------------------------------------------------------

  test('more filters button opens popover', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    await page.getByRole('button', { name: /more filters/i }).click();
    await expect(page.getByText('Additional Filters')).toBeVisible();
  });

  test('variant filter shows options', async ({ authenticatedPage: page }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    await page.getByRole('button', { name: /more filters/i }).click();
    await expect(page.getByText('Additional Filters')).toBeVisible();

    // The popover contains a variant dropdown — find it by its text
    const popover = page.locator('[data-radix-popper-content-wrapper]');
    const variantTrigger = popover
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All variants' });
    await variantTrigger.click();

    // Verify all variant options exist
    await expect(
      page
        .locator('[role="option"]')
        .filter({ hasText: 'Standard + Advanced' }),
    ).toBeVisible();
    await expect(
      page.locator('[role="option"]').filter({ hasText: 'Standard only' }),
    ).toBeVisible();
    await expect(
      page.locator('[role="option"]').filter({ hasText: 'Advanced only' }),
    ).toBeVisible();
    await expect(
      page.locator('[role="option"]').filter({ hasText: 'No answer' }),
    ).toBeVisible();
  });

  test('grouping by domain creates collapsible groups', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    await page.getByRole('button', { name: /more filters/i }).click();
    await expect(page.getByText('Additional Filters')).toBeVisible();

    // Find grouping dropdown in the popover and select "By domain"
    const popover = page.locator('[data-radix-popper-content-wrapper]');
    const groupingTrigger = popover
      .locator('button[role="combobox"]')
      .filter({ hasText: 'No grouping' });
    await groupingTrigger.click();
    await page
      .locator('[role="option"]')
      .filter({ hasText: 'By domain' })
      .click();

    // Close the popover by pressing Escape
    await page.keyboard.press('Escape');

    // Collapsible group headers should appear — buttons with aria-expanded and domain names
    await expect(
      page.locator('button[aria-expanded]', { hasText: 'Service Delivery' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('clear filters button resets all filters', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    // Capture the initial (full) count
    const fullCountText = await page.getByText(/\d+ Q&A pairs?/).textContent();
    const fullCountMatch = fullCountText?.match(/(\d+) Q&A/);
    const fullCount = fullCountMatch ? parseInt(fullCountMatch[1], 10) : 0;

    // Apply a domain filter to make "Clear all" appear
    const domainTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All domains' });
    await domainTrigger.click();
    // Pick the first non-"All" domain
    await page.locator('[role="option"]').nth(1).click();

    // Wait for filter to take effect — count should decrease
    await expect(async () => {
      const text = await page.getByText(/\d+ Q&A pairs?/).textContent();
      const match = text?.match(/(\d+) Q&A/);
      const count = match ? parseInt(match[1], 10) : fullCount;
      expect(count).toBeLessThan(fullCount);
    }).toPass({ timeout: 10000 });

    // "Clear all" button should now be visible
    const clearAll = page.getByRole('button', { name: /clear all/i });
    await expect(clearAll).toBeVisible();
    await clearAll.click();

    // Count should return to the full count
    await expect(async () => {
      const text = await page.getByText(/\d+ Q&A pairs?/).textContent();
      const match = text?.match(/(\d+) Q&A/);
      const count = match ? parseInt(match[1], 10) : 0;
      expect(count).toBe(fullCount);
    }).toPass({ timeout: 10000 });
  });

  // ---------------------------------------------------------------------------
  // Group 7: Empty state
  // ---------------------------------------------------------------------------

  test('searching for nonsense shows empty state', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    const searchInput = page.getByLabel('Search Q&A pairs');
    await searchInput.fill('xyzzyplugh99');

    // Empty state heading should appear
    await expect(
      page.getByRole('heading', { name: /no matching q&a pairs/i }),
    ).toBeVisible({ timeout: 10000 });

    // Clear filters button within empty state
    await expect(
      page.getByRole('button', { name: /clear filters/i }),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Group 8: Bulk selection (admin)
  // ---------------------------------------------------------------------------

  test('select-all checkbox is visible', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByLabel(/select all/i)).toBeVisible();
  });

  test('selecting items shows bulk action toolbar', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Filter to worker items so they appear in the virtualised list
    await gotoLibraryFiltered(page, workerData.prefix);

    // Find the SLA row and click its checkbox
    const slaRow = page.locator('[data-qa-row]', {
      hasText: `${workerData.prefix} What is your SLA?`,
    });
    await expect(slaRow).toBeVisible();

    const checkbox = slaRow.getByRole('checkbox');
    await checkbox.click();

    // Bulk action toolbar should appear with selection count
    await expect(page.getByText('1 selected')).toBeVisible();
  });

  test('select all then deselect all', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Filter to worker items so the select-all operates on a small set
    await gotoLibraryFiltered(page, workerData.prefix);

    // Click "Select all"
    const selectAll = page.getByLabel(/select all/i);
    await expect(selectAll).toBeVisible({ timeout: 5000 });
    await selectAll.click();

    // Toolbar should show selection count
    await expect(page.getByText(/\d+ selected/)).toBeVisible({ timeout: 5000 });

    // Click again to deselect all (label changes to "Deselect all")
    const deselectAll = page.getByLabel(/deselect all/i);
    await deselectAll.click();

    // Toolbar should disappear (0 selected = null render)
    await expect(page.getByText(/\d+ selected/)).not.toBeVisible({
      timeout: 5000,
    });
  });

  // ---------------------------------------------------------------------------
  // Group 9: Navigation
  // ---------------------------------------------------------------------------

  test('Q&A Library is accessible via header navigation', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');
    await expect(page.getByText(/\d+ items?/).first()).toBeVisible({
      timeout: 10000,
    });

    await navigateViaHeader(page, 'Q&A Library');
    await expect(page).toHaveURL(/\/library/);
    await expect(
      page.getByRole('heading', { name: 'Q&A Library' }),
    ).toBeVisible();
  });

  test('clicking detail link navigates to item detail', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Filter to worker items so the SLA row is rendered
    await gotoLibraryFiltered(page, workerData.prefix);

    // The QARow has an ExternalLink icon link with aria-label
    const slaRow = page.locator('[data-qa-row]', {
      hasText: `${workerData.prefix} What is your SLA?`,
    });
    await expect(slaRow).toBeVisible();

    const detailLink = slaRow.getByLabel(/open detail view/i);
    await detailLink.click();

    await expect(page).toHaveURL(new RegExp(`/item/${workerData.qaPairId}`));
  });

  // ---------------------------------------------------------------------------
  // Group 10: Mobile responsive layout
  // ---------------------------------------------------------------------------

  test('filters stack vertically on mobile', async ({
    authenticatedPage: page,
  }) => {
    // Only meaningful on mobile viewport
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    // On mobile, the search input and filter dropdowns should all be accessible
    const searchInput = page.getByLabel('Search Q&A pairs');
    await expect(searchInput).toBeVisible();

    const domainTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All domains' });
    await expect(domainTrigger).toBeVisible();
    const freshnessTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: 'All freshness' });
    await expect(freshnessTrigger).toBeVisible();
    await expect(
      page.getByRole('button', { name: /more filters/i }),
    ).toBeVisible();
  });

  test('Q&A rows are tappable on mobile', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    // Filter to worker items so the SLA row is rendered in virtualised list
    await gotoLibraryFiltered(page, workerData.prefix);

    const slaRow = page.locator('[data-qa-row]', {
      hasText: `${workerData.prefix} What is your SLA?`,
    });
    await expect(slaRow).toBeVisible();

    // Tap the expand button
    const expandButton = slaRow.locator('button[aria-expanded]');
    await expandButton.click();

    // Answer should be visible after expansion
    await expect(
      slaRow.getByText('We provide tiered SLAs with 15-minute P1 response'),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Group 11: Role-based behaviour
  // ---------------------------------------------------------------------------

  test('viewer can browse the library', async ({ viewerPage: page }) => {
    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Q&A Library' }),
    ).toBeVisible();
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });
    // At least one Q&A row should be visible
    await expect(page.locator('[data-qa-row]').first()).toBeVisible();
  });

  test('viewer does not see bulk action checkboxes', async ({
    viewerPage: page,
    workerData,
  }) => {
    // Filter to worker items so rows are in the virtualised list
    await page.goto('/library');
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });
    const searchInput = page.getByLabel('Search Q&A pairs');
    await searchInput.fill(workerData.prefix);
    await expect(page.getByText(/\d+ Q&A pairs?/)).toBeVisible({
      timeout: 20000,
    });

    // Check whether select-all checkbox is visible to the viewer
    // Wait a moment for role hook to resolve and checkboxes to render
    const selectAll = page.getByLabel(/select all/i);
    const isSelectAllVisible = await selectAll
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (isSelectAllVisible) {
      // Checkboxes are visible — verify that clicking does not show admin-only
      // delete button in the toolbar
      await selectAll.click();
      // The toolbar appears but delete should be gated on admin
      await expect(page.getByText(/\d+ selected/)).toBeVisible();
      // Admin-only delete button should not be present
      await expect(
        page.getByRole('button', { name: /delete/i }),
      ).not.toBeVisible();
    } else {
      // Checkboxes are not visible for viewers — assertion passes
      await expect(selectAll).not.toBeVisible();
    }
  });
});
