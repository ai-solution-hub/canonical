import { test as base, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Test user credentials.
 * Uses TEST_USER_1 from .env by default (admin role).
 * Override with E2E_TEST_EMAIL / E2E_TEST_PASSWORD if needed.
 */
const TEST_USER_EMAIL = process.env.E2E_TEST_EMAIL || process.env.TEST_USER_1_EMAIL || 'test.user1@test-kb-aish.co.uk';
const TEST_USER_PASSWORD = process.env.E2E_TEST_PASSWORD || process.env.TEST_USER_1_PASSWORD || 'Welcome12391.';

type AuthFixtures = {
  /** A page with an authenticated Supabase session already established. */
  authenticatedPage: Page;
};

/**
 * Extended test fixture that provides an authenticated page.
 *
 * Authentication is performed via the Supabase Auth API (not the UI),
 * then the session tokens are injected into the browser's localStorage
 * so the Supabase SSR client picks them up on page load.
 */
export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.'
      );
    }

    // Sign in via the Supabase JS client to get session tokens
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });

    if (error || !data.session) {
      throw new Error(
        `Supabase auth failed for ${TEST_USER_EMAIL}: ${error?.message ?? 'No session returned'}. ` +
          'Ensure the test user exists and credentials are correct.'
      );
    }

    const { access_token, refresh_token } = data.session;

    // Navigate to the app origin first so we can set localStorage
    await page.goto('/');

    // Inject the Supabase session into the browser's storage.
    // The @supabase/ssr package reads from cookies set by the middleware,
    // but we can also set the auth tokens directly in localStorage
    // which the Supabase JS client reads on initialisation.
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

    await page.evaluate(
      ({ key, session }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          })
        );
      },
      { key: storageKey, session: { access_token, refresh_token } }
    );

    // Reload so the app picks up the session from storage
    await page.reload();

    // Wait for the page to settle with the authenticated session
    await page.waitForLoadState('networkidle');

    await use(page); // eslint-disable-line react-hooks/rules-of-hooks
  },
});

export { expect } from '@playwright/test';
