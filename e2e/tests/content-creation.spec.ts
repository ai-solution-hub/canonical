import { test, expect } from '../fixtures';
import { isMobileViewport } from '../helpers/responsive';

/**
 * Flow: Content Creation — page shell, tab structure, and routing
 *
 * ID-131 "17-final" REWRITE (G-IMS-DELETE tail): the original spec covered
 * a FOUR-tab page ("Write content" | "Import from URL" | "Upload file" |
 * "Batch Q&A") with a manual react-hook-form + TipTap editor + template
 * gallery on the "Write content" tab. That whole manual-create surface
 * (and its `content_items` write path) died at {131.18} ("BI-33 — S438
 * owner-ratified narrowing" — see `app/item/new/new-item-tabs.tsx`'s
 * module comment). The page is now a THREE-tab shell
 * (`app/item/new/new-item-tabs.tsx`): "Import from URL" | "Upload file" |
 * "Batch Q&A", server-validated against `?tab=` in `app/item/new/page.tsx`
 * (`VALID_TABS = ['url', 'upload', 'batch']`, default `'url'`).
 *
 * Each tab's own content is covered by its dedicated spec —
 * `content-ingestion-url.spec.ts` (URL tab), `content-ingestion-upload.spec.ts`
 * + `content-ingestion-folder-drop.spec.ts` (Upload tab, gated
 * binding-admission flow). THIS spec is scoped to the page shell: tab
 * structure, role gating, and `?tab=` deep-linking/redirect routing —
 * it does not re-test any individual tab's internals.
 *
 * Worker-scoped data provides standard test fixtures. No additional seeding
 * or content-item cleanup is needed — this spec creates no rows.
 */

// ---------------------------------------------------------------------------
// 1. Page Access and Tab Structure
// ---------------------------------------------------------------------------

test.describe('Content creation -- page access and tab structure', () => {
  test('create page loads with Import from URL tab active by default', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new');

    // Tab list is visible
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 10000 });

    // "Import from URL" tab is present and selected (server default, no
    // `?tab=` param)
    const urlTab = page.getByRole('tab', { name: /Import from URL/i });
    await expect(urlTab).toBeVisible();
    await expect(urlTab).toHaveAttribute('aria-selected', 'true');

    // All three tabs are visible — the "Write content" tab is gone
    await expect(page.getByRole('tab', { name: /Upload file/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Batch Q&A/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Write content/i })).toHaveCount(
      0,
    );

    // The URL import section is visible
    await expect(
      page.locator('section[aria-label="Import content from URL"]'),
    ).toBeVisible();
  });

  test('viewer role is redirected away from create page', async ({
    viewerPage: page,
  }) => {
    await page.goto('/item/new');

    // Viewer should be redirected to /browse
    await expect(page).toHaveURL(/\/browse/, { timeout: 10000 });
  });

  test('editor role can access create page', async ({ editorPage: page }) => {
    await page.goto('/item/new');

    // Tab list is visible (editor can create content)
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 10000 });

    // The URL import section loads for editor too
    await expect(
      page.locator('section[aria-label="Import content from URL"]'),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Deep-linking and redirects
// ---------------------------------------------------------------------------

test.describe('Content creation -- tab deep-linking and routing', () => {
  test('deep link ?tab=upload opens Upload tab', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new?tab=upload');

    const uploadTab = page.getByRole('tab', { name: /Upload file/i });
    await expect(uploadTab).toBeVisible({ timeout: 10000 });
    await expect(uploadTab).toHaveAttribute('aria-selected', 'true');

    // Upload section is visible
    await expect(
      page.locator('section[aria-label="Upload documents"]'),
    ).toBeVisible();
  });

  test('deep link ?tab=batch opens Batch Q&A tab', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new?tab=batch');

    const batchTab = page.getByRole('tab', { name: /Batch Q&A/i });
    await expect(batchTab).toBeVisible({ timeout: 10000 });
    await expect(batchTab).toHaveAttribute('aria-selected', 'true');

    // Batch section is visible
    await expect(
      page.locator('section[aria-label="Batch Q&A creation"]'),
    ).toBeVisible();
  });

  test('deep link ?tab=url opens the URL tab explicitly', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new?tab=url');

    const urlTab = page.getByRole('tab', { name: /Import from URL/i });
    await expect(urlTab).toBeVisible({ timeout: 10000 });
    await expect(urlTab).toHaveAttribute('aria-selected', 'true');
  });

  test('an invalid ?tab= value falls back to the URL tab', async ({
    authenticatedPage: page,
  }) => {
    // app/item/new/page.tsx validates `tab` against VALID_TABS and falls
    // back to 'url' for anything else — proves the server-side guard, not
    // just a client default.
    await page.goto('/item/new?tab=write');

    const urlTab = page.getByRole('tab', { name: /Import from URL/i });
    await expect(urlTab).toBeVisible({ timeout: 10000 });
    await expect(urlTab).toHaveAttribute('aria-selected', 'true');
  });

  test('legacy /item/new/batch redirects to ?tab=batch', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/item/new/batch');

    // Should redirect to /item/new?tab=batch
    await expect(page).toHaveURL(/\/item\/new\?tab=batch/, {
      timeout: 10000,
    });

    // Batch tab should be active
    const batchTab = page.getByRole('tab', { name: /Batch Q&A/i });
    await expect(batchTab).toBeVisible();
    await expect(batchTab).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Content creation -- Browse Upload affordance', () => {
  test('Browse Upload button navigates to /item/new?tab=upload', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/browse');

    // Wait for the browse page to load
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // Find the Upload button/link in the header
    const uploadLink = page.getByRole('link', { name: /upload/i });
    await expect(uploadLink).toBeVisible({ timeout: 5000 });

    // Click it
    await uploadLink.click();

    // Should navigate to /item/new?tab=upload
    await expect(page).toHaveURL(/\/item\/new\?tab=upload/, {
      timeout: 10000,
    });

    // Upload tab should be active
    const uploadTab = page.getByRole('tab', { name: /Upload file/i });
    await expect(uploadTab).toHaveAttribute('aria-selected', 'true');
  });
});

// ---------------------------------------------------------------------------
// 3. Mobile
// ---------------------------------------------------------------------------

test.describe('Content creation -- mobile viewport', () => {
  test('tab list is usable on mobile viewport', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!isMobileViewport(page), 'Mobile-only test');

    await page.goto('/item/new');

    // Tab list is visible (may be scrollable)
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible({ timeout: 10000 });

    // The default URL tab's import input is visible and within viewport
    await expect(page.getByLabel(/web page url/i)).toBeVisible();
  });
});
