import { test, expect } from '../fixtures';

/**
 * Wave 1: Certification/Framework Renewal Affordance
 *
 * Tests the renewal affordance on certification and framework cards on the
 * dashboard. It appears only for items with 'expiring_soon' or 'expired'
 * expiry status, and links to the evidence document for that entity
 * (`/documents/{sourceDocumentId}`).
 *
 * Copy differs per card (verified against the components):
 * - CertificationSummaryCard rows → visible text "Review",
 *   aria-label `Review {canonical_name}`.
 * - FrameworkSummaryCard rows → visible text "Renew",
 *   aria-label `View {canonical_name} for renewal`.
 *
 * The CertificationSummaryCard renders inside ComplianceStatusSection on the
 * dashboard (/). Each certification/framework/registration row shows an
 * ExpiryBadge and, conditionally, the renewal link. Rows render as
 * `<a role="listitem">` when the entity has an evidence document and
 * `<div role="listitem">` otherwise — ancestor lookups must therefore match on
 * role, never on tag name.
 *
 * ComplianceStatusSection does NOT pass `onEditEntity` to
 * CertificationSummaryCard, so certification rows render their name as static
 * text (the editable-name button only exists on surfaces that pass a handler).
 *
 * Every test depends on the worker-scoped `workerData` fixture seeding the
 * compliance rows; Playwright only instantiates a fixture that is actually
 * destructured, hence the `workerData: _workerData` / `void _workerData;`
 * pairs below (same precedent as e2e/tests/bid-pipeline.spec.ts).
 *
 * @tag @wave1
 */

test.describe('Certification renewal affordance', { tag: '@wave1' }, () => {
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

  test('certification cards render with entity names', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    // Worker fixture seeds 2 self-held certifications — ISO 27001 and Cyber
    // Essentials Plus — via entity_mentions + 'holds' entity_relationships, so
    // the compliance section and the CertificationSummaryCard must render a
    // named row for each.
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    const certRows = certCard.locator('[role="listitem"]');
    const rowCount = await certRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Each seeded certification is surfaced as exactly one named row (the API
    // aggregates mentions by canonical_name, so duplicates would be a bug).
    await expect(certRows.filter({ hasText: 'ISO 27001' })).toHaveCount(1);
    await expect(
      certRows.filter({ hasText: 'Cyber Essentials Plus' }),
    ).toHaveCount(1);
  });

  test('certification cards show expiry status badges', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // ExpiryBadge elements have aria-label="Expiry status: {label}"
    const expiryBadges = complianceSection.locator(
      'span[aria-label^="Expiry status:"]',
    );
    await expect(expiryBadges.first()).toBeVisible({ timeout: 10000 });
    const badgeCount = await expiryBadges.count();
    expect(badgeCount).toBeGreaterThan(0);

    // Verify badge labels are one of the four statuses ExpiryBadge renders
    // (components/dashboard/expiry-badge.tsx — the `unknown` status reads
    // "No expiry date", not "Unknown").
    for (let i = 0; i < Math.min(badgeCount, 5); i++) {
      const ariaLabel = await expiryBadges.nth(i).getAttribute('aria-label');
      expect(ariaLabel).toMatch(
        /^Expiry status: (Valid|Expiring Soon|Expired|No expiry date)$/,
      );
    }

    // The badge's visible text must match its accessible label — a sighted
    // user and a screen-reader user see the same status. (Asserting the
    // freshness token class instead would couple the test to the styling
    // implementation; see docs/reference/testing/test-philosophy.md §2.1.)
    const firstLabel = await expiryBadges.first().getAttribute('aria-label');
    expect(firstLabel).toBeTruthy();
    await expect(expiryBadges.first()).toHaveText(
      firstLabel!.replace('Expiry status: ', ''),
    );
  });

  test('renewal link appears for expiring or expired certifications', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // The seeded fixture includes "Cyber Essentials Plus" with an expiring
    // soon date, so at least one renewal link must be present.
    const renewalLinks = complianceSection.locator('a[aria-label^="Review "]');
    await expect(renewalLinks.first()).toBeVisible({ timeout: 10000 });
    const renewalCount = await renewalLinks.count();
    expect(renewalCount).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(renewalCount, 3); i++) {
      const renewalLink = renewalLinks.nth(i);

      // Verify the visible affordance text
      await expect(renewalLink).toHaveText(/Review/);

      // Verify the href format: /documents/{sourceDocumentId}
      const href = await renewalLink.getAttribute('href');
      expect(href).toMatch(/^\/documents\/[0-9a-f-]{36}$/);

      // The parent listitem should also have an expiry badge showing Expiring
      // Soon or Expired. Match the ancestor on role, not tag: a row with an
      // evidence document renders as <a role="listitem">, so an
      // `ancestor::div[...]` lookup would resolve to zero elements and make
      // the badge assertions below vacuous.
      const parentRow = renewalLink.locator(
        'xpath=ancestor::*[@role="listitem"]',
      );
      await expect(parentRow).toBeVisible({ timeout: 5000 });
      const expiryBadge = parentRow.locator(
        'span[aria-label^="Expiry status:"]',
      );
      await expect(expiryBadge).toBeVisible({ timeout: 5000 });
      const status = await expiryBadge.getAttribute('aria-label');
      expect(status).toMatch(/^Expiry status: (Expiring Soon|Expired)$/);
    }
  });

  test('renewal link does not appear for valid certifications', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    // Seed includes ISO 27001 with a 1-year-out expiry => Valid badge.
    const validBadges = certCard.locator(
      'span[aria-label="Expiry status: Valid"]',
    );
    await expect(validBadges.first()).toBeVisible({ timeout: 10000 });
    const validCount = await validBadges.count();
    expect(validCount).toBeGreaterThan(0);

    // For each valid certification, verify no renewal link exists in that row
    for (let i = 0; i < Math.min(validCount, 3); i++) {
      const parentRow = validBadges
        .nth(i)
        .locator('xpath=ancestor::*[@role="listitem"]');
      // Assert the row resolves first — otherwise a mis-targeted ancestor
      // lookup would make the absence assertion pass vacuously.
      await expect(parentRow).toBeVisible();
      const renewalLink = parentRow.locator('a[aria-label^="Review "]');
      await expect(renewalLink).toHaveCount(0);
    }
  });

  test('framework cards show Renew button for expiring frameworks', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // The seeded fixture includes G-Cloud 14 with expiring_soon, so the
    // framework card and a Renew button must be present.
    const frameworkCard = complianceSection.locator(
      'section[aria-label="Framework memberships"]',
    );
    await expect(frameworkCard).toBeVisible({ timeout: 10000 });

    // FrameworkSummaryCard labels its renewal link
    // `View {canonical_name} for renewal` and keeps the visible "Renew" text.
    const anyRenewLink = frameworkCard.locator('a[aria-label*="for renewal"]');
    await expect(anyRenewLink.first()).toBeVisible({ timeout: 10000 });

    const frameworkRows = frameworkCard.locator('[role="listitem"]');
    const rowCount = await frameworkRows.count();
    expect(rowCount).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(rowCount, 3); i++) {
      const row = frameworkRows.nth(i);
      const expiryBadge = row.locator('span[aria-label^="Expiry status:"]');
      const renewLink = row.locator('a[aria-label*="for renewal"]');
      await expect(expiryBadge).toBeVisible({ timeout: 5000 });

      const status = await expiryBadge.getAttribute('aria-label');
      const isExpiring =
        status?.includes('Expiring Soon') || status?.includes('Expired');

      if (isExpiring) {
        // Renew button should be present, labelled, and link to the evidence
        // document for that framework.
        await expect(renewLink).toBeVisible();
        await expect(renewLink).toHaveText(/Renew/);
        const href = await renewLink.getAttribute('href');
        expect(href).toMatch(/^\/documents\/[0-9a-f-]{36}$/);
      } else {
        // Renew button should NOT be present
        await expect(renewLink).toHaveCount(0);
      }
    }
  });

  test('certification card shows linked-item count per entity', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    // Each row shows an "N linked item(s)" evidence count with a matching
    // aria-label (certification-summary-card.tsx).
    const linkedCounts = certCard.locator('span[aria-label*="linked item"]');
    await expect(linkedCounts.first()).toBeVisible({ timeout: 10000 });

    const ariaLabel = await linkedCounts.first().getAttribute('aria-label');
    // Format: "N linked item" or "N linked items"
    expect(ariaLabel).toMatch(/^\d+ linked items?$/);

    // The visible text mirrors the accessible label.
    await expect(linkedCounts.first()).toHaveText(/^\d+ linked items?$/);
  });

  test('certification card shows copy and review buttons in header', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    const certCard = complianceSection.locator(
      'section[aria-label="Certifications we hold"]',
    );
    await expect(certCard).toBeVisible({ timeout: 10000 });

    // Copy button with aria-label
    const copyButton = certCard.getByRole('button', {
      name: /Copy certification summary/,
    });
    await expect(copyButton).toBeVisible();

    // Review with Claude button
    const reviewButton = certCard.getByText('Review with Claude');
    await expect(reviewButton).toBeVisible();
  });

  test('supplier certifications section is collapsible', async ({
    authenticatedPage: page,
    workerData: _workerData,
  }) => {
    void _workerData;
    const complianceSection = page.locator(
      'section[aria-label="Compliance status"]',
    );
    await expect(complianceSection).toBeVisible({ timeout: 15000 });

    // Worker fixture seeds an Acme Ltd supplier certification
    // ("ISO 9001 (Acme Supplier)", metadata.holder = 'supplier'), so the
    // supplier toggle must be present.
    //
    // KNOWN FIXTURE GAP ({128.23}): the seeded 'holds' relationship for that
    // certification has source_entity = 'Acme Ltd', but
    // app/api/certifications/route.ts only keeps relationships whose
    // source_entity matches BRANDING.organisationName, so the entity never
    // reaches the response and SupplierSection renders null. The UI behaviour
    // asserted here is intact — the seed is what cannot express it. Fix
    // belongs in e2e/fixtures/test-data.ts `buildEntityRelationships()`
    // (source_entity → BRANDING.organisationName; metadata.holder /
    // supplier_name already carry the supplier semantics). Deliberately NOT
    // weakened or skipped here.
    const supplierToggle = complianceSection
      .locator('button[aria-expanded]')
      .filter({
        hasText: /Supplier Certifications/,
      });
    await expect(supplierToggle).toBeVisible({ timeout: 10000 });

    // Initially collapsed
    await expect(supplierToggle).toHaveAttribute('aria-expanded', 'false');

    // Click to expand
    await supplierToggle.click();
    await expect(supplierToggle).toHaveAttribute('aria-expanded', 'true');

    // The expanded content should be visible
    const supplierContent = page.locator('#supplier-certifications');
    await expect(supplierContent).toBeVisible();

    // Click again to collapse
    await supplierToggle.click();
    await expect(supplierToggle).toHaveAttribute('aria-expanded', 'false');
  });
});
