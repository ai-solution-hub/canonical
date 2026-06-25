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
  /**
   * A page authenticated as the DEDICATED sign-out user (TEST_USER_4), in its
   * own browser context. Used ONLY by the destructive sign-out test so its
   * global sign-out never revokes the shared admin/editor/viewer sessions (S420).
   */
  signoutPage: Page;
};

/**
 * Navigate to `/` and assert the authenticated app shell rendered. On failure,
 * when E2E_AUTH_DEBUG is set, emit ONE `[E2E_AUTH_DEBUG]` line capturing WHY the
 * redirect happened — goto status, the URL actually landed on, whether the
 * Supabase auth cookie survived storageState, and the auth server's direct
 * response to the stored access token (429 rate-limit vs 401 invalid vs 200 ok).
 * This disambiguates the nightly's mass `/login` redirects (ID-128 / S420
 * stabilisation). Diagnostics are best-effort and never alter the failure.
 */
async function gotoAuthedShell(page: Page, role: string): Promise<void> {
  const resp = await page.goto('/');
  try {
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).first(),
    ).toBeVisible({ timeout: 10000 });
  } catch (err) {
    if (process.env.E2E_AUTH_DEBUG) {
      const cookies = await page.context().cookies();
      const authChunks = cookies
        .filter((c) => c.name.includes('-auth-token'))
        .sort((a, b) => a.name.localeCompare(b.name));
      let probe = 'skipped';
      try {
        const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
        const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
        const raw = decodeURIComponent(authChunks.map((c) => c.value).join(''));
        const token = raw ? (JSON.parse(raw).access_token as string) : '';
        const r = await page.request.get(`${supaUrl}/auth/v1/user`, {
          headers: { apikey: anon, Authorization: `Bearer ${token}` },
        });
        probe = String(r.status());
      } catch (e) {
        probe = `probe-err:${(e as Error).message}`;
      }
      console.warn(
        `[E2E_AUTH_DEBUG] role=${role} gotoStatus=${resp?.status() ?? 'n/a'} ` +
          `landedUrl=${page.url()} authCookies=[${authChunks
            .map((c) => c.name)
            .join(',')}] authUserProbe=${probe}`,
      );
    }
    throw err;
  }
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
    // Best-effort only: tests should not fail if a non-critical dashboard
    // request stays in flight, but waiting here avoids aborting cold API
    // route requests when an individual spec immediately navigates away.
  });
}

export const test = testDataTest.extend<CombinedFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await hideDevOverlays(page);
    await gotoAuthedShell(page, 'admin');
    await use(page);
  },

  editorPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/editor.json',
    });
    const page = await ctx.newPage();
    await hideDevOverlays(page);
    await gotoAuthedShell(page, 'editor');
    await use(page);
    await ctx.close();
  },

  viewerPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/viewer.json',
    });
    const page = await ctx.newPage();
    await hideDevOverlays(page);
    await gotoAuthedShell(page, 'viewer');
    await use(page);
    await ctx.close();
  },

  signoutPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/signout.json',
    });
    const page = await ctx.newPage();
    await hideDevOverlays(page);
    await gotoAuthedShell(page, 'signout');
    await use(page);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
export type { WorkerData };
