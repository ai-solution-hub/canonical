import { test, expect } from '../fixtures';

/**
 * Flow: Provenance Pipeline Health and Audit tabs
 *
 * Tests the Pipeline Health tab (time-range filter, kind filter) and the
 * Audit tab (activity feed, export PDF button).
 *
 * The authenticated test user (user1) has admin role.
 */

test.describe('Provenance -- Pipeline Health tab', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/provenance?tab=pipeline-health');
    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible(
      { timeout: 15000 },
    );

    // Confirm the Pipeline Health tab is selected
    await expect(
      page.getByRole('tab', { name: 'Pipeline Health' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('shows time-range filter controls', async ({
    authenticatedPage: page,
  }) => {
    // The time-range group should be visible with the four time range options
    const timeRangeGroup = page.getByRole('group', { name: 'Time range' });
    await expect(timeRangeGroup).toBeVisible({ timeout: 15000 });

    // All four time-range buttons should be present
    await expect(timeRangeGroup.getByText('1 hour')).toBeVisible();
    await expect(timeRangeGroup.getByText('24 hours')).toBeVisible();
    await expect(timeRangeGroup.getByText('7 days')).toBeVisible();
    await expect(timeRangeGroup.getByText('30 days')).toBeVisible();

    // 24 hours should be the default (aria-pressed="true")
    await expect(timeRangeGroup.getByText('24 hours')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('shows kind filter with at least one pipeline pill', async ({
    authenticatedPage: page,
  }) => {
    // The pipeline filter group renders when `availableKinds.length > 0`
    // (derived from the rollup returned by /api/admin/provenance/pipeline-runs
    // for the default 24h window). The persistent staging branch records
    // pipeline_runs from organic CI and seed activity, so the populated
    // branch must render under the default range. The previous
    // `if (await pipelineFilter.isVisible()) { … }` conditional silently
    // passed against an empty pipeline_runs window per
    // `feedback_e2e_conditional_false_pass` (test-philosophy §2.1).
    const pipelineFilter = page.getByRole('group', {
      name: 'Pipeline filter',
    });
    await expect(pipelineFilter).toBeVisible({ timeout: 15000 });

    // At least one filter pill should be present
    const buttons = pipelineFilter.getByRole('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Provenance -- Audit tab', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/provenance?tab=audit');
    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible(
      { timeout: 15000 },
    );

    // Confirm the Audit tab is selected
    await expect(page.getByRole('tab', { name: 'Audit' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('shows activity feed', async ({ authenticatedPage: page }) => {
    // The audit tab should show the "Audit" sub-heading
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Audit' })).toBeVisible({
      timeout: 15000,
    });

    // Should show the descriptive text
    await expect(page.getByText('A log of recent changes')).toBeVisible();
  });

  test('shows "Export PDF" button with date range inputs', async ({
    authenticatedPage: page,
  }) => {
    // The ExportAuditPdfButton renders two date inputs and the export button
    const exportButton = page.getByRole('button', { name: /Export PDF/ });
    await expect(exportButton).toBeVisible({ timeout: 15000 });

    // The "From" and "To" date inputs should be present
    const fromInput = page.getByLabel('From');
    await expect(fromInput).toBeVisible();

    const toInput = page.getByLabel('To');
    await expect(toInput).toBeVisible();
  });
});
