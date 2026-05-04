/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture `use()` is not a React hook */
import { test as testDataTest, type WorkerData } from './test-data-fixture';
import { expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { hideDevOverlays } from '../helpers/dev-overlays';

/**
 * Combined test fixture merging auth + worker-scoped test data.
 *
 * Provides:
 * - `authenticatedPage` — admin page (from storageState, default)
 * - `editorPage` — editor role page (separate browser context)
 * - `viewerPage` — viewer role page (separate browser context)
 * - `workerData` — per-worker isolated test data
 *
 * Usage:
 *   import { test, expect } from '../fixtures';
 *   test('my test', async ({ authenticatedPage, workerData }) => { ... });
 */

type CombinedFixtures = {
  /** A page with an authenticated admin session (default). */
  authenticatedPage: Page;
  /** A page with an authenticated editor session. */
  editorPage: Page;
  /** A page with an authenticated viewer session. */
  viewerPage: Page;
};

export const test = testDataTest.extend<CombinedFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await hideDevOverlays(page);
    await page.goto('/');
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).first(),
    ).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      // Best-effort only: tests should not fail if a non-critical dashboard
      // request stays in flight, but waiting here avoids aborting cold API
      // route requests when an individual spec immediately navigates away.
    });
    await use(page);
  },

  editorPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/editor.json',
    });
    const page = await ctx.newPage();
    await hideDevOverlays(page);
    await page.goto('/');
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).first(),
    ).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      // Best-effort only; see authenticatedPage above.
    });
    await use(page);
    await ctx.close();
  },

  viewerPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/viewer.json',
    });
    const page = await ctx.newPage();
    await hideDevOverlays(page);
    await page.goto('/');
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).first(),
    ).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      // Best-effort only; see authenticatedPage above.
    });
    await use(page);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
export type { WorkerData };
