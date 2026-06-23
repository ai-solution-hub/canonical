import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import {
  type ChangeReportFixtureData,
  cleanupChangeReports,
  countChangeReportFixtureRows,
  generateChangeReportRunId,
  seedChangeReports,
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

// ---------------------------------------------------------------------------
// 1. Change Reports Page
// ---------------------------------------------------------------------------

test.describe('Change Reports page', () => {
  test('mode selector tabs are present and functional', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Locate the tablist
    const tablist = page.locator('[role="tablist"][aria-label="Report mode"]');
    await expect(tablist).toBeVisible();

    // All three tabs should be present (use id attributes for reliable matching)
    const presetTab = page.locator('#tab-preset');
    const dailyTab = page.locator('#tab-daily');
    const customTab = page.locator('#tab-custom');

    await expect(presetTab).toBeVisible();
    await expect(dailyTab).toBeVisible();
    await expect(customTab).toBeVisible();

    // "Period" tab (preset) is selected by default
    await expect(presetTab).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Daily tab switches mode and shows daily description', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Click the "Daily" tab
    const dailyTab = page.locator('#tab-daily');
    await dailyTab.click();

    // Daily tab becomes selected
    await expect(dailyTab).toHaveAttribute('aria-selected', 'true');

    // Period tab becomes unselected
    const presetTab = page.locator('#tab-preset');
    await expect(presetTab).toHaveAttribute('aria-selected', 'false');

    // Daily mode description text is visible
    await expect(
      page.getByText("Summarise today's new additions"),
    ).toBeVisible();

    // A generate button is visible
    await expect(page.getByRole('button', { name: /Generate/ })).toBeVisible();
  });

  test('clicking Custom tab shows custom filter panel', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Click the "Custom" tab
    const customTab = page.locator('#tab-custom');
    await customTab.click();

    // Custom tab becomes selected
    await expect(customTab).toHaveAttribute('aria-selected', 'true');

    // Custom filter panel is visible with heading
    await expect(page.getByText('Custom Report Filters')).toBeVisible();

    // "From" date input is visible
    await expect(page.locator('#date-from')).toBeVisible();

    // "To" date input is visible
    await expect(page.locator('#date-to')).toBeVisible();

    // Domain filter dropdown is visible
    await expect(page.locator('#custom-domain')).toBeVisible();

    // Keywords input is visible
    await expect(page.locator('#keywords')).toBeVisible();

    // "Generate Custom Report" button is visible
    await expect(
      page.getByRole('button', { name: 'Generate Custom Report' }),
    ).toBeVisible();
  });

  test('period selector dropdown shows period options', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Ensure "Period" tab is active (default)
    const presetTab = page.locator('#tab-preset');
    await expect(presetTab).toHaveAttribute('aria-selected', 'true');

    // Click the period select trigger (within the tabpanel).
    // The period selector should ALWAYS be visible on the default Period tab.
    const tabpanel = page.locator('#digest-content-panel');
    const selectTrigger = tabpanel.getByRole('combobox').first();
    await expect(selectTrigger).toBeVisible({ timeout: 10000 });

    // Verify "Last 7 days" is the default selected value
    await expect(selectTrigger).toHaveText(/Last 7 days/);

    await selectTrigger.click();

    // Dropdown listbox appears with period options
    const listbox = page.getByRole('listbox');
    await expect(listbox.getByText('Last 7 days')).toBeVisible();
    await expect(listbox.getByText('Last 14 days')).toBeVisible();
    await expect(listbox.getByText('Last 30 days')).toBeVisible();

    // Close dropdown
    await page.keyboard.press('Escape');
  });

  test('generate button is present and clickable', async ({
    authenticatedPage: page,
  }) => {
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

    // Button is clickable (no error thrown on click)
    // NOTE: Do NOT wait for generation to complete -- it calls the AI API
    await generateButton.click();

    // Verify the click registered — the section remains visible (no crash)
    // and the button changes to "Generating..." state. Wait for the button
    // state change rather than an arbitrary timeout.
    await expect(page.getByRole('button', { name: /Generating/ })).toBeVisible({
      timeout: 5000,
    });
  });

  // WS3: this test moved into the serial `populated` describe at the end of
  // this file, where deterministic change_reports rows are seeded so the
  // "Previous Reports" section renders and the assertions run unconditionally.

  // Asserts the empty-state hero with generate controls. The change_reports
  // table is GLOBAL, so the populated `describe` at the end of this file may
  // have seeded rows present concurrently; we route-mock the latest/list
  // endpoints to an empty response so this test deterministically observes the
  // empty state it is designed to assert (its premise has always been "the DB
  // is empty").
  test('empty state shows hero with generate controls', async ({
    authenticatedPage: page,
  }) => {
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

    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Wait for loading to complete by checking for the mode selector (always
    // present once loading finishes) or the hero heading (empty state)
    const modeSelector = page.locator(
      '[role="tablist"][aria-label="Report mode"]',
    );
    const heroCandidate = page.getByRole('heading', {
      name: 'Change Reports',
      level: 1,
    });
    await expect(modeSelector.or(heroCandidate)).toBeVisible({
      timeout: 10000,
    });

    // Hard-expect the hero empty state is shown (appears when no digest
    // generated yet). Staging fixtures must leave /digest empty for this test.
    const heroHeading = page.getByRole('heading', {
      name: 'Change Reports',
      level: 1,
    });
    await expect(heroHeading).toBeVisible({ timeout: 3000 });

    // Description text is visible
    await expect(
      page.getByText('See what changed in your knowledge base'),
    ).toBeVisible();

    // Mode selector is present
    const tablist = page.locator('[role="tablist"][aria-label="Report mode"]');
    await expect(tablist).toBeVisible();

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
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Click "Custom" tab
    const customTab = page.locator('#tab-custom');
    await customTab.click();
    await expect(customTab).toHaveAttribute('aria-selected', 'true');

    // Open the domain filter select
    const domainSelect = page.locator('#custom-domain');
    await expect(domainSelect).toBeVisible();

    // Click to open the select
    await domainSelect.click();

    // Select the first non-"All domains" option
    const listbox = page.getByRole('listbox');
    const options = listbox.getByRole('option');
    const optionCount = await options.count();

    if (optionCount > 1) {
      // Click the second option (first non-"All domains" one)
      await options.nth(1).click();

      // An "Active filters:" label appears
      await expect(page.getByText('Active filters:')).toBeVisible({
        timeout: 5000,
      });

      // A badge with the selected domain name is visible
      // The badge has a remove button
      const removeDomainButton = page.locator(
        '[aria-label^="Remove domain filter"]',
      );
      await expect(removeDomainButton).toBeVisible();
    }
  });

  test('custom keyword filter shows individual keyword badges', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/change-reports');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Click "Custom" tab
    const customTab = page.locator('#tab-custom');
    await customTab.click();
    await expect(customTab).toHaveAttribute('aria-selected', 'true');

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
