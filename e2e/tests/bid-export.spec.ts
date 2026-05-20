import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';
import { createTestBid, createExportReadyBid } from '../helpers/data-factory';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Flow: Procurement Export
 *
 * Tests bid export functionality from the bid detail page (`/procurement/[id]`).
 * The export menu is a dropdown (`ProcurementExportMenu`) with options for
 * Word (.docx), Excel (.xlsx), and Print/PDF. Export triggers a
 * download via the `/api/procurement/{id}/export/{format}` endpoint.
 *
 * Worker-scoped data provides `workerData.procurementId` (a bid in "drafting"
 * state with 4 questions and 2 responses).
 *
 * Note: `ProcurementExportMenu` is inside a `{canEdit && ...}` block, so
 * viewers cannot see the export button. Viewer export tests are not
 * needed — the existing `bid-pipeline.spec.ts` role-gating tests
 * cover viewer restrictions on the bid detail page.
 */

// ---------------------------------------------------------------------------
// 1. Menu Visibility
// ---------------------------------------------------------------------------

test.describe('Procurement export -- menu visibility', () => {
  test('export button is visible on bid detail page', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.skip(
      isMobileViewport(page),
      'Desktop-only test — export button is in desktop actions container',
    );

    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // ProcurementExportMenu trigger has aria-label="Export bid responses"
    const exportButton = page.getByRole('button', {
      name: 'Export bid responses',
    });
    await expect(exportButton).toBeVisible();

    // The button text includes "Export"
    await expect(exportButton).toHaveText(/Export/);
  });

  test('export button is disabled when bid has no questions', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.skip(isMobileViewport(page), 'Desktop-only test');

    // Create a new bid with no questions
    const emptyBidId = await createTestBid(workerData.prefix);

    try {
      await page.goto(`/procurement/${emptyBidId}`);

      // Wait for page to load
      await expect(page.getByRole('heading', { name: /Temp Procurement/ })).toBeVisible(
        { timeout: 10000 },
      );

      // Export button should be present but disabled
      const exportButton = page.getByRole('button', {
        name: 'Export bid responses',
      });
      await expect(exportButton).toBeVisible();
      await expect(exportButton).toBeDisabled();
    } finally {
      const supabase = createServiceClient();
      await supabase.from('workspaces').delete().eq('id', emptyBidId);
    }
  });

  test('export dropdown shows DOCX, XLSX, and Print options', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.skip(isMobileViewport(page), 'Desktop-only test');

    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Click the Export button to open the dropdown
    const exportButton = page.getByRole('button', {
      name: 'Export bid responses',
    });
    await exportButton.click();

    // Dropdown menu content should be visible with three options
    await expect(
      page.getByRole('menuitem', { name: /Word \(\.docx\)/ }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('menuitem', { name: /Excel \(\.xlsx\)/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: /Print \/ Save as PDF/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Download Triggers
// ---------------------------------------------------------------------------

test.describe('Procurement export -- download triggers', () => {
  test('DOCX export triggers a download', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.skip(isMobileViewport(page), 'Desktop-only test');

    // Create an export-ready bid with approved responses
    const { procurementId, questionIds, responseIds } = await createExportReadyBid(
      workerData.prefix,
    );

    try {
      await page.goto(`/procurement/${procurementId}`);

      // Wait for page to load — bid name includes "Temp Procurement" from the factory
      await expect(page.getByRole('heading', { name: /Temp Procurement/ })).toBeVisible(
        { timeout: 10000 },
      );

      // Click the Export button
      const exportButton = page.getByRole('button', {
        name: 'Export bid responses',
      });
      await exportButton.click();

      // The export hook uses fetch + blob URL + programmatic <a> click,
      // which Playwright detects as a download event
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

      // Click "Word (.docx)" menu item
      await page.getByRole('menuitem', { name: /Word \(\.docx\)/ }).click();

      const download = await downloadPromise;

      // Verify the downloaded file has .docx extension
      expect(download.suggestedFilename()).toMatch(/\.docx$/);
    } finally {
      const supabase = createServiceClient();
      if (responseIds.length > 0) {
        await supabase.from('bid_responses').delete().in('id', responseIds);
      }
      if (questionIds.length > 0) {
        await supabase.from('bid_questions').delete().in('id', questionIds);
      }
      await supabase.from('workspaces').delete().eq('id', procurementId);
    }
  });

  test('XLSX export triggers a download', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.skip(isMobileViewport(page), 'Desktop-only test');

    // Create an export-ready bid with approved responses
    const { procurementId, questionIds, responseIds } = await createExportReadyBid(
      workerData.prefix,
    );

    try {
      await page.goto(`/procurement/${procurementId}`);

      // Wait for page to load — bid name includes "Temp Procurement" from the factory
      await expect(page.getByRole('heading', { name: /Temp Procurement/ })).toBeVisible(
        { timeout: 10000 },
      );

      // Click the Export button
      const exportButton = page.getByRole('button', {
        name: 'Export bid responses',
      });
      await exportButton.click();

      // Set up download listener before clicking
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

      // Click "Excel (.xlsx)" menu item
      await page.getByRole('menuitem', { name: /Excel \(\.xlsx\)/ }).click();

      const download = await downloadPromise;

      // Verify the downloaded file has .xlsx extension
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    } finally {
      const supabase = createServiceClient();
      if (responseIds.length > 0) {
        await supabase.from('bid_responses').delete().in('id', responseIds);
      }
      if (questionIds.length > 0) {
        await supabase.from('bid_questions').delete().in('id', questionIds);
      }
      await supabase.from('workspaces').delete().eq('id', procurementId);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Mobile Actions
// ---------------------------------------------------------------------------

test.describe('Procurement export -- mobile actions', () => {
  test('export is accessible via mobile action menu', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.skip(!isMobileViewport(page), 'Mobile-only test');

    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Click the "Actions" button (mobile action menu trigger).
    // force: true is needed on Pixel 5 mobile viewport because the button
    // may be partially obscured by the sticky header. This is a known
    // limitation documented in CLAUDE.md (E2E mobile gotcha) and the
    // e2e-expansion-batch1-spec.md Known Risks section.
    const actionsButton = page.getByRole('button', { name: 'Actions' });
    await expect(actionsButton).toBeVisible();
    await actionsButton.click({ force: true });

    // "Export" submenu trigger is a menuitem within the dropdown
    const exportSubmenu = page.getByRole('menuitem', { name: 'Export' });
    await expect(exportSubmenu).toBeVisible({ timeout: 5000 });

    // Click Export to reveal sub-menu options.
    // force: true for same mobile viewport overlap reason as above.
    await exportSubmenu.click({ force: true });

    // Sub-menu should show Word and Excel options
    await expect(
      page.getByRole('menuitem', { name: /Word \(\.docx\)/ }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('menuitem', { name: /Excel \(\.xlsx\)/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Keyboard Accessibility
// ---------------------------------------------------------------------------

test.describe('Procurement export -- keyboard accessibility', () => {
  test('export menu is keyboard navigable', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.skip(isMobileViewport(page), 'Desktop-only test');

    await page.goto(`/procurement/${workerData.procurementId}`);

    await expect(
      page.getByRole('heading', { name: /IT Support Services/ }),
    ).toBeVisible({ timeout: 10000 });

    // Focus the Export button
    const exportButton = page.getByRole('button', {
      name: 'Export bid responses',
    });
    await exportButton.focus();

    // Press Enter to open dropdown
    await page.keyboard.press('Enter');

    // Dropdown should open — menu items should be visible
    const wordItem = page.getByRole('menuitem', { name: /Word \(\.docx\)/ });
    await expect(wordItem).toBeVisible({ timeout: 5000 });

    // Arrow down should navigate to menu items (Radix handles focus)
    await page.keyboard.press('ArrowDown');

    // First menu item (Word) should be focused/highlighted
    // Radix dropdown marks the focused item with data-highlighted
    const highlightedItem = page.locator('[role="menuitem"][data-highlighted]');
    await expect(highlightedItem).toBeVisible();

    // Press Escape to close the dropdown
    await page.keyboard.press('Escape');

    // Dropdown should close
    await expect(wordItem).not.toBeVisible();
  });
});
