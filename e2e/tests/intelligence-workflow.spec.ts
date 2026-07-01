import { test, expect } from '../fixtures';

/**
 * Flow: Intelligence Workspace Workflow
 *
 * Tests the intelligence workspace pages: navigation, article review,
 * RSS output, metrics, feed sources, flag creation, and role gating.
 *
 * Worker-scoped data provides an intelligence workspace with feed source
 * and articles (workerData.intelligenceWorkspaceId).
 * Fixture seeds: 2 passed articles + 1 filtered article (relevance_score 0.15).
 */

// ---------------------------------------------------------------------------
// 1. Navigation — Intelligence workspace is accessible
// ---------------------------------------------------------------------------

test.describe('Intelligence workspace navigation', () => {
  test('intelligence card appears on /workspaces page', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    // Intelligence card should be visible (look for the workspace type card)
    const intelligenceCard = page
      .locator(
        'a[aria-label*="Intelligence"], [data-testid="workspace-card-intelligence"]',
      )
      .first();

    await expect(intelligenceCard).toBeVisible({ timeout: 5000 });
  });

  test('intelligence workspace page loads with sub-navigation', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(`/intelligence/${workerData.intelligenceWorkspaceId}`);

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
    await expect(articleCards.first()).toBeVisible({ timeout: 8000 });

    // SI-L6: stronger assertion — verify the seed-data article title appears in
    // the DOM, not just that some card rendered. The fixture seeds articles
    // with the worker prefix to avoid cross-test interference. The title must
    // match the actually-seeded passed article (buildIntelligenceFeedArticles
    // in e2e/fixtures/test-data.ts: 'Major Cyber Security Regulation Update',
    // relevance 0.92, passed:true) — the prior 'High-Relevance Government
    // Article' literal never matched any seed (latent-red since b4e7837c).
    const seedTitle = page.getByText(
      `${workerData.prefix} Major Cyber Security Regulation Update`,
      { exact: false },
    );
    await expect(seedTitle).toBeVisible({ timeout: 5000 });
  });

  test('filtered tab shows filtered articles sorted by score', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/articles`,
    );

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Switch to the Filtered tab
    const filteredTab = page.getByRole('tab', { name: /Filtered/i });
    await expect(filteredTab).toBeVisible({ timeout: 8000 });
    await filteredTab.click();

    // Wait for filtered articles to load
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // The fixture seeds 1 filtered article ("Irrelevant Sports Article", score 0.15)
    // Verify at least one article appears in the filtered view
    const articleCards = page.locator(
      '[data-testid="article-card"], [data-testid="feed-article-card"], article, [role="article"]',
    );
    await expect(articleCards.first()).toBeVisible({ timeout: 8000 });

    // Verify the filtered article title contains the worker prefix
    const filteredArticleText = page.getByText(
      `${workerData.prefix} Irrelevant Sports Article`,
      { exact: false },
    );
    await expect(filteredArticleText).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Flag creation — Admin/editor can flag an article
// ---------------------------------------------------------------------------

test.describe('Intelligence flag creation', () => {
  test('admin can flag a passed article as false positive', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/articles`,
    );

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Wait for articles to render
    const articleCards = page.locator(
      '[data-testid="article-card"], [data-testid="feed-article-card"], article, [role="article"]',
    );
    await expect(articleCards.first()).toBeVisible({ timeout: 8000 });

    // Find a flag button (text "Flag as irrelevant" on passed tab)
    const flagButton = page
      .getByRole('button', { name: /Flag as irrelevant/i })
      .first();
    await expect(flagButton).toBeVisible({ timeout: 5000 });
    await flagButton.click();

    // Flag dialog should appear
    const flagDialog = page.getByRole('dialog');
    await expect(flagDialog).toBeVisible({ timeout: 5000 });

    // Submit the flag (dialog has a submit button)
    const submitButton = flagDialog.getByRole('button', {
      name: /Submit|Flag|Confirm/i,
    });
    await expect(submitButton).toBeVisible({ timeout: 3000 });
    await submitButton.click();

    // After flagging, the button should change to "Flagged" (disabled state)
    const flaggedButton = page
      .getByRole('button', { name: /Flagged/i })
      .first();
    await expect(flaggedButton).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 4. RSS output — Feeds return valid XML
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
    expect(contentType.includes('xml') || contentType.includes('rss')).toBe(
      true,
    );

    const body = await response.text();
    // Should be valid RSS 2.0 structure
    expect(body).toContain('<rss');
    expect(body).toContain('<channel>');
    // SI-L6: stronger assertion — verify the seed-data article title appears
    // in the RSS body, not just that XML structure rendered. Matches the
    // actually-seeded passed article (test-data.ts: 'Major Cyber Security
    // Regulation Update', passed:true) — the prior 'High-Relevance Government
    // Article' literal never matched any seed (latent-red since b4e7837c).
    expect(body).toContain(
      `${workerData.prefix} Major Cyber Security Regulation Update`,
    );
  });

  test('filtered articles RSS feed returns valid XML', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const response = await page.request.get(
      `/api/feeds/${workerData.intelligenceWorkspaceId}/rss/filtered`,
    );

    // Should return 200
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('<rss');
    expect(body).toContain('<channel>');
  });
});

// ---------------------------------------------------------------------------
// 5. Metrics — Dashboard loads with data
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
  });
});

// ---------------------------------------------------------------------------
// 6. Feed source management — View sources
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
    await expect(sourceText.first()).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 7. Role gating — Viewer restrictions
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

    // Verify flag buttons are not present (use count assertion instead of .catch)
    await expect(flagButtons).toHaveCount(0, { timeout: 3000 });
  });
});
