import { test, expect } from '../fixtures';

/**
 * Wave 1: Dashboard Compliance Status Section
 *
 * Tests the ComplianceStatusSection on the dashboard (/). The compliance
 * section shows certification and framework cards with expiry status badges.
 *
 * The section renders as a <section> element with aria-label="Compliance
 * status" (components/dashboard/compliance-status-section.tsx) and returns
 * `null` once loading finishes if /api/certifications reports no
 * certifications, frameworks or registrations. Every test here therefore
 * depends on the worker-scoped `workerData` fixture having seeded the
 * compliance rows — and Playwright only instantiates a fixture that is
 * actually destructured, hence the `workerData: _workerData` /
 * `void _workerData;` pairs below (same precedent as
 * e2e/tests/bid-pipeline.spec.ts).
 *
 * @tag @wave1
 */

test.describe('Dashboard compliance status section', { tag: '@wave1' }, () => {
  test.beforeEach(
    async ({ authenticatedPage: page, workerData: _workerData }) => {
      // Referencing the worker fixture is what forces the compliance seed to
      // exist before the dashboard is loaded.
      void _workerData;
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Canonical' }),
      ).toBeVisible({
        timeout: 10000,
      });
    },
  );

  test('compliance status section renders with the seeded data', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    // ComplianceStatusSection renders when certification data exists (it
    // returns null otherwise). The worker fixture seeds 4 entity_relationships
    // ('holds'), 3 of them sourced from the client organisation — ISO 27001 /
    // Cyber Essentials Plus / G-Cloud 14 — plus matching entity_mentions, so
    // the populated branch must render. (The 4th 'holds' row is sourced from
    // 'Acme Ltd' and is filtered out by /api/certifications, which only keeps
    // relationships whose source_entity is the client org.) The previous
    // conditional `if (await section.isVisible())` masked missing-fixture
    // regressions per `feedback_e2e_conditional_false_pass`.
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });
    await expect(
      section.getByRole('heading', { name: /Compliance Status/ }),
    ).toBeVisible();
  });

  test('compliance section shows certification cards when data exists', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // The section contains CertificationSummaryCard and/or FrameworkSummaryCard
    // CertificationSummaryCard has aria-label="Certifications we hold"
    const certSection = section.locator(
      'section[aria-label="Certifications we hold"]',
    );
    const frameworkSection = section.locator(
      'section[aria-label="Framework memberships"]',
    );

    // At least one of these should be present. `.first()` is required, not a
    // weakening: now that the worker fixture actually seeds (it never did
    // before — the specs omitted `workerData`), BOTH sections render, and a
    // bare `.or()` resolving to two elements is a strict-mode violation. The
    // assertion is still "the compliance section rendered a real sub-section".
    await expect(certSection.or(frameworkSection).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('certification cards show expiry status badges', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // Expiry badges have aria-label="Expiry status: {label}". Worker fixture
    // seeds at least one self-held certification (ISO 27001 → Valid) plus one
    // expiring (Cyber Essentials Plus → Expiring Soon), so at least one badge
    // must render. Previous `if (badgeCount > 0)` conditional silently passed
    // on empty DBs per `feedback_e2e_conditional_false_pass`.
    const expiryBadges = section.locator('span[aria-label^="Expiry status:"]');
    await expect(expiryBadges.first()).toBeVisible({ timeout: 10000 });

    // Verify the badge label is one of the four statuses ExpiryBadge renders
    // (components/dashboard/expiry-badge.tsx — note the `unknown` status reads
    // "No expiry date", not "Unknown").
    const ariaLabel = await expiryBadges.first().getAttribute('aria-label');
    expect(ariaLabel).toMatch(
      /^Expiry status: (Valid|Expiring Soon|Expired|No expiry date)$/,
    );
  });

  test('expiring certifications link to their renewal evidence document', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // The renewal affordance appears for rows with expiring_soon or expired
    // status. On certification/registration rows it now reads "Review" with
    // aria-label "Review {name}" and links to the evidence document
    // (components/dashboard/certification-summary-card.tsx). The framework
    // card keeps the "Renew" wording — covered by wave1-cert-renew.spec.ts.
    // Worker fixture seeds Cyber Essentials Plus (expiring_soon), so at least
    // one renewal link must render. Previous `if (renewCount > 0)` conditional
    // silently passed on empty DBs per `feedback_e2e_conditional_false_pass`.
    const renewalLinks = section.locator('a[aria-label^="Review "]');
    await expect(renewalLinks.first()).toBeVisible({ timeout: 10000 });

    // The link must point at a real document detail route.
    const href = await renewalLinks.first().getAttribute('href');
    expect(href).toMatch(/^\/documents\/[0-9a-f-]{36}$/);

    // …and carry the visible affordance text the user clicks.
    await expect(renewalLinks.first()).toHaveText(/Review/);
  });

  test('compliance section shows expiring count badge in heading', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const section = page.locator('section[aria-label="Compliance status"]');

    await expect(section).toBeVisible({ timeout: 10000 });

    // When certifications are expiring, a count badge appears in the heading
    const expiringBadge = section.locator('span[aria-label*="expiring soon"]');

    await expect(expiringBadge).toBeVisible({ timeout: 3000 });
    const ariaLabel = await expiringBadge.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/^\d+ expiring soon$/);
  });
});
