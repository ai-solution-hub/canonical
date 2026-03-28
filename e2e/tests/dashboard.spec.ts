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
 * Worker-scoped data provides 12 content items (including stale/expired),
 * 3 workspaces (1 bid in drafting state), notifications, and read marks.
 */

// ---------------------------------------------------------------------------
// 1. Hero and Search
// ---------------------------------------------------------------------------

test.describe('Dashboard -- hero and search', () => {
  test('dashboard loads with Knowledge Hub heading and hero search', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    // h1 heading
    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

    // Hero search input within the Search section
    const searchSection = page.locator('section[aria-label="Search"]');
    await expect(searchSection).toBeVisible();
    await expect(
      searchSection.getByRole('combobox', { name: /search/i }),
    ).toBeVisible();
  });

  test('hero search submits and navigates to browse with query', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

    if (isMobileViewport(page)) {
      // On mobile, the hero search bar is still visible on the dashboard.
      // Fill it directly rather than using the header search helper
      // (which tries to click a search icon button that navigates to /search).
      const heroSearch = page.locator('section[aria-label="Search"]').getByRole('combobox', { name: /search/i });
      await heroSearch.fill('IT support');
      await heroSearch.press('Enter');
    } else {
      // Desktop: use the responsive helper
      await searchFromHeader(page, 'IT support');
    }

    // Should navigate to /browse with query parameter
    await expect(page).toHaveURL(/\/browse\?q=/, { timeout: 10000 });
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

    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

    // UnifiedAttentionSection has aria-label="Items needing attention"
    const attentionSection = page.locator(
      'section[aria-label="Items needing attention"]',
    ).first();
    await expect(attentionSection).toBeVisible({ timeout: 15000 });
  });

  test('active bids section shows seeded bid card', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

    // ActiveBidsSection has aria-label="Active bids"
    // Use .first() in case Suspense re-render creates a transient duplicate
    const bidsSection = page.locator('section[aria-label="Active bids"]').first();
    await expect(bidsSection).toBeVisible({ timeout: 15000 });

    // Heading within the section
    await expect(bidsSection.getByText('Active Bids')).toBeVisible();

    // The seeded bid card should show "IT Support Services" (with worker prefix)
    // Multiple workers may seed bids, so use .first()
    await expect(
      bidsSection.getByText(/IT Support Services/).first(),
    ).toBeVisible();

    // Buyer text (multiple bid cards may exist from parallel workers)
    await expect(bidsSection.getByText('E2E Test Corp').first()).toBeVisible();
  });

  test('active bids card links to bid detail page', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    await page.goto('/');

    // Wait for Active Bids section
    const bidsSection = page.locator('section[aria-label="Active bids"]').first();
    await expect(bidsSection).toBeVisible({ timeout: 15000 });

    // Click the bid card link
    const bidLink = bidsSection.locator(`a[href="/bid/${workerData.bidId}"]`);
    await expect(bidLink).toBeVisible();
    await bidLink.click();

    await expect(page).toHaveURL(`/bid/${workerData.bidId}`);
  });
});

// ---------------------------------------------------------------------------
// 3. Content Health Stats
// ---------------------------------------------------------------------------

test.describe('Dashboard -- content health stats', () => {
  test('quick stats strip shows content health section', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    // Wait for dashboard to load (Active Bids as proxy for Suspense resolution)
    const bidsSection = page.locator('section[aria-label="Active bids"]').first();
    await expect(bidsSection).toBeVisible({ timeout: 15000 });

    // Content health section
    const healthSection = page.locator('section[aria-label="Content health"]').first();
    await expect(healthSection).toBeVisible({ timeout: 10000 });

    // Heading
    await expect(healthSection.getByText('Content Health')).toBeVisible();

    // At least one "Fresh" stat label (worker seeds fresh items)
    await expect(healthSection.getByText('Fresh')).toBeVisible();

    // Active bids label with a value (worker data seeds at least 1 active bid)
    await expect(
      healthSection.getByText(/Active bids?/),
    ).toBeVisible();
  });

  test('quick stats strip shows unhealthy content indicators', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    // Wait for content health section
    const healthSection = page.locator('section[aria-label="Content health"]').first();
    await expect(healthSection).toBeVisible({ timeout: 15000 });

    // Worker data seeds stale (items[3]), expired (items[4]), and aging
    // (items[8], items[11]) items. At least one unhealthy label should appear.
    // Dashboard aggregates ALL data, so there could be more from other sources.
    const agingLabel = healthSection.getByText('Aging');
    const staleLabel = healthSection.getByText('Stale');
    const expiredLabel = healthSection.getByText('Expired');

    // At least one of the unhealthy indicators should be present
    // Multiple may exist, so use .first() to avoid strict mode violation
    await expect(
      agingLabel.or(staleLabel).or(expiredLabel).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Compliance Status
// ---------------------------------------------------------------------------

test.describe('Dashboard -- compliance status', () => {
  test('compliance status section renders', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

    // ComplianceStatusSection has aria-label="Compliance status"
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    ).first();
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // When visible, should contain at least one sub-section
    // Both may exist, so use .first() to avoid strict mode violation
    const certSection = page.locator(
      'section[aria-label="Certifications we hold"]',
    );
    const frameworkSection = page.locator(
      'section[aria-label="Framework memberships"]',
    );
    await expect(
      certSection.or(frameworkSection).first(),
    ).toBeVisible({ timeout: 10000 });
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

    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

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

    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

    // Recent activity section (defined in app/page.tsx with aria-label)
    const activitySection = page.locator(
      'section[aria-label="Recent activity"]',
    ).first();
    await expect(activitySection).toBeVisible({ timeout: 15000 });

    // Heading text
    await expect(
      activitySection.getByText('Recent Activity'),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. Mobile Layout
// ---------------------------------------------------------------------------

test.describe('Dashboard -- mobile layout', () => {
  test('dashboard sections stack vertically on mobile', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!isMobileViewport(page), 'Mobile-only test');

    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible({ timeout: 10000 });

    // Hero search should still be visible on mobile
    const searchSection = page.locator('section[aria-label="Search"]');
    await expect(searchSection).toBeVisible();
    await expect(
      searchSection.getByRole('combobox', { name: /search/i }),
    ).toBeVisible();

    // Active Bids section should be visible (stacked, not side-by-side)
    const bidsSection = page.locator('section[aria-label="Active bids"]').first();
    await expect(bidsSection).toBeVisible({ timeout: 15000 });
  });
});
