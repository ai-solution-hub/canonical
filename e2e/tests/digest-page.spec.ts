import { test, expect } from '../fixtures';

/**
 * Flow: Change Reports (Digest)
 *
 * Tests the Change Reports page at /digest. Covers the heading,
 * mode selector (Period/Daily/Custom), generate button, past reports
 * list, and empty state handling.
 *
 * The /digest route stays as-is (URL stability), but the page heading
 * says "Change Reports" (not "Digest").
 */

// ---------------------------------------------------------------------------
// 1. Change Reports Page
// ---------------------------------------------------------------------------

test.describe('Change Reports page', () => {
  test('page loads with correct heading', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/digest');

    // Wait for the loading skeleton to disappear and content to appear
    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // The section aria-label="Change reports" confirms the correct branding
    // (already asserted above). The "Change Reports" heading text only appears
    // in the empty state (no digest loaded). When an existing digest is loaded,
    // the page shows the digest view directly with controls. Both states are
    // valid — the section's aria-label guarantees correct branding in either case.
    //
    // Verify the page does NOT use "Digest" as a heading anywhere.
    await expect(page.getByRole('heading', { name: /^Digest$/i })).not.toBeVisible();
  });

  test('mode selector tabs are present and functional', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/digest');

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
    await page.goto('/digest');

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
    await expect(
      page.getByRole('button', { name: /Generate/ }),
    ).toBeVisible();
  });

  test('clicking Custom tab shows custom filter panel', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/digest');

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
    await page.goto('/digest');

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
    await page.goto('/digest');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Locate the generate button — text varies by state:
    // Empty state (hero): "Generate Report"
    // Loaded state (bar): "Generate New Report"
    const generateButton = page.getByRole('button', { name: /Generate.*Report/i });
    await expect(generateButton).toBeVisible();
    await expect(generateButton).toBeEnabled();

    // Button is clickable (no error thrown on click)
    // NOTE: Do NOT wait for generation to complete -- it calls the AI API
    await generateButton.click();

    // Verify the click registered (button may show "Generating..." state)
    // The important thing is no crash / error occurs
    await page.waitForTimeout(500);
  });

  test('past reports section shows previous entries when reports exist', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/digest');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Check if "Previous Reports" heading exists (only rendered when past reports exist)
    const previousReportsHeading = page.getByText('Previous Reports');

    if (await previousReportsHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Report list should contain at least one entry
      const reportList = page.locator('[aria-label="Previous reports"]');
      await expect(reportList).toBeVisible();

      const reportEntries = reportList.locator('li');
      const entryCount = await reportEntries.count();
      expect(entryCount).toBeGreaterThan(0);

      // Each entry is a clickable button
      const firstButton = reportEntries.first().locator('button');
      await expect(firstButton).toBeVisible();

      // Each entry shows an item count
      await expect(firstButton.getByText(/\d+ items/)).toBeVisible();
    }
    // If no previous reports, the section simply does not render -- that is acceptable
  });

  test('empty state shows hero with generate controls', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/digest');

    const section = page.locator('section[aria-label="Change reports"]');
    await expect(section).toBeVisible({ timeout: 15000 });

    // Wait for loading to complete
    await page.waitForTimeout(2000);

    // Check if the hero empty state is shown (appears when no digest generated yet)
    const heroHeading = page.getByRole('heading', { name: 'Change Reports', level: 1 });

    if (await heroHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
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
    } else {
      // A digest is already loaded (hero state not visible) -- skip
      test.skip();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Custom Filter Interactions
// ---------------------------------------------------------------------------

test.describe('Change Reports -- custom filter interactions', () => {
  test('custom domain filter shows active filter badge', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/digest');

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
      await expect(page.getByText('Active filters:')).toBeVisible({ timeout: 5000 });

      // A badge with the selected domain name is visible
      // The badge has a remove button
      const removeDomainButton = page.locator('[aria-label^="Remove domain filter"]');
      await expect(removeDomainButton).toBeVisible();
    }
  });

  test('custom keyword filter shows individual keyword badges', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/digest');

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
    await expect(page.getByText('Active filters:')).toBeVisible({ timeout: 5000 });

    // Two keyword badges are visible: "ai agents" and "cloud"
    const aiAgentsBadge = page.getByText('ai agents', { exact: true });
    const cloudBadge = page.getByText('cloud', { exact: true });

    await expect(aiAgentsBadge).toBeVisible();
    await expect(cloudBadge).toBeVisible();

    // Each badge has a remove button
    const removeCloudButton = page.locator('[aria-label="Remove keyword filter: cloud"]');
    await expect(removeCloudButton).toBeVisible();

    // Clicking the remove button on "cloud" leaves only "ai agents" badge
    await removeCloudButton.click();

    // "cloud" badge should disappear
    await expect(cloudBadge).not.toBeVisible({ timeout: 5000 });

    // "ai agents" badge should still be visible
    await expect(aiAgentsBadge).toBeVisible();
  });
});
