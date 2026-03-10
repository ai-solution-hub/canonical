/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture `use()` is not a React hook */
import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';

type AuthFixtures = {
  /** A page with an authenticated admin session (default). */
  authenticatedPage: Page;
  /** A page with an authenticated editor session. */
  editorPage: Page;
  /** A page with an authenticated viewer session. */
  viewerPage: Page;
};

/**
 * Extended test fixture that provides authenticated pages for all 3 roles.
 *
 * The setup project (auth.setup.ts) runs first and saves authenticated
 * browser state for admin, editor, and viewer to e2e/.auth/*.json.
 *
 * - `authenticatedPage` uses admin state (loaded via project storageState)
 * - `editorPage` creates a new context with editor state
 * - `viewerPage` creates a new context with viewer state
 */
export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Storage state is already loaded by the project config —
    // just navigate to the app.
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Knowledge Hub' })).toBeVisible({ timeout: 10000 });
    await use(page);
  },

  editorPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/editor.json',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Knowledge Hub' })).toBeVisible({ timeout: 10000 });
    await use(page);
    await ctx.close();
  },

  viewerPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/viewer.json',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Knowledge Hub' })).toBeVisible({ timeout: 10000 });
    await use(page);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
