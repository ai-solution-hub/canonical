import { test as base, type Page } from '@playwright/test';

type AuthFixtures = {
  /** A page with an authenticated Supabase session already established. */
  authenticatedPage: Page;
};

/**
 * Extended test fixture that provides an authenticated page.
 *
 * The setup project (auth.setup.ts) runs first and saves the authenticated
 * browser state to e2e/.auth/state.json. Each browser project loads that
 * state via storageState in playwright.config.ts, so the page already has
 * valid session cookies when this fixture runs.
 */
export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Storage state is already loaded by the project config —
    // just navigate to the app.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page); // eslint-disable-line react-hooks/rules-of-hooks
  },
});

export { expect } from '@playwright/test';
