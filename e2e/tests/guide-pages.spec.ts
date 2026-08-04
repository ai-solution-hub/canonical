import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { attachConsoleGate, type ConsoleGate } from '../helpers/console-gate';

/**
 * Flow: Guide Pages
 *
 * Tests the /guide redirect to /coverage?tab=guides and guide detail pages
 * at /guide/[slug].
 *
 * DR-034 (749309a1) retired the Coverage dashboard's Guides tab UI (and the
 * content_items-era coverage listing it lived in) — CoveragePageTabs now
 * renders only TemplateCoverageContent, so there is no listing page left to
 * click a guide link from. The `/guide/[slug]` reader route and its backing
 * `/api/guides` list endpoint are still live (the guides table itself was
 * not retired), so the detail-page tests below source a published guide's
 * slug directly from `/api/guides` instead of navigating a listing UI that
 * no longer exists.
 *
 * The tests depend on guides existing in the database. Empty fixtures fail
 * honestly here rather than silently passing via an empty-state check —
 * staging must seed at least one published guide.
 */

/** Fetch the first published guide's slug via the live `/api/guides` list endpoint. */
async function firstPublishedGuideSlug(page: Page): Promise<string> {
  const response = await page.request.get('/api/guides');
  expect(response.ok()).toBe(true);
  const guides: Array<{ slug: string }> = await response.json();
  // Hard-expect at least one published guide; staging must seed one for
  // this test to pass. Empty fixtures should fail honestly here.
  expect(guides.length).toBeGreaterThan(0);
  return guides[0].slug;
}

// ---------------------------------------------------------------------------
// 1. /guide listing (rebuilt S531 — the old redirect aimed at the retired
//    /coverage?tab=guides ghost; DR-126 makes guides first-class)
// ---------------------------------------------------------------------------

test.describe('Guide listing', { tag: '@smoke' }, () => {
  // bl-336: opt-in browser-error gate (see e2e/helpers/console-gate.ts).
  let gate: ConsoleGate;
  test.beforeEach(({ authenticatedPage }) => {
    gate = attachConsoleGate(authenticatedPage);
  });
  test.afterEach(() => {
    gate.assertNoConsoleViolations();
  });

  test('/guide renders the guides listing', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/guide');

    await expect(page).toHaveURL(/\/guide$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Guides' })).toBeVisible({
      timeout: 10000,
    });

    // Seeded staging carries published guides — the listing links to them.
    const guideLinks = page.locator('a[href^="/guide/"]');
    await expect(guideLinks.first()).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Guide Detail Page
// ---------------------------------------------------------------------------

test.describe('Guide detail page', { tag: '@smoke' }, () => {
  // bl-336: opt-in browser-error gate (see e2e/helpers/console-gate.ts).
  let gate: ConsoleGate;
  test.beforeEach(({ authenticatedPage }) => {
    gate = attachConsoleGate(authenticatedPage);
  });
  test.afterEach(() => {
    gate.assertNoConsoleViolations();
  });

  test('guide detail page loads with guide name and metadata', async ({
    authenticatedPage: page,
  }) => {
    const slug = await firstPublishedGuideSlug(page);
    await page.goto(`/guide/${slug}`);

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
    const slug = await firstPublishedGuideSlug(page);
    await page.goto(`/guide/${slug}`);

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

  test('guide detail back link navigates to the guides listing', async ({
    authenticatedPage: page,
  }) => {
    const slug = await firstPublishedGuideSlug(page);
    await page.goto(`/guide/${slug}`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // Click "Back to Guides" link
    const backLink = page.getByRole('link', { name: 'Back to Guides' });
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Navigates to the rebuilt /guide listing (S531)
    await expect(page).toHaveURL(/\/guide$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Guides' })).toBeVisible({
      timeout: 10000,
    });
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
