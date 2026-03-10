import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const authFile = 'e2e/.auth/state.json';

setup('authenticate as admin', async ({ page }) => {
  // Sign in via Supabase API to get tokens
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars. ' +
        'Ensure .env and .env.local are present.'
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const email = process.env.TEST_USER_1_EMAIL || 'test.user1@test-kb-aish.co.uk';
  const password = process.env.TEST_USER_1_PASSWORD || 'Welcome12391.';

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Auth setup failed: ${error?.message ?? 'No session returned'}`);
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
  await page.waitForLoadState('networkidle');

  // Verify we are NOT on the login page (auth succeeded)
  await expect(page).not.toHaveURL(/\/login/);

  // Save the authenticated browser state (cookies + localStorage)
  await page.context().storageState({ path: authFile });
});
