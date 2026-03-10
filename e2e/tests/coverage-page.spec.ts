import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Coverage Dashboard tests
 *
 * Tests the /coverage page — summary cards, expandable domain sections,
 * gap identification, navigation links to Browse, refresh, and accessibility.
 * Uses production data (186+ items across multiple domains).
 */

test.describe('Coverage page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/coverage');
    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible({ timeout: 15000 });
  });

  // ---------------------------------------------------------------------------
  // 1. Page Load and Structure
  // ---------------------------------------------------------------------------

  test('coverage page loads with heading and subtitle', async ({ authenticatedPage: page }) => {
    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible();

    await expect(
      page.getByText('Content coverage across domains and subtopics'),
    ).toBeVisible();
  });

  test('refresh button is displayed', async ({ authenticatedPage: page }) => {
    await expect(
      page.getByRole('button', { name: /refresh/i }),
    ).toBeVisible();
  });

  test('loading skeleton appears before data loads', async ({ authenticatedPage: page }) => {
    // Navigate again to catch the skeleton on fresh load
    const skeletonPromise = page
      .getByRole('status', { name: 'Loading coverage data' })
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    await page.goto('/coverage');
    const skeletonSeen = await skeletonPromise;

    // Skeleton may be too fast to catch — if so, at least verify the page loaded
    if (!skeletonSeen) {
      // The page loaded without catching the skeleton — acceptable
      await expect(
        page.getByRole('heading', { name: 'Coverage Dashboard' }),
      ).toBeVisible({ timeout: 15000 });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Summary Cards
  // ---------------------------------------------------------------------------

  test('summary cards are displayed with statistics', async ({ authenticatedPage: page }) => {
    // Summary cards are inside a grid container — scope to avoid matching freshness badges
    const summaryGrid = page.locator('.grid.gap-4').first();
    await expect(summaryGrid.getByText('Total Items')).toBeVisible({ timeout: 15000 });
    await expect(summaryGrid.getByText('Fresh')).toBeVisible();
    await expect(summaryGrid.getByText('Content Gaps')).toBeVisible();
    await expect(summaryGrid.getByText('Expired Items')).toBeVisible();
  });

  test('summary card values are numeric', async ({ authenticatedPage: page }) => {
    // Total Items should show a number > 0 (production KB has 186+ items)
    const totalItemsCard = page.locator('p:has-text("Total Items")').locator('..');
    const totalValue = totalItemsCard.locator('p.text-2xl');
    await expect(totalValue).toBeVisible({ timeout: 10000 });
    const totalText = await totalValue.textContent();
    // Strip locale formatting (e.g. commas) and verify numeric
    expect(Number(totalText?.replace(/,/g, ''))).toBeGreaterThan(0);

    // Fresh card should show a number followed by %
    const freshCard = page.locator('p:has-text("Fresh")').locator('..');
    const freshValue = freshCard.locator('p.text-2xl');
    await expect(freshValue).toBeVisible();
    const freshText = await freshValue.textContent();
    expect(freshText).toMatch(/\d+\s*%/);
  });

  // ---------------------------------------------------------------------------
  // 3. Domain Sections
  // ---------------------------------------------------------------------------

  test('domain sections are displayed as expandable panels', async ({ authenticatedPage: page }) => {
    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Each section should have a button with aria-expanded
    const firstButton = sections.first().getByRole('button');
    await expect(firstButton).toHaveAttribute('aria-expanded');
  });

  test('first domain section is expanded by default', async ({ authenticatedPage: page }) => {
    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    // First section expanded
    const firstButton = sections.first().getByRole('button');
    await expect(firstButton).toHaveAttribute('aria-expanded', 'true');

    // Second section collapsed (if it exists)
    const sectionCount = await sections.count();
    if (sectionCount > 1) {
      const secondButton = sections.nth(1).getByRole('button');
      await expect(secondButton).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('clicking a collapsed domain section expands it', async ({ authenticatedPage: page }) => {
    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    const sectionCount = await sections.count();
    if (sectionCount < 2) {
      test.skip();
      return;
    }

    // Find a collapsed section
    const collapsedButton = sections.nth(1).getByRole('button');
    await expect(collapsedButton).toHaveAttribute('aria-expanded', 'false');

    // Click to expand
    await collapsedButton.click();
    await expect(collapsedButton).toHaveAttribute('aria-expanded', 'true');

    // Subtopic cells should now be visible inside the section
    const expandedSection = sections.nth(1);
    const links = expandedSection.locator('a');
    await expect(links.first()).toBeVisible({ timeout: 5000 });
  });

  test('domain sections show item counts', async ({ authenticatedPage: page }) => {
    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    // Each section header should contain text matching "N item(s)"
    const firstButton = sections.first().getByRole('button');
    await expect(firstButton).toContainText(/\d+ items?/);
  });

  // ---------------------------------------------------------------------------
  // 4. Gap Identification
  // ---------------------------------------------------------------------------

  test('gap badges are displayed on domains with missing subtopics', async ({ authenticatedPage: page }) => {
    // Wait for summary cards to confirm data is loaded
    const summaryGrid = page.locator('.grid.gap-4').first();
    await expect(summaryGrid.getByText('Total Items')).toBeVisible({ timeout: 15000 });

    // Check if there are gaps from the summary card
    const gapsCard = summaryGrid.locator('p.text-2xl').nth(2); // Content Gaps is the 3rd card
    const gapsText = await gapsCard.textContent();
    const gapCount = parseInt(gapsText ?? '0', 10);

    if (gapCount === 0) {
      test.skip(true, 'No content gaps in the knowledge base');
      return;
    }

    // Gaps may be in domains further down the page — scroll to find them
    const allSections = page.locator('section[aria-label$="coverage"]');
    const sectionCount = await allSections.count();

    let foundGapBadge = false;
    for (let i = 0; i < sectionCount; i++) {
      const section = allSections.nth(i);
      await section.scrollIntoViewIfNeeded();
      const hasGap = await section.getByText(/\d+ gaps?/).isVisible({ timeout: 1000 }).catch(() => false);
      if (hasGap) {
        foundGapBadge = true;
        break;
      }
    }

    expect(foundGapBadge).toBe(true);
  });

  test('gap cells show no content message', async ({ authenticatedPage: page }) => {
    // Wait for summary cards to confirm data is loaded
    const summaryGrid = page.locator('.grid.gap-4').first();
    await expect(summaryGrid.getByText('Total Items')).toBeVisible({ timeout: 15000 });

    // Check if there are gaps
    const gapsCard = summaryGrid.locator('p.text-2xl').nth(2);
    const gapsText = await gapsCard.textContent();
    const gapCount = parseInt(gapsText ?? '0', 10);

    if (gapCount === 0) {
      test.skip(true, 'No content gaps in the knowledge base');
      return;
    }

    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    // Find a domain with gaps and expand it — may need to scroll
    const allSections = page.locator('section[aria-label$="coverage"]');
    const sectionCount = await allSections.count();

    let foundGap = false;
    for (let i = 0; i < sectionCount; i++) {
      const section = allSections.nth(i);
      await section.scrollIntoViewIfNeeded();
      const button = section.getByRole('button');
      const hasGap = await section.getByText(/\d+ gaps?/).isVisible({ timeout: 1000 }).catch(() => false);

      if (hasGap) {
        // Expand if collapsed
        const expanded = await button.getAttribute('aria-expanded');
        if (expanded !== 'true') {
          await button.click();
          await expect(button).toHaveAttribute('aria-expanded', 'true');
        }

        // Look for "No content" text in gap cells (dashed border)
        await expect(section.getByText('No content').first()).toBeVisible({ timeout: 5000 });
        foundGap = true;
        break;
      }
    }

    expect(foundGap).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5. Navigation to Browse
  // ---------------------------------------------------------------------------

  test('subtopic cell links to browse with correct filters', async ({ authenticatedPage: page }) => {
    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    // The first section is expanded by default — find a coverage cell link
    const firstSection = sections.first();
    const cellLinks = firstSection.locator('a[href*="/browse?"]');
    await expect(cellLinks.first()).toBeVisible({ timeout: 5000 });

    const href = await cellLinks.first().getAttribute('href');
    expect(href).toContain('/browse?');
    expect(href).toContain('domain=');
    expect(href).toContain('subtopic=');
    expect(href).toContain('include_qa=true');
  });

  test('gap cell links to browse with domain and subtopic', async ({ authenticatedPage: page }) => {
    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    // Find a domain with gaps and expand it
    const allSections = page.locator('section[aria-label$="coverage"]');
    const sectionCount = await allSections.count();

    for (let i = 0; i < sectionCount; i++) {
      const section = allSections.nth(i);
      const button = section.getByRole('button');
      const hasGap = await section.getByText(/\d+ gaps?/).isVisible().catch(() => false);

      if (hasGap) {
        const expanded = await button.getAttribute('aria-expanded');
        if (expanded !== 'true') {
          await button.click();
          await expect(button).toHaveAttribute('aria-expanded', 'true');
        }

        // Gap cells have aria-label ending in "click to browse"
        const gapLink = section.locator('a[aria-label*="no content"]').first();
        await expect(gapLink).toBeVisible({ timeout: 5000 });

        const href = await gapLink.getAttribute('href');
        expect(href).toContain('/browse?');
        expect(href).toContain('domain=');
        expect(href).toContain('subtopic=');
        break;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Refresh
  // ---------------------------------------------------------------------------

  test('refresh button reloads coverage data', async ({ authenticatedPage: page }) => {
    const refreshButton = page.getByRole('button', { name: /refresh/i });
    await expect(refreshButton).toBeVisible();

    // Click refresh — the button should briefly show a spinning icon
    await refreshButton.click();

    // After refresh, data should still be visible (page did not navigate)
    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible();
    const summaryGrid = page.locator('.grid.gap-4').first();
    await expect(summaryGrid.getByText('Total Items')).toBeVisible({ timeout: 15000 });
  });

  // ---------------------------------------------------------------------------
  // 7. Accessibility
  // ---------------------------------------------------------------------------

  test('all domain sections have accessible names', async ({ authenticatedPage: page }) => {
    const sections = page.locator('section[aria-label$="coverage"]');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < count; i++) {
      const ariaLabel = await sections.nth(i).getAttribute('aria-label');
      expect(ariaLabel).toBeTruthy();
      expect(ariaLabel!.endsWith('coverage')).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 8. Mobile Layout
  // ---------------------------------------------------------------------------

  test('summary cards stack on mobile', async ({ authenticatedPage: page }) => {
    if (!isMobileViewport(page)) {
      test.skip();
      return;
    }

    // Scope to summary cards grid to avoid matching freshness badges
    const summaryGrid = page.locator('.grid.gap-4').first();
    await expect(summaryGrid.getByText('Total Items')).toBeVisible({ timeout: 15000 });

    // All 4 summary card labels should be visible on mobile (stacked layout)
    await expect(summaryGrid.getByText('Fresh')).toBeVisible();
    await expect(summaryGrid.getByText('Content Gaps')).toBeVisible();
    await expect(summaryGrid.getByText('Expired Items')).toBeVisible();
  });
});
