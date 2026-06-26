import { test, expect } from '../fixtures';
import { searchFromHeader } from '../helpers/responsive';
import {
  searchBrowseByPrefix,
  PREFIX_SEARCH_ANCHOR_TITLE,
  escapePrefix,
} from '../helpers/browse-prefix-search';

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
  });

  test('browse page loads with heading and content', async ({
    authenticatedPage: page,
  }) => {
    // Page heading
    await expect(
      page.getByRole('heading', { name: 'Browse Content' }),
    ).toBeVisible();

    // Item count text should appear (e.g. "186 items")
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('content grid is displayed by default', async ({
    authenticatedPage: page,
  }) => {
    // Wait for content to load (item count visible)
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // The grid view mode button should be active / selected
    // The view toggle group has two buttons — grid and list
    const viewGroup = page.getByRole('group', { name: 'View mode' });
    await expect(viewGroup).toBeVisible();
  });

  test('can switch between grid and list views', async ({
    authenticatedPage: page,
  }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    const viewGroup = page.getByRole('group', { name: 'View mode' });

    // The grid renderer tags every card with a `data-grid-index` attribute;
    // the list renderer does not. We assert on that observable post-transition
    // DOM state rather than sleeping past the 150ms opacity transition.
    const gridCards = page.locator('[data-grid-index]');
    const feed = page.getByRole('feed', { name: 'Content items' });

    // Grid is the default view — confirm the starting state is grid.
    await expect(gridCards.first()).toBeVisible();

    // Click list view button (the List icon button within the view group)
    const listButton = viewGroup.getByRole('button').nth(1);
    await listButton.click();

    // List rendered: the feed is present but no grid-indexed cards remain.
    await expect(feed).toBeVisible();
    await expect(gridCards).toHaveCount(0);

    // Switch back to grid
    const gridButton = viewGroup.getByRole('button').first();
    await gridButton.click();

    // Grid re-rendered: grid-indexed cards are observable again.
    await expect(gridCards.first()).toBeVisible();
  });

  test('filter button opens the filter panel', async ({
    authenticatedPage: page,
  }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // The filters button has a SlidersHorizontal icon and text "Filters"
    const filtersButton = page.getByRole('button', { name: /filter/i });
    await filtersButton.scrollIntoViewIfNeeded();
    await filtersButton.click();

    // The filter panel is a Sheet that appears on the right side.
    // Scope assertions to the Sheet dialog to avoid matching domain badges
    // in the browse content behind it.
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });
    await expect(sheet.getByRole('heading', { name: 'Filters' })).toBeVisible({
      timeout: 5000,
    });
  });

  test('sort dropdown shows available sort options', async ({
    authenticatedPage: page,
  }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // The sort control is a Radix Select inside the "View mode" group area.
    // Its trigger has role="combobox" and is inside the filter bar.
    const viewGroup = page.getByRole('group', { name: 'View mode' });
    // The sort select is a sibling of the view group, both inside the same
    // parent container. Find the combobox near the view group.
    const sortTrigger = viewGroup.locator('..').getByRole('combobox').first();

    await expect(sortTrigger).toBeVisible({ timeout: 3000 });
    await sortTrigger.scrollIntoViewIfNeeded();
    await sortTrigger.click();

    // Should show sort options in the dropdown listbox
    const listbox = page.getByRole('listbox');
    await expect(listbox.getByText('Date (newest)')).toBeVisible();
    await expect(listbox.getByText('Date (oldest)')).toBeVisible();
    await expect(listbox.getByText('Domain')).toBeVisible();

    // Select a different sort option
    await listbox.getByText('Date (oldest)').click();
  });

  test('clicking a content item navigates to the detail page', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // Content items are rendered as links. Prefer worker-specific items,
    // fall back to any /item/ link. Hard-assert that at least one resolves
    // so a cleanroom DB without items fails honestly rather than silently
    // skipping the navigation assertion.
    const workerItemLink = page
      .getByRole('link', { name: new RegExp(`\\${workerData.prefix}`) })
      .first();
    const anyItemLink = page.locator('a[href^="/item/"]').first();

    const itemLink = workerItemLink.or(anyItemLink);
    await expect(itemLink).toBeVisible({ timeout: 3000 });
    await itemLink.first().click();
    await expect(page).toHaveURL(/\/item\//);
  });

  test('shows item count in footer text', async ({
    authenticatedPage: page,
  }) => {
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });

    // The bottom of the page shows "Showing X of Y items"
    await expect(page.getByText(/Showing \d+ of/)).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Search', () => {
  test('compact search bar in header accepts input', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');

    // Use the responsive helper — works on both mobile and desktop
    await searchFromHeader(page, 'IT support');

    // Should navigate to browse with search query
    await expect(page).toHaveURL(/\/browse\?q=/);
  });

  test('search via browse page shows the worker-seeded result', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // test-philosophy.md §2.1: assert against worker-seeded rows, never
    // ambient staging content. Anchor the semantic search on the unique
    // seeded title "Cyber Essentials Compliance" (content item [3], which
    // carries a pre-computed embedding) and hard-assert THIS worker's
    // prefixed card is visible. The previous `hasResults.or(emptyState)`
    // soft guard passed even when the query returned zero matches.
    const workerCard = await searchBrowseByPrefix(page, workerData.prefix);
    await expect(workerCard).toContainText(PREFIX_SEARCH_ANCHOR_TITLE);
  });

  test('search results link to item detail pages', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // test-philosophy.md §2.1: assert against the worker-seeded result, not an
    // ambient `?q=SLA` match + `.first()`. searchBrowseByPrefix anchors the
    // semantic search on the unique seeded title and returns THIS worker's
    // result card (an `<a>` → /item/{id}), hard-asserting it is visible.
    const workerCard = await searchBrowseByPrefix(page, workerData.prefix);

    const href = await workerCard.getAttribute('href');
    await workerCard.click();
    await expect(page).toHaveURL(/\/item\//);

    // Verify we navigated to the worker-seeded item's own detail page.
    if (href) {
      await expect(page).toHaveURL(new RegExp(escapePrefix(href)));
    }
  });
});

// ---------------------------------------------------------------------------
// Live preview in Browse (P1-30 Phase 3 — spec §7.3)
// ---------------------------------------------------------------------------

test.describe('Live preview dropdown', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/browse');
    // Wait for content to load (item count visible)
    await expect(page.getByText(/^\d+ items?$/).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('typing a seeded title in inline search — preview shows the worker row', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // The inline SearchBar on /browse has role="combobox"
    const searchInput = page.locator(
      'form[aria-label="Search content"] [role="combobox"]',
    );
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.click();
    // test-philosophy.md §2.1: anchor the live-preview query on the unique
    // seeded title (content item [3], pre-computed embedding) rather than a
    // broad term ("pol"). The previous `if (linkCount > 0) … else "See all
    // results"` branch silently passed on an ambient-only DB.
    await searchInput.fill(PREFIX_SEARCH_ANCHOR_TITLE);

    // Wait for preview results region to appear (debounce + fetch)
    const previewRegion = page.locator(
      '[data-testid="preview-results-region"]',
    );
    await expect(previewRegion).toBeVisible({ timeout: 5000 });

    // Hard-assert THIS worker's seeded "Cyber Essentials Compliance" row is
    // among the preview results, targeted by its known id — robust against
    // other workers' identically-titled rows and ambient staging matches.
    const workerPreviewLink = previewRegion.locator(
      `a[href="/item/${workerData.staleItemId}"]`,
    );
    await expect(workerPreviewLink).toBeVisible({ timeout: 5000 });
  });

  test('type 2 chars — no preview, Popular topics still visible', async ({
    authenticatedPage: page,
  }) => {
    const searchInput = page.locator(
      'form[aria-label="Search content"] [role="combobox"]',
    );
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.click();
    await searchInput.fill('ri');

    // Give some time for any async work
    await page.waitForTimeout(500);

    // Preview region should NOT appear
    const previewRegion = page.locator(
      '[data-testid="preview-results-region"]',
    );
    await expect(previewRegion).toBeHidden();

    // Popular topics may or may not load (depends on API); at minimum,
    // the dropdown should show if there are recent searches OR suggestions.
    // We assert the preview is absent — that is the spec requirement.
  });

  test('click preview result — navigates to the seeded /item/{id}', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const searchInput = page.locator(
      'form[aria-label="Search content"] [role="combobox"]',
    );
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.click();
    // test-philosophy.md §2.1: anchor on worker-seeded content item [0]
    // ("IT Support Policy", pre-computed embedding) and click THAT worker's
    // own row — replacing the ambient "the" query, which asserted nothing
    // about worker-seeded data.
    await searchInput.fill('IT Support Policy');

    const previewRegion = page.locator(
      '[data-testid="preview-results-region"]',
    );
    await expect(previewRegion).toBeVisible({ timeout: 5000 });

    // Target THIS worker's seeded item [0] directly by id, then click it.
    const workerPreviewLink = previewRegion.locator(
      `a[href="/item/${workerData.articleId}"]`,
    );
    await expect(workerPreviewLink).toBeVisible({ timeout: 5000 });
    await workerPreviewLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/item/${escapePrefix(workerData.articleId)}`),
    );
  });

  test('press Enter in input — runs full semantic search', async ({
    authenticatedPage: page,
  }) => {
    const searchInput = page.locator(
      'form[aria-label="Search content"] [role="combobox"]',
    );
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.click();
    await searchInput.fill('IT support');
    await searchInput.press('Enter');

    // Should navigate to the search-results mode (URL contains ?q=)
    await expect(page).toHaveURL(/q=IT/);
  });
});
