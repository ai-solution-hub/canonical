import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/supabase/schema';

/**
 * Shared E2E auth-session helper.
 *
 * `loginAndSave` is the single source of truth for minting a Supabase session
 * and persisting it as a Playwright storageState file (chunked `@supabase/ssr`
 * cookies). Used by `e2e/auth.setup.ts` — the setup project that authenticates
 * admin / editor / viewer + the dedicated sign-out user (TEST_USER_4) once
 * before the suite. One implementation keeps every saved storageState's cookie
 * format identical, so the middleware accepts them all identically.
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

  // D4 (S424, test-philosophy §2.1 false-pass): in CI, REQUIRE the TEST_USER_*
  // secrets — never silently fall back to the committed default creds. The
  // fallback would mask a missing/rotated secret as a GREEN run (the setup
  // would authenticate with stale committed creds instead of failing loudly),
  // exactly the conditional-false-pass the investigation flagged. Local keeps
  // the convenience defaults so `bun run test:e2e` works without an 8-var
  // .env.local.
  const inCI = !!process.env.CI;
  const email = process.env[emailEnv] || (inCI ? '' : defaultEmail);
  const password = process.env[passwordEnv] || (inCI ? '' : defaultPassword);
  if (!email || !password) {
    throw new Error(
      `Auth setup misconfigured: missing ${emailEnv} / ${passwordEnv} in CI. ` +
        `Refusing to fall back to committed default credentials (that would ` +
        `mask a missing/rotated secret as a green run). Set the TEST_USER_* ` +
        `vars/secrets in the Staging GitHub environment.`,
    );
  }

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
