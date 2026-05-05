import { test, expect } from '../fixtures';

/**
 * Flow: Guide Pages
 *
 * Tests the /guide redirect to /coverage?tab=guides and guide detail pages
 * at /guide/[slug]. The guide listing was consolidated into the Coverage
 * dashboard Guides tab (P1-28).
 *
 * The tests depend on guides existing in the production database.
 * If no guides exist, tests handle the empty state gracefully.
 */

// ---------------------------------------------------------------------------
// 1. /guide redirect
// ---------------------------------------------------------------------------

test.describe('Guide listing redirect', { tag: '@smoke' }, () => {
  test('/guide redirects to /coverage?tab=guides', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    // Should redirect to coverage with guides tab
    await expect(page).toHaveURL(/\/coverage\?tab=guides/, { timeout: 10000 });

    // Coverage dashboard heading should be visible
    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Guide Detail Page
// ---------------------------------------------------------------------------

test.describe('Guide detail page', { tag: '@smoke' }, () => {
  test('guide detail page loads with guide name and metadata', async ({
    authenticatedPage: page,
  }) => {
    // Navigate via coverage tab to find a guide
    await page.goto('/coverage?tab=guides');

    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible({ timeout: 10000 });

    // Look for guide links in the coverage guides tab
    const guideLink = page.locator('a[href^="/guide/"]').first();
    const emptyState = page.getByText('No guides published');

    await expect(guideLink.or(emptyState)).toBeVisible({ timeout: 15000 });

    // Hard-expect a guide link exists; staging must seed at least one published
    // guide for this test to pass. Empty fixtures should fail honestly here.
    await expect(guideLink).toBeVisible({ timeout: 2000 });

    // Click the first guide link
    await guideLink.click();

    // URL matches /guide/[slug]
    await expect(page).toHaveURL(/\/guide\/[a-z0-9-]+/);

    // Heading with guide name
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // Type badge is visible (e.g. "Sector Guide", "Product Guide")
    const typeBadge = page.locator('span').filter({
      hasText:
        /^(Sector Guide|Product Guide|Company Guide|Research Guide|Guide)$/,
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
    await page.goto('/coverage?tab=guides');

    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible({ timeout: 10000 });

    const guideLink = page.locator('a[href^="/guide/"]').first();
    const emptyState = page.getByText('No guides published');

    await expect(guideLink.or(emptyState)).toBeVisible({ timeout: 15000 });

    // Hard-expect a guide link exists; staging must seed at least one published
    // guide for this test to pass.
    await expect(guideLink).toBeVisible({ timeout: 2000 });

    await guideLink.click();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // If sections exist, a table of contents navigation is visible. Hard-expect
    // its presence — published guides are seeded with sections in staging.
    const tocNav = page.getByRole('navigation', { name: 'Guide sections' });
    await expect(tocNav).toBeVisible({ timeout: 3000 });

    // TOC entries are links within the navigation
    const tocLinks = tocNav.locator('a');
    const linkCount = await tocLinks.count();
    expect(linkCount).toBeGreaterThan(0);
  });

  test('guide detail back link navigates to coverage guides tab', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/coverage?tab=guides');

    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible({ timeout: 10000 });

    const guideLink = page.locator('a[href^="/guide/"]').first();
    const emptyState = page.getByText('No guides published');

    await expect(guideLink.or(emptyState)).toBeVisible({ timeout: 15000 });

    // Hard-expect a guide link exists; staging must seed at least one published
    // guide for this test to pass.
    await expect(guideLink).toBeVisible({ timeout: 2000 });

    await guideLink.click();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // Click "Back to Guides" link
    const backLink = page.getByRole('link', { name: 'Back to Guides' });
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should navigate to coverage with guides tab
    await expect(page).toHaveURL(/\/coverage\?tab=guides/, { timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('nonexistent guide shows error state', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide/nonexistent-slug-e2e-test');

    // Wait for content to load
    const errorState = page
      .getByText('Guide not found')
      .or(page.getByRole('alert'));
    const backLink = page.getByRole('link', { name: 'Back to Guides' });

    await expect(errorState.or(backLink)).toBeVisible({ timeout: 10000 });

    // "Back to Guides" link is visible in error state
    await expect(backLink).toBeVisible();

    // Page does NOT show a blank white screen (some content is rendered)
    const section = page.locator('section[aria-label="Guide"]');
    await expect(section).toBeVisible();
  });
});
