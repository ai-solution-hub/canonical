import { expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/supabase/schema';

/**
 * Shared E2E auth-session helpers.
 *
 * `loginAndSave` is the single source of truth for minting a Supabase session
 * and persisting it as a Playwright storageState file (chunked `@supabase/ssr`
 * cookies). Used by:
 *  - `e2e/auth.setup.ts` — the setup project that authenticates admin/editor/
 *    viewer once before the suite.
 *  - `restoreAdminSession` below — re-provisions the shared admin session after
 *    the destructive sign-out test (see auth.spec.ts).
 *
 * Keeping both paths on ONE implementation guarantees the restored cookie format
 * is byte-identical to setup's, so the middleware accepts it identically.
 */

// @supabase/ssr chunks auth cookies at ~3180 chars.
const CHUNK_SIZE = 3180;

/**
 * Authenticate a test user via the Supabase API and save browser state to
 * `savePath` as a Playwright storageState file. Mirrors the @supabase/ssr
 * chunked-cookie format the running app expects.
 */
export async function loginAndSave(
  page: Page,
  emailEnv: string,
  passwordEnv: string,
  defaultEmail: string,
  defaultPassword: string,
  savePath: string,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars. ' +
        'Ensure .env and .env.local are present.',
    );
  }

  // ID-115 (S9): route to the exposed api schema
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { ...DB_OPTION });

  const email = process.env[emailEnv] || defaultEmail;
  const password = process.env[passwordEnv] || defaultPassword;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(
      `Auth setup failed for ${email}: ${error?.message ?? 'No session returned'}`,
    );
  }

  // Build session cookies matching @supabase/ssr chunked format
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const sessionPayload = JSON.stringify({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    token_type: 'bearer',
    expires_in: data.session.expires_in,
    expires_at: data.session.expires_at,
    user: data.session.user,
  });

  const chunks: string[] = [];
  for (let i = 0; i < sessionPayload.length; i += CHUNK_SIZE) {
    chunks.push(sessionPayload.slice(i, i + CHUNK_SIZE));
  }

  const cookies = chunks.map((chunk, i) => ({
    name: chunks.length === 1 ? `${cookieName}.0` : `${cookieName}.${i}`,
    value: chunk,
    domain: 'localhost',
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }));

  await page.context().addCookies(cookies);

  // Navigate and verify auth works. Bumped to 30s to absorb Turbopack cold-start
  // variance — the dev server may not be warm on first run.
  await page.goto('/', { timeout: 30000 });
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

  // Save the authenticated browser state
  await page.context().storageState({ path: savePath });
}

/**
 * Re-provision the shared admin storageState (`e2e/.auth/admin.json`) with a
 * FRESH Supabase session.
 *
 * WHY: the auth.spec.ts "can sign out" test clicks the real Sign-out button,
 * which calls `supabase.auth.signOut()` at GLOBAL scope (sign-out-button.tsx) —
 * revoking EVERY session for the admin user, including the one in admin.json
 * that all `chromium-desktop` specs share. Without re-provisioning, every spec
 * ordered after auth.spec gets `403 session_not_found` from `getUser()` and is
 * redirected to /login (S420 root cause of the nightly redirect storm + 50-min
 * truncation). A fresh `signInWithPassword` after the sign-out mints a NEW admin
 * session, so subsequent specs load a live session.
 */
export async function restoreAdminSession(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAndSave(
      page,
      'TEST_USER_1_EMAIL',
      'TEST_USER_1_PASSWORD',
      'test.user1@test-kb-aish.co.uk',
      'Welcome12391.',
      'e2e/.auth/admin.json',
    );
  } finally {
    await context.close();
  }
}
