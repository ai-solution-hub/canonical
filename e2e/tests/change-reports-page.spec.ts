import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import {
  type ChangeReportFixtureData,
  STUB_TAXONOMY_DOMAIN_NAME,
  cleanupChangeReports,
  countChangeReportFixtureRows,
  generateChangeReportRunId,
  seedChangeReports,
  stubTaxonomyDomains,
} from '../fixtures/change-reports-fixture';

/**
 * Flow: Change Reports (Digest)
 *
 * Tests the Change Reports page at /digest. Covers the heading,
 * mode selector (Period/Daily/Custom), generate button, past reports
 * list, and empty state handling.
 *
 * The /digest route stays as-is (URL stability), but the page heading
 * says "Change Reports" (not "Digest").
 *
 * WS3 (bl-115): the "page loads with correct heading" and "past reports
 * section" tests previously `if`-guarded their assertions because the test DB
 * has no change-report data, so the asserted branch never executed (a vacuous
 * false-pass). Those two tests now live in the serial `populated` describe
 * below, which seeds deterministic `change_reports` rows and asserts the
 * loaded/populated-state contract UNCONDITIONALLY. Because `change_reports` is
 * a GLOBAL table (see change-reports-fixture.ts), the empty-state test
 * route-mocks the latest/list endpoints so it remains correct regardless of
 * concurrent seeded rows.
 */

/**
 * Stub the change-reports read + generate endpoints so a test deterministically
 * observes the EMPTY state and never mutates the GLOBAL change_reports table.
 *
 * - `/latest` -> { digest: null } and `/list` -> [] force the empty hero
 *   regardless of any rows the serial populated describe seeds concurrently.
 * - notification preferences -> auto_generate_change_reports: false disables
 *   the page's auto-generate-on-first-visit effect, so the empty hero stays
 *   put (the manual Generate button is present, not pre-flipped to
 *   "Generating...").
 * - `/generate` is held open (never fulfilled) so an explicit Generate click
 *   cannot reach the real AI route or write an (untagged, un-torn-down) orphan
 *   row to the prod-acting DB; the page surfaces the "Generating..." pending
 *   state in the meantime.
 *
 * Must be called BEFORE `page.goto`.
 */
async function stubEmptyChangeReports(page: Page): Promise<void> {
  await page.route('**/api/change-reports/latest', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ digest: null }),
    }),
  );
  await page.route('**/api/change-reports/list**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ digests: [], total: 0 }),
    }),
  );
  // Disable auto-generate so the empty hero does not immediately self-trigger
  // a generation (which would hide the manual Generate button and hang on the
  // held-open generate route below).
  await page.route('**/api/notifications/preferences', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preferences: {
          email_weekly_change_report: false,
          email_review_assigned: false,
          email_owned_content_flagged: false,
          auto_generate_change_reports: false,
          updated_at: null,
        },
      }),
    }),
  );
  await page.route('**/api/change-reports/generate', async () => {
    // Hold pending for the test window — no AI call, no DB write. The route is
    // abandoned when the page context closes at test end.
    await new Promise(() => {});
  });
}

/**
 * Reveal the inline custom filter panel by selecting "Custom…" in the period
 * <Select> (aria-label="Report period"). Replaces the former custom-tab click
 * (the Period/Daily/Custom tablist UI was removed). Asserts the panel rendered
 * by waiting on its heading.
 */
async function revealCustomFilterPanel(page: Page): Promise<void> {
  const selectTrigger = page.getByRole('combobox', { name: 'Report period' });
  await expect(selectTrigger).toBeVisible({ timeout: 10000 });
  await selectTrigger.click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: 'Custom…' })
    .click();
  await expect(page.getByText('Custom Report Filters')).toBeVisible({
    timeout: 5000,
  });
}

// ---------------------------------------------------------------------------
// 1. Change Reports Page
// ---------------------------------------------------------------------------

test.describe('Change Reports page', () => {
  // ID-126.5: the three former tablist tests ("mode selector tabs are present
  // and functional", "clicking Daily tab...", "clicking Custom tab...") were
  // DELETED — they asserted a removed Period/Daily/Custom tablist UI that no
  // longer exists in app/change-reports/page.tsx. The current page collapses
  // Daily/Custom into a single period <Select> (aria-label="Report period");
  // the "Custom…" option reveals the inline filter panel. Custom-panel +
  // period-Select behaviour is covered by the rewritten "period selector
  // dropdown" test below and the "Change Reports -- custom filter
  // interactions" describe.

  test('period selector dropdown shows period options', async ({
    authenticatedPage: page,
  }) => {
    // The period <Select> renders in both empty (hero) and loaded (bar)
    // states; stub the empty state so this test is deterministic and immune to
    // any rows seeded concurrently by the populated describe (the
    // change_reports table is global) and never triggers a real generation.
    await stubEmptyChangeReports(page);

    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // The period selector is a Radix <Select> labelled "Report period",
    // defaulting to "Last 7 days".
    const selectTrigger = page.getByRole('combobox', { name: 'Report period' });
    await expect(selectTrigger).toBeVisible({ timeout: 10000 });
    await expect(selectTrigger).toHaveText(/Last 7 days/);

    await selectTrigger.click();

    // The listbox shows the preset period options.
    const listbox = page.getByRole('listbox');
    await expect(
      listbox.getByRole('option', { name: 'Last 7 days' }),
    ).toBeVisible();
    await expect(
      listbox.getByRole('option', { name: 'Last 14 days' }),
    ).toBeVisible();
    await expect(
      listbox.getByRole('option', { name: 'Last 30 days' }),
    ).toBeVisible();
    // "Custom…" is a progressive-disclosure option that reveals the inline
    // filter panel (exercised by the custom-filter-interactions describe).
    await expect(
      listbox.getByRole('option', { name: 'Custom…' }),
    ).toBeVisible();

    // Close dropdown
    await page.keyboard.press('Escape');
  });

  test('generate button is present and clickable', async ({
    authenticatedPage: page,
  }) => {
    // Force the empty state and hold the generate endpoint pending so this
    // test never hits the real AI API or writes a row to the GLOBAL
    // change_reports table (a previously-untagged write here persisted as an
    // orphan row in the prod-acting DB and reordered the seeded
    // populated-state tests).
    await stubEmptyChangeReports(page);

    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Locate the generate button — text varies by state:
    // Empty state (hero): "Generate Report"
    // Loaded state (bar): "Generate New Report"
    const generateButton = page.getByRole('button', {
      name: /Generate.*Report/i,
    });
    await expect(generateButton).toBeVisible();
    await expect(generateButton).toBeEnabled();

    // Button is clickable (no error thrown on click).
    await generateButton.click();

    // Verify the click registered — while the generate mutation is pending
    // (held open by the mock), the page surfaces the "Generating your
    // report..." status and the action button flips to "Cancel report
    // generation". (The former /Generating/ button name no longer exists — the
    // current UI shows a Cancel button plus a status paragraph.)
    await expect(page.getByText('Generating your report...')).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByRole('button', { name: 'Cancel report generation' }),
    ).toBeVisible();
  });

  // WS3: this test moved into the serial `populated` describe at the end of
  // this file, where deterministic change_reports rows are seeded so the
  // "Previous Reports" section renders and the assertions run unconditionally.

  // Asserts the empty-state hero with generate controls. The change_reports
  // table is GLOBAL, so the populated `describe` at the end of this file may
  // have seeded rows present concurrently; stubEmptyChangeReports forces an
  // empty response (and holds generate pending) so this test deterministically
  // observes the empty state it is designed to assert (its premise has always
  // been "the DB is empty").
  test('empty state shows hero with generate controls', async ({
    authenticatedPage: page,
  }) => {
    await stubEmptyChangeReports(page);

    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // The route-mock above forces the empty state, so the hero heading
    // (level-1 "Change Reports") always renders once loading completes.
    const heroHeading = page.getByRole('heading', {
      name: 'Change Reports',
      level: 1,
    });
    await expect(heroHeading).toBeVisible({ timeout: 10000 });

    // Description text is visible
    await expect(
      page.getByText('See what changed in your knowledge base'),
    ).toBeVisible();

    // Generate button is present
    await expect(
      page.getByRole('button', { name: /Generate Report/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Custom Filter Interactions
// ---------------------------------------------------------------------------

test.describe('Change Reports -- custom filter interactions', () => {
  test('custom domain filter shows active filter badge', async ({
    authenticatedPage: page,
  }) => {
    await stubEmptyChangeReports(page);
    // Stub taxonomy_domains to a single deterministic domain so the domain
    // <Select> always offers exactly one selectable option beyond "All
    // domains". This replaces the former `if (optionCount > 1)` soft guard
    // (which false-passed whenever the ambient test DB had no domains) with an
    // UNCONDITIONAL hard assertion against worker-controlled data
    // (test-philosophy.md §2.1).
    await stubTaxonomyDomains(page);
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Reveal the custom filter panel by selecting "Custom…" in the period
    // Select (the former custom tab no longer exists).
    await revealCustomFilterPanel(page);

    // Open the domain filter select
    const domainSelect = page.locator('#custom-domain');
    await expect(domainSelect).toBeVisible();

    // Click to open the select
    await domainSelect.click();

    // The stubbed domain is the only non-"All domains" option — select it
    // directly (Playwright auto-waits for it to render, so no count guard is
    // needed; if the option never appears the test fails, which is the point).
    const listbox = page.getByRole('listbox');
    await listbox
      .getByRole('option', { name: STUB_TAXONOMY_DOMAIN_NAME, exact: true })
      .click();

    // An "Active filters:" label appears unconditionally.
    await expect(page.getByText('Active filters:')).toBeVisible({
      timeout: 5000,
    });

    // The active-filter badge for the stubbed domain renders with a remove
    // button whose aria-label echoes the selected domain name verbatim —
    // asserting the badge against the known stubbed domain, not ambient data.
    const removeDomainButton = page.locator(
      `[aria-label="Remove domain filter: ${STUB_TAXONOMY_DOMAIN_NAME}"]`,
    );
    await expect(removeDomainButton).toBeVisible();
  });

  test('custom keyword filter shows individual keyword badges', async ({
    authenticatedPage: page,
  }) => {
    await stubEmptyChangeReports(page);
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Reveal the custom filter panel by selecting "Custom…" in the period
    // Select (the former custom tab no longer exists).
    await revealCustomFilterPanel(page);

    // Fill the keywords input with "ai agents, cloud"
    const keywordsInput = page.locator('#keywords');
    await expect(keywordsInput).toBeVisible();
    await keywordsInput.fill('ai agents, cloud');

    // "Active filters:" label appears
    await expect(page.getByText('Active filters:')).toBeVisible({
      timeout: 5000,
    });

    // Two keyword badges are visible: "ai agents" and "cloud"
    const aiAgentsBadge = page.getByText('ai agents', { exact: true });
    const cloudBadge = page.getByText('cloud', { exact: true });

    await expect(aiAgentsBadge).toBeVisible();
    await expect(cloudBadge).toBeVisible();

    // Each badge has a remove button
    const removeCloudButton = page.locator(
      '[aria-label="Remove keyword filter: cloud"]',
    );
    await expect(removeCloudButton).toBeVisible();

    // Clicking the remove button on "cloud" leaves only "ai agents" badge
    await removeCloudButton.click();

    // "cloud" badge should disappear
    await expect(cloudBadge).not.toBeVisible({ timeout: 5000 });

    // "ai agents" badge should still be visible
    await expect(aiAgentsBadge).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Populated state (seeded change_reports) — WS3 / bl-115
// ---------------------------------------------------------------------------

/**
 * These tests previously `if`-guarded their assertions and false-passed
 * because the test DB has no change-report data. We seed deterministic
 * `change_reports` rows so the page renders its LOADED + "Previous Reports"
 * state, then assert that contract UNCONDITIONALLY (a real DB → API → render
 * proof, not a vacuous skip).
 *
 * `.serial` pins these tests to a single worker in declaration order so the
 * seed/teardown bracket fully owns the global table's state for their run.
 * Rows are tagged by run-id and torn down in `afterAll`; the teardown asserts
 * zero orphan rows remain in the prod-acting DB.
 */
test.describe.serial('Change Reports page — populated state', () => {
  const supabase = createServiceClient();
  const runId = generateChangeReportRunId('ws3-change-reports');
  let fixture: ChangeReportFixtureData;

  test.beforeAll(async () => {
    // Seed 3 rows: the newest is the "current"/latest report; the older two
    // render in the "Previous Reports" list. Frequencies rotate weekly/daily/
    // custom so the type-label assertion has deterministic coverage.
    fixture = await seedChangeReports(supabase, runId, 3);
    expect(fixture.all.length).toBe(3);
    expect(fixture.previous.length).toBe(2);
  });

  test.afterAll(async () => {
    const deleted = await cleanupChangeReports(supabase, runId);
    expect(deleted).toBe(3);
    // No orphan rows may persist in the prod-acting DB.
    const remaining = await countChangeReportFixtureRows(supabase, runId);
    expect(remaining).toBe(0);
  });

  test('page loads with correct heading (loaded state)', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // The page must never use "Digest" as a heading.
    await expect(
      page.getByRole('heading', { name: /^Digest$/i }),
    ).not.toBeVisible();

    // With seeded data the page is in the LOADED state: the empty-state hero
    // (level-1 heading "Change Reports") must NOT render — the ChangeReportView
    // is shown instead, whose header h1 is the frequency label of the latest
    // (weekly) seeded report.
    await expect(
      page.getByRole('heading', { name: 'Change Reports', level: 1 }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Weekly Change Report', level: 1 }),
    ).toBeVisible({ timeout: 10000 });

    // The loaded view's header badge shows the latest report's item count.
    // Scope to the <header> so we don't also match a per-domain "N items"
    // count elsewhere in the view.
    await expect(
      page
        .locator('header')
        .filter({ hasText: 'Weekly Change Report' })
        .getByText(`${fixture.latest.item_count} items`),
    ).toBeVisible();
  });

  test('past reports section shows previous entries', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // The "Previous Reports" section renders because >1 report exists (the
    // latest is shown as the current report; the rest are "previous").
    await expect(page.getByText('Previous Reports')).toBeVisible({
      timeout: 10000,
    });

    const reportList = page.locator('[aria-label="Previous reports"]');
    await expect(reportList).toBeVisible();

    // One <li> per previous (non-current) seeded report.
    const reportEntries = reportList.locator('li');
    await expect(reportEntries).toHaveCount(fixture.previous.length);

    // Each entry is a clickable button.
    const firstButton = reportEntries.first().locator('button');
    await expect(firstButton).toBeVisible();

    // Each entry shows a type label (Weekly/Daily/Custom).
    const typeLabel = firstButton
      .locator('span.text-xs.text-muted-foreground')
      .first();
    await expect(typeLabel).toHaveText(/Weekly|Daily|Custom/);

    // Each entry shows a date range with an en-dash separating two dates.
    const dateText = firstButton.locator('span.text-sm.font-medium');
    await expect(dateText).toBeVisible();
    await expect(dateText).toHaveText(/\w+.*–.*\w+/);

    // Each entry shows an item count.
    await expect(firstButton.getByText(/\d+ items/)).toBeVisible();
  });
});
