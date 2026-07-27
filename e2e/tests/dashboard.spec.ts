import { test, expect } from '../fixtures';
import { isMobileViewport, searchFromHeader } from '../helpers/responsive';

/**
 * Flow: Dashboard
 *
 * Tests the home page (`/`) which is the primary entry point for all users.
 * The dashboard contains a hero search bar, reorientation section, unified
 * attention section, active bids section, owned content health, quick stats
 * strip, compliance status section, and recent activity feed.
 *
 * All sections are server-rendered with Suspense boundaries.
 *
 * Worker-scoped data provides 12 content items (with aging/stale/expired
 * freshness applied to their `record_lifecycle` rows), 2 workspaces,
 * 2 procurement items (1 in drafting state), and notifications.
 */

// ---------------------------------------------------------------------------
// 1. Hero and Search
// ---------------------------------------------------------------------------

test.describe('Dashboard -- hero and search', () => {
  test('dashboard loads with Canonical heading and hero search', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    // h1 heading
    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // Hero search input within the Search section
    const searchSection = page.locator('section[aria-label="Search"]');
    await expect(searchSection).toBeVisible();
    await expect(
      searchSection.getByRole('combobox', { name: /search/i }),
    ).toBeVisible();
  });

  test('hero search submits and navigates to search with query', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    if (isMobileViewport(page)) {
      // On mobile, the hero search bar is still visible on the dashboard.
      // Fill it directly rather than using the header search helper
      // (which tries to click a search icon button that navigates to /search).
      const heroSearch = page
        .locator('section[aria-label="Search"]')
        .getByRole('combobox', { name: /search/i });
      await heroSearch.fill('IT support');
      await heroSearch.press('Enter');
    } else {
      // Desktop: use the responsive helper
      await searchFromHeader(page, 'IT support');
    }

    // Should navigate to /search with query parameter. {135.32}: this
    // assertion was stale even before this sweep — {135.23} already
    // repointed the header search bar (components/browse/search-bar.tsx)
    // to /search; this test never followed.
    await expect(page).toHaveURL(/\/search\?q=/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Attention and Bids Sections
// ---------------------------------------------------------------------------

test.describe('Dashboard -- attention and bids sections', () => {
  test('unified attention section renders with heading', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // UnifiedAttentionSection has aria-label="Items needing attention"
    const attentionSection = page
      .locator('section[aria-label="Items needing attention"]')
      .first();
    await expect(attentionSection).toBeVisible({ timeout: 15000 });
  });

  test('active bids section shows seeded bid card', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // ID-128.14: `ActiveProcurementsSection` (renamed from ActiveBidsSection
    // at id-61 {61.3} / S248 WP2 T4) carries aria-label="Active procurements".
    //
    // Locate the ACCESSIBLE LANDMARK, not a raw `section[aria-label=...]` CSS
    // node. React's streaming SSR parks a resolved Suspense boundary's markup
    // in a `<div hidden id="S:n">` staging container and relocates it into the
    // boundary position via its `$RC` inline script; during that window a CSS
    // locator matches BOTH copies ("resolved to 2 elements"). The staged copy
    // is `hidden`, so it is absent from the accessibility tree — `getByRole`
    // matches exactly the one real landmark. This is STRICTER than the old
    // `.first()`: a genuinely duplicated landmark still fails here, whereas
    // `.first()` silently swallowed it.
    const bidsSection = page.getByRole('region', {
      name: 'Active procurements',
    });
    await expect(bidsSection).toBeVisible({ timeout: 15000 });

    // Heading within the section. ID-145 {145.20} BI-33: the heading was
    // renamed "Active Bids" -> "Active Procurements" so it agrees with the
    // aria-label above and the QuickStatsStrip tile below. Match it by ROLE:
    // `getByText` does case-insensitive SUBSTRING matching, so the old
    // `getByText('Active Procurements')` also matched the empty state's
    // "No active procurements" paragraph.
    await expect(
      bidsSection.getByRole('heading', { name: 'Active Procurements' }),
    ).toBeVisible();

    // THIS worker's seeded procurement, matched on its own prefix. Requesting
    // `workerData` above is what makes the seed run at all — Playwright only
    // instantiates a fixture a test actually destructures, and this test used
    // to assert on seeded rows without asking for the seed (same omission
    // {128.23} fixed in the compliance test below). Run in isolation it hit
    // the "No active procurements" empty state 100% of the time.
    await expect(
      bidsSection.getByText(`${workerData.prefix} IT Support Services`),
    ).toBeVisible();

    // Buyer text (this worker seeds two procurements sharing the buyer)
    await expect(bidsSection.getByText('E2E Test Corp').first()).toBeVisible();
  });

  test('active bids card links to bid detail page', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/');

    // Wait for Active Bids section (accessible landmark — see the streaming
    // staging-copy note on the previous test).
    const bidsSection = page.getByRole('region', {
      name: 'Active procurements',
    });
    await expect(bidsSection).toBeVisible({ timeout: 15000 });

    // Click the bid card link
    const bidLink = bidsSection.locator(
      `a[href="/procurement/${workerData.procurementId}"]`,
    );
    await expect(bidLink).toBeVisible();
    await bidLink.click();

    await expect(page).toHaveURL(`/procurement/${workerData.procurementId}`);
  });
});

// ---------------------------------------------------------------------------
// 3. Content Health Stats
// ---------------------------------------------------------------------------

test.describe('Dashboard -- content health stats', () => {
  test('quick stats strip shows content health section', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    // The active-procurement tile asserted below requires a non-zero count, so
    // this test depends on the worker-scoped seed — and Playwright only
    // instantiates a fixture that is actually destructured ({128.23}).
    void _workerData;
    await page.goto('/');

    // Wait for dashboard to load (Active Bids as proxy for Suspense resolution)
    const bidsSection = page.getByRole('region', {
      name: 'Active procurements',
    });
    await expect(bidsSection).toBeVisible({ timeout: 15000 });

    // Content health section — exactly one QuickStatsStrip is rendered on the
    // dashboard (app/page.tsx), and `getByRole` asserts exactly one such
    // LANDMARK: a second accessible region with this name still fails strict
    // mode here (the a11y contract we care about). What it deliberately does
    // NOT match is React's transient `<div hidden id="S:n">` streaming staging
    // copy, which a `section[aria-label=...]` CSS locator did match — that was
    // the "resolved to 2 elements" flake, not a duplicate landmark.
    const healthSection = page.getByRole('region', { name: 'Content health' });
    await expect(healthSection).toBeVisible({ timeout: 10000 });

    // Heading
    await expect(healthSection.getByText('Content Health')).toBeVisible();

    // At least one "Fresh" stat label (worker seeds fresh items). Exact
    // match — components/dashboard/quick-stats-strip.tsx also renders an
    // "All content is fresh" empty-state span (when there is no aging/
    // stale/expired content), and getByText's default case-insensitive
    // substring match makes that string collide with "Fresh" too (strict-
    // mode violation whenever the corpus happens to carry zero unhealthy
    // items at read time — S457 finding).
    await expect(
      healthSection.getByText('Fresh', { exact: true }),
    ).toBeVisible();

    // Active procurement label with a non-zero numeric value (worker data
    // seeds at least 1 active procurement). The StatItem component renders:
    //   <span>{value}</span> <span>{label}</span>
    // We locate the label, then check the sibling value span is not "0".
    // ID-145 {145.20} BI-33: components/dashboard/quick-stats-strip.tsx
    // renders this label as "Active procurement" (count === 1) or "Active
    // procurements" (otherwise) — "bid" vocabulary retired entirely so it
    // agrees with the ActiveProcurementsSection heading/aria-label.
    const activeProcurementLabel =
      healthSection.getByText(/Active procurements?/);
    await expect(activeProcurementLabel).toBeVisible();

    // The value <span> is the immediately preceding sibling of the label <span>
    const activeProcurementValue = activeProcurementLabel.locator(
      'xpath=preceding-sibling::span',
    );
    await expect(activeProcurementValue).toBeVisible();
    const valueText = await activeProcurementValue.textContent();
    expect(Number(valueText)).toBeGreaterThan(0);
  });

  test('quick stats strip shows unhealthy content indicators', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/');

    // Wait for content health section — accessible landmark, exactly one
    // (see the streaming staging-copy note on the previous test).
    const healthSection = page.getByRole('region', { name: 'Content health' });
    await expect(healthSection).toBeVisible({ timeout: 15000 });

    // {128.23}: the worker fixture applies the seeded documents' freshness to
    // `record_lifecycle` (post-M6 `source_documents` has no freshness columns
    // at all), which is exactly what `get_dashboard_attention_counts` reads.
    // It guarantees aging/stale/expired documents, so all three tiles must
    // render — QuickStatsStrip conditionally renders each Aging/Stale/Expired
    // label ONLY when its count is > 0 (quick-stats-strip.tsx), so visibility
    // alone already proves the count is non-zero. The numeric lower bound on
    // top of that proves the dashboard aggregates THIS worker's rows: counts
    // are corpus-wide, so other data can only push them higher.
    for (const [label, seeded] of [
      ['Aging', workerData.seededFreshnessCounts.aging],
      ['Stale', workerData.seededFreshnessCounts.stale],
      ['Expired', workerData.seededFreshnessCounts.expired],
    ] as const) {
      const statLabel = healthSection.getByText(label, { exact: true });
      await expect(statLabel).toBeVisible({ timeout: 10000 });

      // StatItem renders <span dot/><span value/><span label/> for freshness
      // labels, so index the reverse `preceding-sibling` axis to pick the
      // value span rather than unioning it with the decorative dot.
      const statValue = statLabel.locator('xpath=preceding-sibling::span[1]');
      const valueText = await statValue.textContent();
      expect(Number(valueText)).toBeGreaterThanOrEqual(seeded);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Compliance Status
// ---------------------------------------------------------------------------

test.describe('Dashboard -- compliance status', () => {
  test('compliance status section renders', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    // ComplianceStatusSection returns null when /api/certifications reports no
    // certifications, frameworks or registrations, so this test depends on the
    // worker-scoped compliance seed — and Playwright only instantiates a
    // fixture that is actually destructured. Without this pair the seed never
    // ran and the section was legitimately absent ({128.23}; same omission the
    // two wave1 specs carried).
    void _workerData;
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // ComplianceStatusSection has aria-label="Compliance status"
    const complianceSection = page
      .locator('section[aria-label="Compliance status"]')
      .first();
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // When visible, should contain at least one sub-section
    // Both may exist, so use .first() to avoid strict mode violation
    const certSection = page.locator(
      'section[aria-label="Certifications we hold"]',
    );
    const frameworkSection = page.locator(
      'section[aria-label="Framework memberships"]',
    );
    await expect(certSection.or(frameworkSection).first()).toBeVisible({
      timeout: 10000,
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Reorientation
// ---------------------------------------------------------------------------

test.describe('Dashboard -- reorientation', () => {
  test('reorient section shows greeting', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // The WelcomeBack component renders a <p role="status"> with a greeting
    // that depends on time of day: "Good morning", "Good afternoon", or "Good evening"
    const greeting = page.locator('[role="status"]').filter({
      hasText: /Good (morning|afternoon|evening)/,
    });
    await expect(greeting).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 6. Recent Activity
// ---------------------------------------------------------------------------

test.describe('Dashboard -- recent activity', () => {
  test('recent activity section renders', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // Recent activity section (defined in app/page.tsx with aria-label)
    const activitySection = page
      .locator('section[aria-label="Recent activity"]')
      .first();
    await expect(activitySection).toBeVisible({ timeout: 15000 });

    // Heading text. Exact match — components/dashboard/dashboard-activity-
    // feed.tsx renders a "No recent activity" empty-state string when there
    // are zero activity items, which case-insensitive-substring-collides
    // with the "Recent Activity" heading (strict-mode violation whenever
    // this worker's view happens to have no recent activity — S457 finding,
    // same pattern as the Content-health "Fresh" collision above).
    await expect(
      activitySection.getByText('Recent Activity', { exact: true }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. Viewer Role
// ---------------------------------------------------------------------------

test.describe('Dashboard -- viewer role', () => {
  test('dashboard loads for viewer role without admin-only features', async ({
    viewerPage: page,
  }) => {
    await page.goto('/');

    // Canonical heading is visible — viewer can access the dashboard
    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // Hero search is available for viewer
    const searchSection = page.locator('section[aria-label="Search"]');
    await expect(searchSection).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8. Mobile Layout
// ---------------------------------------------------------------------------

test.describe('Dashboard -- mobile layout', () => {
  test('dashboard sections stack vertically on mobile', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!isMobileViewport(page), 'Mobile-only test');

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // Hero search should still be visible on mobile
    const searchSection = page.locator('section[aria-label="Search"]');
    await expect(searchSection).toBeVisible();
    await expect(
      searchSection.getByRole('combobox', { name: /search/i }),
    ).toBeVisible();

    // Active Bids section should be visible (stacked, not side-by-side)
    const bidsSection = page.getByRole('region', {
      name: 'Active procurements',
    });
    await expect(bidsSection).toBeVisible({ timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// 9. Partial-failure WarningsBanner (WP1)
// ---------------------------------------------------------------------------

/**
 * The dashboard `<WarningsBanner />` consumes the canonical
 * `T & { warnings: readonly string[] }` sibling envelope produced by
 * `app/api/dashboard/route.ts:71-84`. The home page (`/`) is server-rendered:
 * it calls `fetchUnifiedDashboardData()` directly inside `getDashboardData()`
 * (`app/page.tsx`), not via the `/api/dashboard` route. This means a
 * Playwright `page.route('/api/dashboard', ...)` interception cannot inject
 * a synthetic warnings array into the SSR render path.
 *
 * Coverage split:
 *   - Unit test (`__tests__/components/dashboard/warnings-banner.test.tsx`)
 *     covers render-when-non-empty, hide-when-empty, dismiss behaviour, and
 *     a11y attribute correctness — the positive path.
 *   - This E2E covers the negative path: under healthy worker-scoped fixture
 *     data, the banner must NOT appear. This proves the banner is wired
 *     conditionally (not always-on) and that the page does not regress to
 *     rendering it on every load.
 */
test.describe('Dashboard -- partial-failure warnings banner', () => {
  test('warnings banner is hidden under healthy fixture data', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Canonical' })).toBeVisible({
      timeout: 10000,
    });

    // Wait for at least one downstream Suspense boundary to resolve so the
    // assertion runs against the fully-hydrated dashboard, not the skeleton
    // tree (where the banner would also legitimately be absent).
    await expect(
      page.getByRole('region', { name: 'Active procurements' }),
    ).toBeVisible({ timeout: 15000 });

    // The banner uses role="status" + the aria-labelledby heading defined
    // in `components/dashboard/warnings-banner.tsx`. Asserting on the
    // accessible name is more resilient than a class selector.
    await expect(
      page.getByRole('status', {
        name: /dashboard (data|sections) could not be loaded/i,
      }),
    ).toHaveCount(0);
  });
});
