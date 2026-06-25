import { test as setup } from '@playwright/test';
import { loginAndSave } from './fixtures/auth-session';

/**
 * Authenticate the three test users (admin / editor / viewer) via the Supabase
 * API and save their browser state. The cookie-minting logic lives in
 * `e2e/fixtures/auth-session.ts` (`loginAndSave`) so the destructive sign-out
 * test in auth.spec.ts can re-provision the shared admin session with a
 * byte-identical cookie format after it performs a global sign-out (S420).
 */

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
