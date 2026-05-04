/**
 * Global setup runs once before all test files.
 *
 * Responsibilities:
 * 1. Verify required environment variables are present.
 * 2. Verify test users exist with correct roles (Phase 4).
 *
 * Test data seeding is handled by the worker-scoped workerData fixture
 * in e2e/fixtures/test-data-fixture.ts.
 */
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from './fixtures/supabase';
import { TEST_USERS } from './fixtures/test-data';
const APP_ROUTE_PREFLIGHT_PATHS = [
  '/api/analytics/win-rate',
  '/api/certifications',
  '/api/admin/pipeline-runs/recent',
  '/api/coverage/guides',
] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Warm and verify App Router API routes before the browser suite starts.
 *
 * CI smoke uses a dev server. The failing staging run returned Next's HTML
 * 404 page for existing route handlers after cold client-side fetches were
 * aborted during early navigation. A direct unauthenticated request should
 * return 401/403/200/500 from the route handler, but never the framework-level
 * 404. Retrying here both warms the route and turns route-registration failures
 * into a clear setup error instead of a later UI timeout.
 */
async function verifyAppRouteRegistered(pathname: string): Promise<void> {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const url = new URL(pathname, baseUrl);
  let lastStatus: number | null = null;
  let lastContentType: string | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      lastStatus = response.status;
      lastContentType = response.headers.get('content-type');

      if (response.status !== 404) return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    await delay(250 * attempt);
  }

  throw new Error(
    `E2E setup: route preflight failed for ${pathname}. ` +
      `Last status=${lastStatus ?? 'none'}, content-type=${lastContentType ?? 'none'}, ` +
      `error=${lastError ?? 'none'}. Expected an App Router handler response, not Next's 404 page.`,
  );
}

async function globalSetup(): Promise<void> {
  // --- Step 1: Environment variables ---
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `E2E setup: missing required environment variables: ${missing.join(', ')}. ` +
        'Ensure .env.local is loaded or these are set in the environment.',
    );
  }

  // Warn about optional test user credentials
  const hasTestCreds =
    process.env.E2E_TEST_EMAIL || process.env.TEST_USER_1_EMAIL;
  if (!hasTestCreds) {
    console.warn(
      'E2E setup: no test user credentials found (E2E_TEST_EMAIL or TEST_USER_1_EMAIL). ' +
        'Auth fixtures will use hardcoded defaults which may not work.',
    );
  }

  console.log('E2E setup: environment validated.');

  await Promise.all(
    APP_ROUTE_PREFLIGHT_PATHS.map((pathname) =>
      verifyAppRouteRegistered(pathname),
    ),
  );
  console.log(
    `E2E setup: verified ${APP_ROUTE_PREFLIGHT_PATHS.length} App Router API routes are registered.`,
  );
  // --- Step 2: Verify test users exist with correct roles ---
  const supabase = createServiceClient();

  // Query user_roles to get all roles, then cross-reference with auth.users
  // via the admin API to verify emails match expected roles.
  const { data: allRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id, role');

  if (rolesError) {
    throw new Error(
      `E2E setup: failed to query user_roles: ${rolesError.message}. ` +
        'Ensure the SUPABASE_SERVICE_ROLE_KEY has service_role permissions.',
    );
  }

  if (!allRoles || allRoles.length === 0) {
    throw new Error(
      'E2E setup: user_roles table is empty. ' +
        'Test users must be created before running E2E tests. ' +
        'Run `bun run seed:e2e-users` to provision the three E2E test users ' +
        '(admin/editor/viewer) idempotently. See ' +
        'docs/operations/e2e-test-setup.md §11 for the rebuild flow.',
    );
  }

  // Resolve test users via signInWithPassword (anon key): each
  // successful sign-in returns the user's id, which we cross-reference
  // against `user_roles`. Exercising the real sign-in flow catches more
  // failure modes (password drift, banned_until set, missing identities
  // row) than enumerating users via auth.admin.listUsers would. S156
  // WP-7 removed the dead `E2E_SKIP_USER_VERIFY` bypass branch that
  // preceded this block — see docs/audits/s156-auth-admin-sweep.md
  // Finding 5.3.
  const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const anonClient = createClient(anonUrl, anonKey);

  const passwordEnvByLabel: Record<string, string> = {
    admin: 'TEST_USER_1_PASSWORD',
    editor: 'TEST_USER_2_PASSWORD',
    viewer: 'TEST_USER_3_PASSWORD',
  };

  const missingUsers: string[] = [];
  const wrongRoles: string[] = [];

  for (const [label, testUser] of Object.entries(TEST_USERS)) {
    const passwordEnv = passwordEnvByLabel[label];
    const password = passwordEnv ? process.env[passwordEnv] : undefined;
    if (!password) {
      missingUsers.push(`${label} (${testUser.email}) — missing password env`);
      continue;
    }
    const { data: signInData, error: signInError } =
      await anonClient.auth.signInWithPassword({
        email: testUser.email,
        password,
      });
    if (signInError || !signInData.user) {
      missingUsers.push(
        `${label} (${testUser.email}) — sign-in failed: ${signInError?.message ?? 'no user'}`,
      );
      continue;
    }
    const authUser = signInData.user;

    const userRole = allRoles.find((r) => r.user_id === authUser.id);

    if (!userRole) {
      wrongRoles.push(
        `${label} (${testUser.email}): no role assigned — expected '${testUser.expectedRole}'`,
      );
    } else if (userRole.role !== testUser.expectedRole) {
      wrongRoles.push(
        `${label} (${testUser.email}): role is '${userRole.role}' — expected '${testUser.expectedRole}'`,
      );
    }
  }

  if (missingUsers.length > 0) {
    throw new Error(
      `E2E setup: test users not found in auth.users:\n` +
        missingUsers.map((u) => `  - ${u}`).join('\n') +
        '\n\nRun `bun run seed:e2e-users` to provision them. ' +
        'See docs/operations/e2e-test-setup.md §11 for the rebuild flow.',
    );
  }

  if (wrongRoles.length > 0) {
    throw new Error(
      `E2E setup: test users have incorrect roles:\n` +
        wrongRoles.map((r) => `  - ${r}`).join('\n') +
        '\n\nFix roles in the user_roles table before running E2E tests.',
    );
  }

  console.log(
    `E2E setup: verified ${Object.keys(TEST_USERS).length} test users with correct roles.`,
  );
}

export default globalSetup;
