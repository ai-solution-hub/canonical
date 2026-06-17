import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Workspaces Launcher
 *
 * Tests the /workspaces page showing workspace type cards (Bids active,
 * Sales Proposals coming soon) with counts and links.
 *
 * Worker-scoped data provides a bid workspace (workerData.procurementId).
 */

// ---------------------------------------------------------------------------
// 1. Workspaces Page
// ---------------------------------------------------------------------------

test.describe('Workspaces page', { tag: '@smoke' }, () => {
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
    const bidsCard = page.locator('a[aria-label^="Procurements"]').first();
    await expect(bidsCard).toBeVisible();

    // Card contains heading "Bids"
    await expect(
      bidsCard.getByRole('heading', { name: 'Procurements' }),
    ).toBeVisible();

    // Card contains description about bid responses
    await expect(bidsCard.getByText(/bid responses/)).toBeVisible();

    // Card has href="/procurement"
    await expect(bidsCard).toHaveAttribute('href', '/procurement');

    // Hard-expect the active procurements count renders. The worker-scoped
    // fixture (workerData.procurementId) seeds at least one active procurement,
    // so the count text must be visible; missing fixtures fail honestly.
    // Copy is driven by formatTypeCount() in hooks/workspaces/use-application-types.ts
    // -> `${count} active ${labelPlural.toLowerCase()}` and the procurement
    // application_type's labelPlural renders as "Procurements" (S248 rename).
    const countText = bidsCard.getByText(/\d+ active procurements?/);
    await expect(countText).toBeVisible({ timeout: 2000 });
  });

  test('bids card navigates to bid list on click', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    const bidsCard = page.locator('a[aria-label^="Procurements"]').first();
    await expect(bidsCard).toBeVisible();

    await bidsCard.click();

    await expect(page).toHaveURL('/procurement', { timeout: 10000 });
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

    // Target the Sales Proposals coming-soon card by its full, stable
    // aria-label (`${labelPlural} — coming soon`, built in workspaces-content.tsx).
    // NOTE 1: the DB seeds several coming-soon application_types
    // (competitor_research, product_guide, training_onboarding, sales_proposal),
    // so a bare `[aria-label*="coming soon"]`.first() would resolve to whichever
    // sorts first alphabetically (Competitor Research) — not Sales Proposals.
    // NOTE 2: scope via the AX region (getByRole('region', {name:'Workspaces'}))
    // — in Next.js 16 / React 19 dev mode a raw CSS/aria-label selector matches
    // the card twice (the hydrated card AND a duplicate inside the <div id="S:1">
    // streaming-suspense template). The accessibility tree only sees the hydrated
    // one, so region-scoping resolves the strict-mode duplicate. Same rationale
    // as the description assertion above (~line 34).
    const workspacesRegion = page.getByRole('region', { name: 'Workspaces' });
    const comingSoonCard = workspacesRegion.getByLabel(
      'Sales Proposals — coming soon',
    );
    await expect(comingSoonCard).toBeVisible();

    // Card contains heading "Sales Proposals" (application_types.label_plural)
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

    // Scope all card lookups via the AX region — in Next.js 16 / React 19 dev
    // mode the grid is rendered twice (hydrated tree + <div id="S:1"> streaming-
    // suspense template); the accessibility tree only exposes the hydrated copy,
    // so region-scoping avoids strict-mode duplicate matches and reads the real
    // laid-out boxes. (Same rationale as the description assertion ~line 34.)
    const workspacesRegion = page.getByRole('region', { name: 'Workspaces' });

    // Assert the responsive-grid property on the first two cards in DOM order.
    // They are always the first two grid cells (row 1, columns 1 & 2), so this
    // is independent of how many application_types the DB seeds or their sort
    // order — unlike pinning two specific named cards, which shift rows/columns
    // as the seed list grows.
    const cards = workspacesRegion.locator('div.grid > [aria-label]');

    // Both the active Procurements card and the Sales Proposals coming-soon card
    // must render (proves the SSR-seeded grid hydrated with its full card set).
    await expect(
      workspacesRegion.locator('a[aria-label^="Procurements"]'),
    ).toBeVisible();
    await expect(
      workspacesRegion.getByLabel('Sales Proposals — coming soon'),
    ).toBeVisible();

    const firstBox = await cards.nth(0).boundingBox();
    const secondBox = await cards.nth(1).boundingBox();

    if (firstBox && secondBox) {
      if (isMobileViewport(page)) {
        // Mobile (single column): cards stack vertically.
        expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height - 1);
      } else {
        // Desktop (multi-column): the first two cards sit side by side on the
        // same row (similar y, increasing x).
        expect(Math.abs(secondBox.y - firstBox.y)).toBeLessThan(50);
        expect(secondBox.x).toBeGreaterThan(firstBox.x);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Viewer Access
// ---------------------------------------------------------------------------

test.describe('Workspaces -- viewer access', { tag: '@smoke' }, () => {
  test('viewer can access workspaces page', async ({ viewerPage: page }) => {
    await page.goto('/workspaces');

    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible(
      { timeout: 10000 },
    );

    // Bids card is visible
    const bidsCard = page.locator('a[aria-label^="Procurements"]').first();
    await expect(bidsCard).toBeVisible();

    // URL does NOT redirect to /login
    await expect(page).not.toHaveURL(/\/login/);
  });
});
