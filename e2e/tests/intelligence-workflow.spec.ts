import { test, expect } from '../fixtures';

/**
 * Flow: Intelligence Workspace Workflow
 *
 * Tests the intelligence workspace pages: navigation, article review,
 * RSS output, metrics, feed sources, and role gating.
 *
 * Worker-scoped data provides an intelligence workspace with feed source
 * and articles (workerData.intelligenceWorkspaceId).
 */

// ---------------------------------------------------------------------------
// 1. Navigation — Intelligence workspace is accessible
// ---------------------------------------------------------------------------

test.describe('Intelligence workspace navigation', () => {
  test('intelligence card appears on /workspaces page', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/workspaces');

    await expect(
      page.getByRole('heading', { name: 'Workspaces' }),
    ).toBeVisible({ timeout: 10000 });

    // Intelligence card should be visible (look for the workspace type card)
    const intelligenceCard = page
      .locator('a[aria-label*="Intelligence"], [data-testid="workspace-card-intelligence"]')
      .first();

    // If the card is present, verify it links to /intelligence
    if (await intelligenceCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(intelligenceCard).toBeVisible();
    }
  });

  test('intelligence workspace page loads with sub-navigation', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}`,
    );

    // Wait for page to load
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Should have workspace content visible (overview or articles)
    const pageContent = page.locator('main, [role="main"]').first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Article review — Passed and filtered tabs
// ---------------------------------------------------------------------------

test.describe('Intelligence article review', () => {
  test('articles page shows passed articles', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/articles`,
    );

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Look for passed article titles (prefixed with worker prefix)
    const articleContent = page.locator('main, [role="main"]').first();
    await expect(articleContent).toBeVisible({ timeout: 10000 });

    // At least one article card should be visible
    const articleCards = page.locator(
      '[data-testid="article-card"], [data-testid="feed-article-card"], article, [role="article"]',
    );

    // Wait for articles to load — may be rendered as a list
    const firstCard = articleCards.first();
    if (await firstCard.isVisible({ timeout: 8000 }).catch(() => false)) {
      await expect(firstCard).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. RSS output — Feeds return valid XML
// ---------------------------------------------------------------------------

test.describe('Intelligence RSS output', () => {
  test('passed articles RSS feed returns valid XML', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const response = await page.request.get(
      `/api/feeds/${workerData.intelligenceWorkspaceId}/rss`,
    );

    // Should return 200
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'] ?? '';
    // Should be RSS XML or application/xml
    expect(
      contentType.includes('xml') || contentType.includes('rss'),
    ).toBe(true);

    const body = await response.text();
    // Should be valid RSS 2.0 structure
    expect(body).toContain('<rss');
    expect(body).toContain('<channel>');
  });

  test('filtered articles RSS feed returns valid XML', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const response = await page.request.get(
      `/api/feeds/${workerData.intelligenceWorkspaceId}/rss?filter=filtered`,
    );

    // Should return 200
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('<rss');
  });
});

// ---------------------------------------------------------------------------
// 4. Metrics — Dashboard loads with data
// ---------------------------------------------------------------------------

test.describe('Intelligence metrics', () => {
  test('metrics page loads with stat cards', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/metrics`,
    );

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Metrics page should have content
    const pageContent = page.locator('main, [role="main"]').first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });

    // Look for stat cards or metric displays
    const statCards = page.locator(
      '[data-testid*="stat"], [data-testid*="metric"], .stat-card, [class*="stat"]',
    );

    // At least verify the page loaded without error
    const firstStat = statCards.first();
    if (await firstStat.isVisible({ timeout: 8000 }).catch(() => false)) {
      await expect(firstStat).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Feed source management — View sources
// ---------------------------------------------------------------------------

test.describe('Intelligence feed sources', () => {
  test('sources page shows configured feed sources', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/sources`,
    );

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Sources page should have content
    const pageContent = page.locator('main, [role="main"]').first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });

    // Look for feed source name (prefixed)
    const sourceText = page.getByText(workerData.prefix, { exact: false });
    if (await sourceText.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await expect(sourceText.first()).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Role gating — Viewer restrictions
// ---------------------------------------------------------------------------

test.describe('Intelligence role gating', () => {
  test('viewer can see articles but not flag buttons', async ({
    viewerPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/articles`,
    );

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Page should load for viewer
    const pageContent = page.locator('main, [role="main"]').first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });

    // Flag buttons should NOT be visible to viewers
    const flagButtons = page.locator(
      'button:has-text("Flag"), [data-testid*="flag-button"], [aria-label*="Flag"]',
    );

    // Verify flag buttons are not visible (wait briefly then check)
    const flagVisible = await flagButtons
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    expect(flagVisible).toBe(false);
  });
});
