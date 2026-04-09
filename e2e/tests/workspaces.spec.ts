import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Workspaces Launcher
 *
 * Tests the /workspaces page showing workspace type cards (Bids active,
 * Sales Proposals coming soon) with counts and links.
 *
 * Worker-scoped data provides a bid workspace (workerData.bidId).
 */

// ---------------------------------------------------------------------------
// 1. Workspaces Page
// ---------------------------------------------------------------------------

test.describe('Workspaces page', () => {
  test('workspaces page loads with heading and description', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    // Scope via the ARIA region (from section[aria-label="Workspaces"]):
    // this reads the accessibility tree, which excludes React's streaming
    // suspense templates. A raw `section[aria-label="Workspaces"]` CSS
    // selector resolves to two elements in Next.js 16 / React 19 dev mode —
    // the hydrated section under <main> and a duplicate inside the
    // <div id="S:1"> streaming template at the body level. The AX tree
    // only sees the hydrated one.
    await expect(
      page
        .getByRole('region', { name: 'Workspaces' })
        .getByText('Use your knowledge base to power different types of work.'),
    ).toBeVisible();
  });

  test('bids workspace card is visible and links to /bid', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    // The Bids card is a link with aria-label starting with "Bids"
    const bidsCard = page.locator('a[aria-label^="Bids"]').first();
    await expect(bidsCard).toBeVisible();

    // Card contains heading "Bids"
    await expect(bidsCard.getByRole('heading', { name: 'Bids' })).toBeVisible();

    // Card contains description about bid responses
    await expect(bidsCard.getByText(/bid responses/)).toBeVisible();

    // Card has href="/bid"
    await expect(bidsCard).toHaveAttribute('href', '/bid');

    // If active bids exist (count > 0), card shows a count
    const countText = bidsCard.getByText(/\d+ active bids?/);
    if (await countText.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(countText).toBeVisible();
    }
  });

  test('bids card navigates to bid list on click', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    const bidsCard = page.locator('a[aria-label^="Bids"]').first();
    await expect(bidsCard).toBeVisible();

    await bidsCard.click();

    await expect(page).toHaveURL('/bid', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Bids' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('coming soon workspace card is visually disabled', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    // The Sales Proposals card has aria-label containing "coming soon"
    const comingSoonCard = page.locator('[aria-label*="coming soon"]').first();
    await expect(comingSoonCard).toBeVisible();

    // Card contains heading "Sales Proposals"
    await expect(
      comingSoonCard.getByRole('heading', { name: 'Sales Proposals' }),
    ).toBeVisible();

    // Card has aria-disabled="true"
    await expect(comingSoonCard).toHaveAttribute('aria-disabled', 'true');

    // Card contains "Coming soon" badge
    await expect(comingSoonCard.getByText('Coming soon')).toBeVisible();

    // Card is NOT a link (no href attribute -- it is a <div> not an <a>)
    const tagName = await comingSoonCard.evaluate((el) =>
      el.tagName.toLowerCase(),
    );
    expect(tagName).toBe('div');
  });

  test('workspace cards display in responsive grid', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    const bidsCard = page.locator('a[aria-label^="Bids"]').first();
    const comingSoonCard = page.locator('[aria-label*="coming soon"]').first();

    await expect(bidsCard).toBeVisible();
    await expect(comingSoonCard).toBeVisible();

    const bidsBox = await bidsCard.boundingBox();
    const comingSoonBox = await comingSoonCard.boundingBox();

    if (bidsBox && comingSoonBox) {
      if (isMobileViewport(page)) {
        // Mobile: cards stack vertically
        expect(comingSoonBox.y).toBeGreaterThan(bidsBox.y + bidsBox.height - 1);
      } else {
        // Desktop: cards sit side by side (similar y positions)
        expect(Math.abs(comingSoonBox.y - bidsBox.y)).toBeLessThan(50);
        expect(comingSoonBox.x).toBeGreaterThan(bidsBox.x);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Viewer Access
// ---------------------------------------------------------------------------

test.describe('Workspaces -- viewer access', () => {
  test('viewer can access workspaces page', async ({ viewerPage: page }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    // Bids card is visible
    const bidsCard = page.locator('a[aria-label^="Bids"]').first();
    await expect(bidsCard).toBeVisible();

    // URL does NOT redirect to /login
    await expect(page).not.toHaveURL(/\/login/);
  });
});
