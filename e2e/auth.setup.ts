import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Authenticate a test user via the Supabase API and save browser state.
 * Builds chunked auth cookies matching the @supabase/ssr format.
 */
async function loginAndSave(
  page: import('@playwright/test').Page,
  emailEnv: string,
  passwordEnv: string,
  defaultEmail: string,
  defaultPassword: string,
  savePath: string,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars. ' +
        'Ensure .env and .env.local are present.',
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const email = process.env[emailEnv] || defaultEmail;
  const password = process.env[passwordEnv] || defaultPassword;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Auth setup failed for ${email}: ${error?.message ?? 'No session returned'}`);
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

  await page.context().addCookies(cookies);

  // Navigate and verify auth works
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

  // Save the authenticated browser state
  await page.context().storageState({ path: savePath });
}

// --- Authenticate all 3 test users ---

setup('authenticate as admin', async ({ page }) => {
  await loginAndSave(
    page,
    'TEST_USER_1_EMAIL',
    'TEST_USER_1_PASSWORD',
    'test.user1@test-kb-aish.co.uk',
    'Welcome12391.',
    'e2e/.auth/admin.json',
  );
});

setup('authenticate as editor', async ({ page }) => {
  await loginAndSave(
    page,
    'TEST_USER_2_EMAIL',
    'TEST_USER_2_PASSWORD',
    'test.user2@test-kb-aish.co.uk',
    'Welcome12391.',
    'e2e/.auth/editor.json',
  );
});

setup('authenticate as viewer', async ({ page }) => {
  await loginAndSave(
    page,
    'TEST_USER_3_EMAIL',
    'TEST_USER_3_PASSWORD',
    'test.user3@test-kb-aish.co.uk',
    'Welcome12391.',
    'e2e/.auth/viewer.json',
  );
});
