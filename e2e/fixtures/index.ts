/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture `use()` is not a React hook */
import { test as testDataTest, type WorkerData } from './test-data-fixture';
import type { Page, BrowserContext } from '@playwright/test';

/**
 * Combined test fixture merging auth + worker-scoped test data.
 *
 * Provides:
 * - `authenticatedPage` — admin page (from storageState, default)
 * - `editorPage` — editor role page (separate browser context)
 * - `viewerPage` — viewer role page (separate browser context)
 * - `workerData` — per-worker isolated test data (6 items, 1 workspace, 1 bid with responses)
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
    // Storage state is already loaded by the project config —
    // just navigate to the app.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
  },

  editorPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/editor.json',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
    await ctx.close();
  },

  viewerPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/viewer.json',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
export type { WorkerData };
