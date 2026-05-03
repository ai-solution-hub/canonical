import { test, expect } from '../fixtures';

/**
 * Coverage Dashboard tests
 *
 * Asserts the post-P1-29 tab-based dashboard structure:
 *   - Tabs: priority-gaps (default), taxonomy ("Domain Coverage"), templates,
 *     guides.
 *   - Summary cards + refresh button + domain sections live under the
 *     `taxonomy` tab — no longer at the root of /coverage.
 *
 * The tests deliberately use accessible role + name selectors so they survive
 * cosmetic refactors. No `data-testid` reliance, no conditional fallbacks.
 */

test.describe('Coverage page', { tag: '@smoke' }, () => {
  // ---------------------------------------------------------------------------
  // 1. Page loads with header + subtitle
  // ---------------------------------------------------------------------------

  test('loads at /coverage with heading and subtitle', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/coverage');

    await expect(
      page.getByRole('heading', { name: 'Coverage Dashboard' }),
    ).toBeVisible();
    await expect(
      page.getByText('Measure knowledge base completeness'),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 2. Domain Coverage tab (?tab=taxonomy) reveals summary cards + refresh
  // ---------------------------------------------------------------------------

  test('?tab=taxonomy reveals summary cards and refresh button', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/coverage?tab=taxonomy');

    // The Domain Coverage tab should be the active one.
    await expect(
      page.getByRole('tab', { name: /domain coverage/i }),
    ).toHaveAttribute('aria-selected', 'true');

    // Summary cards — labels live inside the taxonomy tab panel and only
    // render once the /api/coverage fetch resolves.
    const taxonomyPanel = page.getByRole('tabpanel', {
      name: /domain coverage/i,
    });
    await expect(taxonomyPanel.getByText('Total Items')).toBeVisible();
    await expect(taxonomyPanel.getByText('Fresh', { exact: true })).toBeVisible();
    await expect(taxonomyPanel.getByText('Content Gaps')).toBeVisible();
    await expect(taxonomyPanel.getByText('Expired Items')).toBeVisible();

    // Refresh button is in the taxonomy panel toolbar.
    await expect(
      taxonomyPanel.getByRole('button', { name: /refresh/i }),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 3. Domain Coverage tab shows expandable domain sections with item counts
  // ---------------------------------------------------------------------------

  test('Domain Coverage tab shows expandable domain sections with item counts', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/coverage?tab=taxonomy');

    const taxonomyPanel = page.getByRole('tabpanel', {
      name: /domain coverage/i,
    });

    // Each `<section aria-label="<Domain> coverage">` renders as role=region.
    // First-region wait absorbs the /api/coverage round-trip.
    const domainRegions = taxonomyPanel.getByRole('region', {
      name: /coverage$/i,
    });
    await expect(domainRegions.first()).toBeVisible();

    // At least one domain section must be present.
    expect(await domainRegions.count()).toBeGreaterThanOrEqual(1);

    // The section header is a button with aria-expanded — first section
    // starts expanded by default (defaultExpanded={index === 0}).
    const firstSectionButton = domainRegions.first().getByRole('button').first();
    await expect(firstSectionButton).toHaveAttribute('aria-expanded', 'true');

    // Header text includes "<n> item" / "<n> items" — proves the count
    // surface is rendered.
    await expect(firstSectionButton).toContainText(/\d+ items?/);
  });

  // ---------------------------------------------------------------------------
  // 4. Coverage cell links route to /browse with filter params
  // ---------------------------------------------------------------------------

  test('coverage cells link to /browse with domain + subtopic params', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/coverage?tab=taxonomy');

    const taxonomyPanel = page.getByRole('tabpanel', {
      name: /domain coverage/i,
    });

    // Wait for at least one domain section to materialise.
    const firstRegion = taxonomyPanel
      .getByRole('region', { name: /coverage$/i })
      .first();
    await expect(firstRegion).toBeVisible();

    // The first section is expanded by default, so its coverage cells render
    // links with /browse?... hrefs. Two link shapes appear here:
    //   - CoverageCell: /browse?domain=X&subtopic=Y&include_qa=true
    //   - CoverageGapCell: /browse?domain=X&subtopic=Y
    // Both must resolve to a /browse URL with domain + subtopic params, so
    // we assert the contract on the first /browse link in the section.
    const browseLink = firstRegion.locator('a[href*="/browse?"]').first();
    await expect(browseLink).toBeVisible();

    const href = await browseLink.getAttribute('href');
    expect(href).toBeTruthy();

    // Resolve relative href against the page URL to validate query params.
    const resolved = new URL(href!, page.url());
    expect(resolved.pathname).toBe('/browse');
    expect(resolved.searchParams.get('domain')).toBeTruthy();
    expect(resolved.searchParams.get('subtopic')).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // 5. Default tab on plain /coverage is priority-gaps
  // ---------------------------------------------------------------------------

  test('default tab on plain /coverage is priority-gaps', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/coverage');

    // Radix tabs surface aria-selected on the active trigger. The Priority
    // Gaps trigger should be selected when no ?tab= query param is given.
    await expect(
      page.getByRole('tab', { name: /priority gaps/i }),
    ).toHaveAttribute('aria-selected', 'true');

    // Sibling tabs must not be selected.
    await expect(
      page.getByRole('tab', { name: /domain coverage/i }),
    ).toHaveAttribute('aria-selected', 'false');
    await expect(
      page.getByRole('tab', { name: /^templates$/i }),
    ).toHaveAttribute('aria-selected', 'false');
    await expect(
      page.getByRole('tab', { name: /^guides$/i }),
    ).toHaveAttribute('aria-selected', 'false');
  });
});
