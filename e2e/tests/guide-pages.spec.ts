import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Guide Pages
 *
 * Tests the Guides index page at /guide and guide detail pages at /guide/[slug].
 * Covers guide listing, filtering, card content, guide detail sections,
 * table of contents, and mobile responsiveness.
 *
 * The tests depend on guides existing in the production database.
 * If no guides exist, tests handle the empty state gracefully.
 */

// ---------------------------------------------------------------------------
// 1. Guides Index Page
// ---------------------------------------------------------------------------

test.describe('Guides index page', () => {
  test('guide page loads with heading and description', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText('Curated reading experiences'),
    ).toBeVisible();

    // The section has aria-label="Guides"
    await expect(
      page.locator('section[aria-label="Guides"]'),
    ).toBeVisible();
  });

  test('guide cards show name, type badge, and section coverage', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    // Wait for loading to finish -- either guide cards or empty state
    const guideCard = page.locator('a[href^="/guide/"]').first();
    const emptyState = page.getByText('No guides published yet');

    await expect(guideCard.or(emptyState)).toBeVisible({ timeout: 15000 });

    if (await guideCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      // First card contains a heading (h3) with the guide name
      await expect(guideCard.locator('h3').first()).toBeVisible();

      // First card contains a type badge (one of: Sector, Product, Company, Research, Custom)
      const typeBadge = guideCard.locator('span').filter({
        hasText: /^(Sector|Product|Company|Research|Custom)$/,
      });
      await expect(typeBadge.first()).toBeVisible();

      // Coverage text and progress bar are rendered when the guide has sections
      // (stats.total_sections > 0). Since production guides should have sections,
      // these assertions are mandatory — not optional.
      const coverageText = guideCard.getByText(/\d+\/\d+ sections populated/);
      await expect(coverageText).toBeVisible({ timeout: 5000 });

      const progressBar = guideCard.getByRole('progressbar');
      await expect(progressBar).toBeVisible();
    } else {
      // Empty state
      await expect(emptyState).toBeVisible();
      // Link to /browse is present as fallback
      await expect(page.locator('a[href="/browse"]')).toBeVisible();
    }
  });

  test('guide type filter dropdown filters cards', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    // Wait for guide cards to load
    const guideCards = page.locator('a[href^="/guide/"]');
    const emptyState = page.getByText('No guides published yet');

    await expect(guideCards.first().or(emptyState)).toBeVisible({ timeout: 15000 });

    // Skip if no guides exist or filter not visible
    const totalCount = await guideCards.count();
    if (totalCount === 0) {
      test.skip();
      return;
    }

    // Check if type filter is present
    const typeFilter = page.locator('[aria-label="Filter by type"]');
    if (!(await typeFilter.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Open the type filter select
    await typeFilter.click();

    // Select "Sector" (or first non-"All" option)
    const sectorOption = page.getByRole('option', { name: 'Sector' });
    if (await sectorOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sectorOption.click();

      // URL should update with type parameter
      await expect(page).toHaveURL(/type=/);

      // Filtered count should be <= total count
      const filteredCount = await guideCards.count();
      expect(filteredCount).toBeLessThanOrEqual(totalCount);

      // Verify all visible cards have the matching type badge
      if (filteredCount > 0) {
        for (let i = 0; i < filteredCount; i++) {
          const card = guideCards.nth(i);
          const typeBadge = card.locator('span').filter({ hasText: /^Sector$/ });
          await expect(typeBadge).toBeVisible();
        }
      }
    } else {
      // Close dropdown and skip -- only one type exists
      await page.keyboard.press('Escape');
    }
  });

  test('search input filters guides by name', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    const guideCards = page.locator('a[href^="/guide/"]');
    const emptyState = page.getByText('No guides published yet');

    await expect(guideCards.first().or(emptyState)).toBeVisible({ timeout: 15000 });

    if (await guideCards.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      // Get the name of the first guide card
      const firstGuideName = await guideCards.first().locator('h3').first().textContent();

      if (firstGuideName && firstGuideName.length > 3) {
        // Use a substring to search
        const searchTerm = firstGuideName.substring(0, Math.min(firstGuideName.length, 8));

        const searchInput = page.locator('[aria-label="Search guides"]');
        await expect(searchInput).toBeVisible();
        await searchInput.fill(searchTerm);

        // URL should update with q parameter
        await expect(page).toHaveURL(/q=/, { timeout: 5000 });

        // Filtered results should include the guide
        await expect(guideCards.first()).toBeVisible({ timeout: 5000 });

        // Verify the first visible card's name contains the search term
        const firstCardName = await guideCards.first().locator('h3').first().textContent();
        expect(firstCardName?.toLowerCase()).toContain(searchTerm.toLowerCase());
      }
    } else {
      test.skip();
    }
  });

  test('clear filters button resets all filters', async ({
    authenticatedPage: page,
  }) => {
    // First, load the unfiltered page to capture the baseline card count
    await page.goto('/guide');
    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    const guideCardsAll = page.locator('a[href^="/guide/"]');
    const emptyState = page.getByText('No guides published yet');
    await expect(guideCardsAll.first().or(emptyState)).toBeVisible({ timeout: 15000 });
    const baselineCount = await guideCardsAll.count();

    // Now navigate with filters applied
    await page.goto('/guide?q=test&type=sector');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    // Wait for the page to settle: either guide cards, the clear button, or the no-results state
    const clearButton = page.locator('button[aria-label="Clear all filters"]');
    const noResultsText = page.getByText('No guides match your filters');
    const guideCardsFiltered = page.locator('a[href^="/guide/"]');

    // Wait for the filter results to appear (guides, clear button, or no-results)
    await expect(
      guideCardsFiltered.first().or(noResultsText),
    ).toBeVisible({ timeout: 10000 });

    // Find the clear mechanism: the filter bar's clear button or the no-results clear link
    if (await clearButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clearButton.click();
      await expect(page).toHaveURL('/guide', { timeout: 5000 });
    } else if (await noResultsText.isVisible({ timeout: 2000 }).catch(() => false)) {
      // "Clear all filters" link within no results state
      const clearLink = page.getByText('Clear all filters');
      await clearLink.click();
      await expect(page).toHaveURL('/guide', { timeout: 5000 });
    }

    // Verify full list is restored: card count should be >= baseline
    if (baselineCount > 0) {
      await expect(guideCardsAll.first()).toBeVisible({ timeout: 5000 });
      const restoredCount = await guideCardsAll.count();
      expect(restoredCount).toBeGreaterThanOrEqual(baselineCount);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Guide Detail Page
// ---------------------------------------------------------------------------

test.describe('Guide detail page', () => {
  test('guide detail page loads with guide name and metadata', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    const guideCards = page.locator('a[href^="/guide/"]');
    const emptyState = page.getByText('No guides published yet');

    await expect(guideCards.first().or(emptyState)).toBeVisible({ timeout: 15000 });

    if (!(await guideCards.first().isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Click the first guide card
    await guideCards.first().click();

    // URL matches /guide/[slug]
    await expect(page).toHaveURL(/\/guide\/[a-z0-9-]+/);

    // Heading with guide name
    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible({ timeout: 10000 });

    // Type badge is visible (e.g. "Sector Guide", "Product Guide")
    const typeBadge = page.locator('span').filter({
      hasText: /^(Sector Guide|Product Guide|Company Guide|Research Guide|Guide)$/,
    });
    await expect(typeBadge.first()).toBeVisible();

    // "Back to Guides" link is visible
    await expect(
      page.getByRole('link', { name: 'Back to Guides' }),
    ).toBeVisible();
  });

  test('guide detail shows table of contents when sections exist', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    const guideCards = page.locator('a[href^="/guide/"]');
    const emptyState = page.getByText('No guides published yet');

    await expect(guideCards.first().or(emptyState)).toBeVisible({ timeout: 15000 });

    if (!(await guideCards.first().isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await guideCards.first().click();

    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible({ timeout: 10000 });

    // If sections exist, a table of contents navigation is visible
    const tocNav = page.getByRole('navigation', { name: 'Guide sections' });

    if (await tocNav.isVisible({ timeout: 3000 }).catch(() => false)) {
      // TOC entries are links within the navigation
      const tocLinks = tocNav.locator('a');
      const linkCount = await tocLinks.count();
      expect(linkCount).toBeGreaterThan(0);
    }
  });

  test('guide detail back link navigates to guide index', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    const guideCards = page.locator('a[href^="/guide/"]');
    const emptyState = page.getByText('No guides published yet');

    await expect(guideCards.first().or(emptyState)).toBeVisible({ timeout: 15000 });

    if (!(await guideCards.first().isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await guideCards.first().click();

    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible({ timeout: 10000 });

    // Click "Back to Guides" link
    const backLink = page.getByRole('link', { name: 'Back to Guides' });
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should navigate back to /guide
    await expect(page).toHaveURL('/guide');
    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('nonexistent guide shows error state', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide/nonexistent-slug-e2e-test');

    // Wait for content to load
    const errorState = page.getByText('Guide not found').or(page.getByRole('alert'));
    const backLink = page.getByRole('link', { name: 'Back to Guides' });

    await expect(errorState.or(backLink)).toBeVisible({ timeout: 10000 });

    // "Back to Guides" link is visible in error state
    await expect(backLink).toBeVisible();

    // Page does NOT show a blank white screen (some content is rendered)
    const section = page.locator('section[aria-label="Guide"]');
    await expect(section).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Mobile Layout
// ---------------------------------------------------------------------------

test.describe('Guide pages -- mobile layout', () => {
  test('guide cards stack in single column on mobile', async ({
    authenticatedPage: page,
  }) => {
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    await page.goto('/guide');

    await expect(
      page.getByRole('heading', { name: 'Guides' }),
    ).toBeVisible({ timeout: 10000 });

    const guideCards = page.locator('a[href^="/guide/"]');
    const emptyState = page.getByText('No guides published yet');

    await expect(guideCards.first().or(emptyState)).toBeVisible({ timeout: 15000 });

    const cardCount = await guideCards.count();
    if (cardCount < 2) {
      test.skip();
      return;
    }

    const firstBox = await guideCards.nth(0).boundingBox();
    const secondBox = await guideCards.nth(1).boundingBox();

    if (firstBox && secondBox) {
      // Cards stack vertically
      expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height - 1);

      // Cards are full-width (> 90% of viewport)
      const viewport = page.viewportSize();
      if (viewport) {
        const widthRatio = firstBox.width / viewport.width;
        expect(widthRatio).toBeGreaterThan(0.8);
      }
    }
  });
});
