/**
 * Auth session helper for real-DB integration tests.
 *
 * Signs in as one of the seeded E2E test users (admin / editor / viewer)
 * and populates a caller-owned cookie store with the real session
 * cookies in the exact shape `@supabase/ssr` expects. The integration
 * test's `next/headers` mock reads from the same cookie store, so the
 * production `createClient` → `getAuthenticatedClient` path runs fully
 * against the real DB — no mocked auth helpers, no stubbed supabase
 * clients. This is the pattern `docs/specs/s156-auth-admin-resolution-spec.md`
 * §WP-1 describes as `withAuthorisedAdmin`, factored out here so both
 * WP-2 display-name route tests and the WP-1 admin route tests can
 * share the same machinery.
 *
 * Why mock `next/headers` but NOT `@/lib/auth`:
 *   The whole point of an integration test in this family is to
 *   exercise the real `getAuthenticatedClient` / `getAuthorisedClient`
 *   code path — including the `auth.getUser()` call and the
 *   `user_roles` DB lookup — against the real database. Mocking
 *   `@/lib/auth` defeats that entirely. `next/headers` is a pure I/O
 *   boundary with no business logic; replacing it with an in-memory
 *   cookie store does not change any of the auth logic being verified.
 *
 * Prerequisites:
 *   - `bun run seed:e2e-users` has been run against the target DB so
 *     `test.user{1,2,3}@test-kb-aish.co.uk` exist with the expected
 *     passwords in `.env`.
 *   - `.env` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
 *     `TEST_USER_{1,2,3}_PASSWORD`.
 *   - The test file loads `./service-client` first (for dotenv).
 *
 * Usage pattern (copy into any integration test file):
 *
 * ```typescript
 * import { vi } from 'vitest';
 * import { signInAsTestUser, signOutTestUser, type AuthCookieStore }
 *   from './helpers/auth-session';
 *
 * const { authCookies } = vi.hoisted(() => ({
 *   authCookies: new Map() as AuthCookieStore,
 * }));
 *
 * vi.mock('next/headers', () => ({
 *   cookies: async () => ({
 *     getAll: () => Array.from(authCookies.values()),
 *     get: (name: string) => authCookies.get(name),
 *     set: (name: string, value: string) => {
 *       authCookies.set(name, { name, value });
 *     },
 *   }),
 * }));
 *
 * beforeEach(async () => {
 *   authCookies.clear();
 *   await signInAsTestUser(authCookies, 'admin');
 * });
 *
 * afterEach(async () => {
 *   await signOutTestUser(authCookies);
 * });
 * ```
 */

import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/supabase/types/database.types';

export interface AuthCookieEntry {
  name: string;
  value: string;
}

/** Cookie store contract — a Map keyed by cookie name. */
export type AuthCookieStore = Map<string, AuthCookieEntry>;

export type TestUserRole = 'admin' | 'editor' | 'viewer';

interface TestUserCredentials {
  email: string;
  passwordEnv: string;
}

const TEST_USER_CREDENTIALS: Record<TestUserRole, TestUserCredentials> = {
  admin: {
    email: 'test.user1@test-kb-aish.co.uk',
    passwordEnv: 'TEST_USER_1_PASSWORD',
  },
  editor: {
    email: 'test.user2@test-kb-aish.co.uk',
    passwordEnv: 'TEST_USER_2_PASSWORD',
  },
  viewer: {
    email: 'test.user3@test-kb-aish.co.uk',
    passwordEnv: 'TEST_USER_3_PASSWORD',
  },
};

/**
 * Sign in as the seeded test user for the given role and populate
 * `authCookies` with the real Supabase session cookies. After this
 * resolves, any code path that reads cookies via the test file's
 * mocked `next/headers` → `createClient()` will see a valid session.
 *
 * Throws if the sign-in fails — callers should NOT swallow that error.
 * A failed sign-in usually means the test user was not seeded or the
 * password in `.env` is stale; both are operator errors, not test
 * failures.
 */
export async function signInAsTestUser(
  authCookies: AuthCookieStore,
  role: TestUserRole,
): Promise<void> {
  const { email, passwordEnv } = TEST_USER_CREDENTIALS[role];
  const password = process.env[passwordEnv];
  if (!password) {
    throw new Error(
      `${passwordEnv} env var is required for integration tests. ` +
        `Run \`bun run seed:e2e-users\` and ensure the passwords are in .env.`,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'signInAsTestUser: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.',
    );
  }

  // Use @supabase/ssr with an in-memory cookie adapter so the cookies
  // emitted by signInWithPassword land in the caller-owned Map. Any
  // subsequent createServerClient call with the same adapter (which is
  // exactly what production `lib/supabase/server.ts` does via the
  // test's mocked next/headers) will pick up the session.
  const ssrClient = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return Array.from(authCookies.values()).map(({ name, value }) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          authCookies.set(name, { name, value });
        }
      },
    },
  });

  const { error } = await ssrClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw new Error(
      `signInAsTestUser(${role}) failed: ${error.message}. ` +
        `Verify ${email} exists in the target DB and that ${passwordEnv} ` +
        `in .env matches the seeded password.`,
    );
  }
}

/**
 * Clear the auth cookie store. Equivalent to a local sign-out — does
 * not call the Supabase sign-out endpoint (no need, since the session
 * only lives in the caller's cookie store). Safe to call even when
 * `authCookies` is already empty.
 */
export async function signOutTestUser(
  authCookies: AuthCookieStore,
): Promise<void> {
  authCookies.clear();
}

// ---------------------------------------------------------------------------
// Cached-sessions pattern — sign in once per role per file, restore on
// each test, to stay under the Supabase sign-in rate limit.
// ---------------------------------------------------------------------------

/**
 * Cache of pre-signed-in sessions for all three test-user roles.
 *
 * Supabase rate-limits `signInWithPassword` to roughly 30 requests per
 * 5 minutes per IP. A test file that calls `signInAsTestUser` in
 * `beforeEach` will hit the limit once the integration suite grows
 * past a handful of tests — the hard cap was reached during WP-1's
 * initial run (13 tests × signInWithPassword = 429 "Request rate
 * limit reached" halfway through the file, even though each test
 * passed in isolation).
 *
 * The pattern that works: cache one session per role in `beforeAll`
 * and restore the desired role's cookies into the active store
 * before each test. Sign-in count per file drops to ≤3 regardless of
 * the number of tests, so the combined integration suite stays well
 * under the rate limit.
 *
 * Usage:
 *
 * ```typescript
 * const { authCookies, cachedSessions } = vi.hoisted(() => ({
 *   authCookies: new Map() as AuthCookieStore,
 *   cachedSessions: createEmptySessionCache(),
 * }));
 *
 * vi.mock('next/headers', () => ({ ... reads authCookies ... }));
 *
 * beforeAll(async () => {
 *   await cacheAllTestUserSessions(cachedSessions);
 * });
 *
 * beforeEach(() => {
 *   restoreSession(authCookies, cachedSessions, 'admin');
 * });
 *
 * // In a test that needs a different role:
 * it('returns 403 for viewer', async () => {
 *   restoreSession(authCookies, cachedSessions, 'viewer');
 *   // ...
 * });
 * ```
 */
export type CachedSessions = Record<TestUserRole, AuthCookieStore>;

/**
 * Create an empty cached-sessions object with one cookie store per
 * role. Call once per test file (typically via `vi.hoisted`) and
 * pass to `cacheAllTestUserSessions` in `beforeAll`.
 */
export function createEmptySessionCache(): CachedSessions {
  return {
    admin: new Map<string, AuthCookieEntry>(),
    editor: new Map<string, AuthCookieEntry>(),
    viewer: new Map<string, AuthCookieEntry>(),
  };
}

/**
 * Sign in as all three test users and populate the cached-sessions
 * object. Call exactly once per test file, in `beforeAll`.
 *
 * This issues EXACTLY 3 `signInWithPassword` calls regardless of how
 * many tests follow. The entire integration suite should stay well
 * under the rate limit as long as every test file uses this pattern.
 */
export async function cacheAllTestUserSessions(
  cache: CachedSessions,
): Promise<void> {
  const roles: TestUserRole[] = ['admin', 'editor', 'viewer'];
  for (const role of roles) {
    cache[role].clear();
    await signInAsTestUser(cache[role], role);
  }
}

/**
 * Restore the cached session for the given role into the active
 * cookie store. Call at the start of any test that needs a specific
 * role — `beforeEach` for the default, inside individual tests when
 * switching. Clears `authCookies` first so there is no leakage
 * between roles.
 */
export function restoreSession(
  authCookies: AuthCookieStore,
  cache: CachedSessions,
  role: TestUserRole,
): void {
  authCookies.clear();
  for (const [name, entry] of cache[role]) {
    authCookies.set(name, entry);
  }
}
