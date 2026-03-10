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
 * - `workerData` — per-worker isolated test data (12 items, 3 workspaces, 1 bid with 4 questions/2 responses, notifications, read marks)
 *
 * Usage:
 *   import { test, expect } from '../fixtures';
 *   test('my test', async ({ authenticatedPage, workerData }) => { ... });
 */

/**
 * Hide CopilotKit Web Inspector and dev overlays that intercept pointer events.
 * Uses addInitScript (persists across navigations within the same context).
 */
async function hideDevOverlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const css = 'cpk-web-inspector { display: none !important; pointer-events: none !important; }';
    const inject = () => {
      if (document.head) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      } else {
        requestAnimationFrame(inject);
      }
    };
    inject();

    // Also hide 429/401 runtime info banners and "what's new" toasts from CopilotKit
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('button')) {
        if (el.textContent?.trim() === '×') {
          const container = el.parentElement;
          if (container?.textContent?.includes('Runtime info request failed') ||
              container?.textContent?.includes('is now live')) {
            (container as HTMLElement).style.display = 'none';
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

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
    await page.waitForLoadState('networkidle');
    await use(page);
  },

  editorPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/editor.json',
    });
    const page = await ctx.newPage();
    await hideDevOverlays(page);
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
    await hideDevOverlays(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
export type { WorkerData };
