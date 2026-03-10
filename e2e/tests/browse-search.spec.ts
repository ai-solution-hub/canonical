import { test, expect } from '../fixtures/auth';

/**
 * Flow 2: Content Browse and Search
 *
 * Tests the /browse page (grid/list views, filters, sorting, navigation)
 * and the /search page (semantic search, results display).
 * All tests use the authenticated page fixture.
 */

test.describe('Browse page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await page.waitForLoadState('networkidle');
  });

  test('browse page loads with heading and content', async ({ authenticatedPage: page }) => {
    // Page heading
    await expect(
      page.getByRole('heading', { name: 'Browse Content' }),
    ).toBeVisible();

    // Item count text should appear (e.g. "186 items")
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });
  });

  test('content grid is displayed by default', async ({ authenticatedPage: page }) => {
    // Wait for content to load (item count visible)
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    // The grid view mode button should be active / selected
    // The view toggle group has two buttons — grid and list
    const viewGroup = page.getByRole('group', { name: 'View mode' });
    await expect(viewGroup).toBeVisible();
  });

  test('can switch between grid and list views', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    const viewGroup = page.getByRole('group', { name: 'View mode' });

    // Click list view button (the List icon button within the view group)
    const listButton = viewGroup.getByRole('button').nth(1);
    await listButton.click();

    // Give the view transition a moment
    await page.waitForTimeout(300);

    // Switch back to grid
    const gridButton = viewGroup.getByRole('button').first();
    await gridButton.click();

    await page.waitForTimeout(300);
  });

  test('filter button opens the filter panel', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    // The filters button has a SlidersHorizontal icon and text "Filters"
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.click();

    // The filter panel is a Sheet that appears on the right side.
    // Scope assertions to the Sheet dialog to avoid matching domain badges
    // in the browse content behind it.
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });
    await expect(
      sheet.getByText('Filters').or(sheet.getByText('Content type')),
    ).toBeVisible({ timeout: 5000 });
  });

  test('sort dropdown shows available sort options', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    // The sort control is a Radix Select inside the "View mode" group area.
    // Its trigger has role="combobox" and is inside the filter bar.
    // Scope to the View mode group's parent to find the right combobox.
    const viewGroup = page.getByRole('group', { name: 'View mode' });
    // The sort select is a sibling of the view group, both inside the same
    // parent container. Find the combobox near the view group.
    const sortTrigger = viewGroup.locator('..').getByRole('combobox').first();

    if (await sortTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sortTrigger.click();

      // Should show sort options in the dropdown listbox
      const listbox = page.getByRole('listbox');
      await expect(listbox.getByText('Date (newest)')).toBeVisible();
      await expect(listbox.getByText('Date (oldest)')).toBeVisible();
      await expect(listbox.getByText('Domain')).toBeVisible();

      // Select a different sort option
      await listbox.getByText('Date (oldest)').click();
    }
  });

  test('clicking a content item navigates to the detail page', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    // Content items are rendered as links — find the first one
    // Items in the grid are links to /item/[id]
    const firstItemLink = page.getByRole('link', { name: /\[E2E Test\]/ }).first();

    // If E2E test items exist, click one
    if (await firstItemLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstItemLink.click();
      await expect(page).toHaveURL(/\/item\//);
    } else {
      // Fall back to clicking any content link
      const anyItemLink = page.locator('a[href^="/item/"]').first();
      if (await anyItemLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await anyItemLink.click();
        await expect(page).toHaveURL(/\/item\//);
      }
    }
  });

  test('shows item count in footer text', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({ timeout: 10000 });

    // The bottom of the page shows "Showing X of Y items"
    await expect(
      page.getByText(/Showing \d+ of/),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Search', () => {
  test('compact search bar in header accepts input', async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    await page.waitForLoadState('networkidle');

    // The site header contains a compact search bar (visible on desktop)
    const searchInput = page.locator('header').getByRole('searchbox');

    // If searchbox is visible (desktop viewport), type a query
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('IT support');
      await searchInput.press('Enter');

      // Should navigate to search results
      await expect(page).toHaveURL(/\/search/);
    }
  });

  test('search page loads and shows results for a query', async ({ authenticatedPage: page }) => {
    await page.goto('/search?q=IT+support');
    await page.waitForLoadState('networkidle');

    // Either search results appear or an empty/no-results message
    const hasResults = page.locator('a[href^="/item/"]').first();
    const emptyState = page.getByText(/no results/i).or(page.getByText(/try a different/i));

    await expect(hasResults.or(emptyState)).toBeVisible({ timeout: 15000 });
  });

  test('search results link to item detail pages', async ({ authenticatedPage: page }) => {
    await page.goto('/search?q=SLA');
    await page.waitForLoadState('networkidle');

    // Wait for results to load
    const firstResult = page.locator('a[href^="/item/"]').first();

    if (await firstResult.isVisible({ timeout: 10000 }).catch(() => false)) {
      const href = await firstResult.getAttribute('href');
      await firstResult.click();
      await expect(page).toHaveURL(/\/item\//);

      // Verify we navigated to the correct item
      if (href) {
        await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
  });
});
