import { test as base, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

/**
 * Test user credentials.
 * Uses TEST_USER_1 from .env by default (admin role).
 * Override with E2E_TEST_EMAIL / E2E_TEST_PASSWORD if needed.
 */
const TEST_USER_EMAIL = process.env.E2E_TEST_EMAIL || process.env.TEST_USER_1_EMAIL || 'test.user1@test-kb-aish.co.uk';
const TEST_USER_PASSWORD = process.env.E2E_TEST_PASSWORD || process.env.TEST_USER_1_PASSWORD || 'Welcome12391.';

const AUTH_CACHE_PATH = path.resolve(__dirname, '../.auth/cookies.json');

type AuthFixtures = {
  /** A page with an authenticated Supabase session already established. */
  authenticatedPage: Page;
};

/**
 * Get Supabase session cookies, using a file cache to avoid repeated
 * auth calls that hit rate limits. The cache file is created on first
 * call and reused by all parallel workers.
 */
async function getAuthCookies(): Promise<Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
}>> {
  // Return cached cookies if they exist and are recent (< 30 min)
  if (fs.existsSync(AUTH_CACHE_PATH)) {
    const stat = fs.statSync(AUTH_CACHE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30 * 60 * 1000) {
      return JSON.parse(fs.readFileSync(AUTH_CACHE_PATH, 'utf-8'));
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.'
    );
  }

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

  // Build the session cookie value matching @supabase/ssr format
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

  // @supabase/ssr chunks cookies at ~3180 chars
  const CHUNK_SIZE = 3180;
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

  // Cache to file for other workers
  fs.mkdirSync(path.dirname(AUTH_CACHE_PATH), { recursive: true });
  fs.writeFileSync(AUTH_CACHE_PATH, JSON.stringify(cookies));

  return cookies;
}

/**
 * Extended test fixture that provides an authenticated page.
 *
 * Authentication is performed via the Supabase Auth API (not the UI),
 * then the session tokens are injected as cookies. A file cache prevents
 * repeated auth calls from hitting Supabase rate limits.
 */
export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page, context }, use) => { // eslint-disable-line react-hooks/rules-of-hooks
    const cookies = await getAuthCookies();
    await context.addCookies(cookies);

    // Navigate to the app — proxy should now see the session cookies
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await use(page); // eslint-disable-line react-hooks/rules-of-hooks
  },
});

export { expect } from '@playwright/test';
