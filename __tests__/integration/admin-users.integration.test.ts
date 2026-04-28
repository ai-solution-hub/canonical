/**
 * Real-DB integration tests for the 4 admin user routes.
 *
 * **This is the test that would have caught S156.** The `admin.test.ts`
 * unit test passed for the duration of the production outage because
 * its mocks returned canned data instead of exercising the GoTrue scan
 * path that was actually broken. Sweep 4 Finding 4.1 flagged this
 * exact blind spot as HIGH. WP-1 closes it with real-DB coverage of:
 *
 *   - GET    /api/admin/users
 *   - POST   /api/admin/users/invite
 *   - PATCH  /api/admin/users/[userId]
 *   - DELETE /api/admin/users/[userId]
 *
 * The load-bearing scenario is the probe-row regression test: it
 * inserts a row into `auth.users` with the SAME bad shape that broke
 * S156 (NULL token columns) via the `_test_insert_broken_auth_user`
 * SECURITY DEFINER helper shipped in the WP-2 migration
 * (`20260408223728_create_get_user_display_names.sql`), then calls
 * `listUsersGET()`.
 *
 * **Evolution across S156 → S157:**
 *
 * S156 (2026-04-08): the original spec assumed that after the
 * corrective migration landed, GoTrue would tolerate NULL token
 * columns. That assumption was WRONG. The probe-row test proved that
 * GoTrue 500s on ANY `auth.users` row with NULL token columns, not
 * just the one pipeline row that had been patched. For S156 the
 * witness test asserted HTTP 500 — it was documenting an unresolved
 * upstream bug, not verifying a fix.
 *
 * S157 WP3 (2026-04-09): landed
 * `supabase/migrations/20260409110643_auth_users_token_column_null_guard.sql`
 * — a `BEFORE INSERT OR UPDATE` trigger on `auth.users` that coerces
 * NULL → `''` on the 8 GoTrue-scanned token columns. This means:
 *   - `_test_insert_broken_auth_user` can no longer produce a broken
 *     shape via the normal INSERT path. The trigger fires before the
 *     row is written and replaces NULLs with empty strings.
 *   - The probe-row test now asserts HTTP 200 — it is the positive
 *     witness that the trigger is fully effective at the runtime
 *     layer.
 *   - The vitest migration guard (`auth-users-insert-guard.test.ts`)
 *     remains in place as a defence-in-depth layer catching migrations
 *     that try to INSERT with the bad shape. Its scope is different
 *     from the trigger's (static vs runtime).
 *   - Residual gap: the trigger is in default ENABLE ORIGIN mode
 *     because `ALTER TABLE auth.users ENABLE ALWAYS TRIGGER` requires
 *     `supabase_auth_admin` ownership which the managed-platform
 *     `postgres` role does not have. This means the trigger is bypassed
 *     during `pg_restore` (replica mode). For ordinary runtime writes
 *     it is fully effective.
 *   - If this test ever starts returning 500 again, either the trigger
 *     has been dropped, `_test_insert_broken_auth_user` has been
 *     rewritten to bypass the trigger, or GoTrue has changed its
 *     failure mode. Investigate before relaxing any assertion.
 *
 * Prereqs:
 *   - `.env` with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY, TEST_USER_{1,2,3}_PASSWORD
 *   - `bun run seed:e2e-users` has been run against the target DB
 *   - The WP-2 migration has been applied (`20260408223728_create_get_user_display_names`)
 *
 * Run: `bun run test:integration __tests__/integration/admin-users`
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars
import { serviceClient } from './helpers/service-client';
import {
  cacheAllTestUserSessions,
  restoreSession,
  getTestUserId,
  type AuthCookieStore,
  type AuthCookieEntry,
  type CachedSessions,
} from './helpers/auth-session';

// ---------------------------------------------------------------------------
// Mock `next/headers` at file scope so the hoisted cookieStore is shared
// with the production `createClient()` code path. Per-role sessions are
// cached in `cachedSessions` at `beforeAll` time (3 sign-ins total per
// file) and restored into `authCookies` at the start of each test to
// stay under the Supabase sign-in rate limit.
// ---------------------------------------------------------------------------

const { authCookies, cachedSessions } = vi.hoisted(() => ({
  authCookies: new Map<
    string,
    { name: string; value: string }
  >() as AuthCookieStore,
  cachedSessions: {
    admin: new Map(),
    editor: new Map(),
    viewer: new Map(),
  } as unknown as CachedSessions,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      Array.from(authCookies.values()).map(
        ({ name, value }): AuthCookieEntry => ({ name, value }),
      ),
    get: (name: string) => authCookies.get(name),
    set: (name: string, value: string) => {
      authCookies.set(name, { name, value });
    },
  }),
}));

// ---------------------------------------------------------------------------
// Import routes AFTER the mock is registered.
// ---------------------------------------------------------------------------

const { GET: listUsersGET } = await import('@/app/api/admin/users/route');
const { POST: inviteRoute } =
  await import('@/app/api/admin/users/invite/route');
const { PATCH: patchUserRoute, DELETE: deleteUserRoute } =
  await import('@/app/api/admin/users/[userId]/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Well-known UUIDs + constants
// ---------------------------------------------------------------------------

const PIPELINE_UUID = 'a0000000-0000-4000-8000-000000000001';
// Resolved at beforeAll from email via auth admin API (S186 WP-C — no
// more hardcoded OLD-project UUIDs).
let TEST_USER_1_ID: string = '';

/** Fixed probe UUID in the `_test_insert_broken_auth_user`-allowed range. */
const PROBE_USER_ID = '00000000-0000-4000-8000-000000000999';
const PROBE_EMAIL = 's156-probe@test.local';

/**
 * Tracks throwaway users created during tests for guaranteed cleanup
 * even if a test aborts mid-execution.
 */
const createdThrowawayUserIds = new Set<string>();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Resolve admin UUID by email so the tests keep working on any DB
  // where test users are seeded (S186 WP-C).
  TEST_USER_1_ID = await getTestUserId('admin');
  // Sign in as all 3 roles ONCE and cache each cookie set. Each test
  // then `restoreSession`s into `authCookies` — no per-test sign-ins,
  // so Supabase's ~30-per-5-minutes rate limit is never approached.
  await cacheAllTestUserSessions(cachedSessions);
});

beforeEach(() => {
  // Default role for this file is admin (all these routes require it).
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterEach(async () => {
  // Always attempt to tear down the probe row — the
  // _test_delete_broken_auth_user helper is idempotent and safe to call
  // even when no probe row is present. Supabase JS v2's rpc() returns
  // a PostgrestFilterBuilder thenable without a `.catch` method, so we
  // await + destructure the { error } and ignore it (best-effort).
  const { error: cleanupErr } = await serviceClient.rpc(
    '_test_delete_broken_auth_user',
    { probe_id: PROBE_USER_ID },
  );
  if (cleanupErr) {
    // The helper only raises on outside-range IDs (which we never
    // pass), so an error here is unexpected — surface it via console
    // so the test runner operator can investigate, but do NOT fail
    // the test.
    console.warn(
      '[admin-users.integration] probe-row cleanup failed:',
      cleanupErr.message,
    );
  }
  // Do NOT clear authCookies here — the next test's `beforeEach` will
  // restore the admin session. Clearing here would trigger a role
  // mismatch with the cached sessions.
});

afterAll(async () => {
  // Final cleanup sweep: delete any throwaway users that individual
  // tests tracked but didn't manage to clean up (e.g. because the test
  // failed before the teardown hook fired).
  for (const userId of createdThrowawayUserIds) {
    await serviceClient.auth.admin.deleteUser(userId).catch(() => {
      /* best-effort */
    });
  }
  createdThrowawayUserIds.clear();
});

// ---------------------------------------------------------------------------
// Helpers for throwaway user lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a throwaway user with a unique email via `auth.admin.createUser`
 * (email_confirm: true skips the email flow). Tracks the resulting ID
 * for afterAll cleanup.
 */
async function createThrowawayUser(): Promise<{ id: string; email: string }> {
  const email = `s156-wp1-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@test.local`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password: `Throwaway-${Date.now()}-${Math.random().toString(36).slice(2)}!`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `createThrowawayUser failed: ${error?.message ?? 'no user returned'}`,
    );
  }
  createdThrowawayUserIds.add(data.user.id);
  return { id: data.user.id, email };
}

async function deleteThrowawayUser(id: string): Promise<void> {
  await serviceClient.auth.admin.deleteUser(id).catch(() => {
    /* best-effort — tracked in createdThrowawayUserIds for afterAll */
  });
  createdThrowawayUserIds.delete(id);
}

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

describe('GET /api/admin/users — real DB', () => {
  it('returns 200 and a populated user list without the pipeline service account', async () => {
    const res = await listUsersGET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{
      id: string;
      email: string;
      display_name: string | null;
      role: string;
      created_at: string;
      last_sign_in_at: string | null;
    }>;

    expect(Array.isArray(body)).toBe(true);
    // At least TEST_USER_1/2/3 must be present. If the seed has been
    // run we expect 3+ users; on a completely fresh DB without seed
    // the test will fail — that is the correct behaviour (the seed
    // is a pre-req stated in the file header).
    expect(body.length).toBeGreaterThanOrEqual(3);

    // Every row must have the load-bearing fields populated — if the
    // GoTrue scan path failed, these would be missing.
    for (const user of body) {
      expect(user.id).toBeDefined();
      expect(user.id.length).toBeGreaterThan(0);
      expect(user.role).toBeDefined();
      // CRITICAL: pipeline service account MUST NOT appear in the
      // response (the cosmetic filter from WP-6 enforces this, and the
      // Team Members UI depends on it).
      expect(user.id).not.toBe(PIPELINE_UUID);
    }

    // TEST_USER_1 (the signed-in admin) should appear in the list.
    expect(body.find((u) => u.id === TEST_USER_1_ID)).toBeDefined();
  });

  it('returns 200 after inserting a probe row with NULL token columns (S157 WP3 trigger witness)', async () => {
    // S156 origin: this test used to assert HTTP 500 as a witness of
    // the unresolved upstream GoTrue bug (NULL token columns cause
    // `auth.admin.listUsers` to 500 on scan). After S157 WP3 landed
    // the `public.coerce_null_token_columns()` trigger on auth.users,
    // the raw-SQL insert path goes through a BEFORE INSERT hook that
    // coerces NULL → '' on the 8 token columns BEFORE the row is
    // written. The "broken shape" therefore cannot land in the table,
    // and `listUsers` succeeds with HTTP 200.
    //
    // This is now a POSITIVE witness test: it proves the trigger is
    // fully effective at the runtime layer. If it ever flips back to
    // 500, either the trigger has been dropped
    // (supabase/migrations/20260409110643_auth_users_token_column_null_guard.sql),
    // or _test_insert_broken_auth_user has been rewritten to bypass
    // the trigger (e.g. via SET session_replication_role = 'replica'),
    // or GoTrue's failure mode has changed. Investigate before
    // weakening this assertion.
    const { error: insertErr } = await serviceClient.rpc(
      '_test_insert_broken_auth_user',
      { probe_id: PROBE_USER_ID, probe_email: PROBE_EMAIL },
    );
    expect(
      insertErr,
      'failed to insert probe row via _test_insert_broken_auth_user',
    ).toBeNull();

    const res = await listUsersGET();
    expect(
      res.status,
      'S157 WP3 trigger witness: listUsers must return 200 after inserting a probe row with NULL token columns — the trigger coerces them to empty string before the row is written',
    ).toBe(200);

    const body = (await res.json()) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
    // The probe row itself will NOT appear in the response because
    // `app/api/admin/users/route.ts:58-61` filters out any row whose
    // id is in the pipeline-system UUID range — and our probe UUID
    // (`00000000-0000-4000-8000-...`) is in that range. That filter
    // is cosmetic (the comment at route.ts:58-61 says so explicitly)
    // and the filter wasn't touched by WP3. What matters is that the
    // rest of the list loads without poisoning.
    expect(
      body.find((u) => u.id === TEST_USER_1_ID),
      'signed-in admin should still appear in the listUsers result',
    ).toBeDefined();
  });

  it('returns 200 after probe-row cleanup (regression-guard for cleanup path)', async () => {
    // Pre-S157 WP3 this test was the "recovery witness": insert →
    // confirm 500 → delete → confirm 200. With the trigger in place
    // the broken shape can never land, so the insert path already
    // produces a healthy row. This test now exists purely as a
    // regression guard for the `afterEach` cleanup helper: if the
    // cleanup ever fails silently, subsequent tests would accumulate
    // probe rows in auth.users and that accumulation could still be
    // problematic (e.g. it would break the PIPELINE_SYSTEM_USER_ID
    // uniqueness invariant the cosmetic filter at route.ts:58-61
    // depends on).
    const { error: insertErr } = await serviceClient.rpc(
      '_test_insert_broken_auth_user',
      { probe_id: PROBE_USER_ID, probe_email: PROBE_EMAIL },
    );
    expect(insertErr).toBeNull();

    // Both before AND after delete, the route returns 200 because
    // the trigger coerced the insert to a healthy shape.
    const afterInsertRes = await listUsersGET();
    expect(afterInsertRes.status).toBe(200);

    const { error: deleteErr } = await serviceClient.rpc(
      '_test_delete_broken_auth_user',
      { probe_id: PROBE_USER_ID },
    );
    expect(deleteErr).toBeNull();

    const afterDeleteRes = await listUsersGET();
    expect(afterDeleteRes.status).toBe(200);
  });

  it('returns 401 when the caller has no session', async () => {
    authCookies.clear();
    const res = await listUsersGET();
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is authenticated but not admin', async () => {
    // Switch from admin to viewer.
    restoreSession(authCookies, cachedSessions, 'viewer');

    const res = await listUsersGET();
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/invite
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/invite — real DB', () => {
  it('returns 401 when the caller has no session', async () => {
    authCookies.clear();
    const req = new NextRequest('http://localhost/api/admin/users/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: 's156-invite-401@test.local',
        role: 'viewer',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await inviteRoute(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not admin', async () => {
    restoreSession(authCookies, cachedSessions, 'editor');

    const req = new NextRequest('http://localhost/api/admin/users/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: 's156-invite-403@test.local',
        role: 'viewer',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await inviteRoute(req);
    expect(res.status).toBe(403);
  });

  // NOTE: the happy-path invite test is intentionally NOT included here.
  // `auth.admin.inviteUserByEmail` sends a real email and is rate-
  // limited by Supabase (~30/hour per IP). A test that fires every run
  // risks (a) rate-limit 429s in CI and (b) leaking invite emails to
  // real inboxes. The invite route's logic is exercised at the unit
  // test tier in `__tests__/api/admin.test.ts` with appropriate mocks.
  // The load-bearing S156 concern — `listUsers` tolerating bad-shape
  // rows — is covered above and does not require exercising the
  // invite code path.
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/[userId]
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/[userId] — real DB', () => {
  it('round-trips a role change on a throwaway user', async () => {
    const throwaway = await createThrowawayUser();
    try {
      const req = new NextRequest(
        `http://localhost/api/admin/users/${throwaway.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: 'editor' }),
          headers: { 'content-type': 'application/json' },
        },
      );
      const res = await patchUserRoute(req, {
        params: Promise.resolve({ userId: throwaway.id }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { id: string; role: string };
      expect(body.id).toBe(throwaway.id);
      expect(body.role).toBe('editor');

      // Verify the DB actually reflects the change.
      const { data: roleRow, error } = await serviceClient
        .from('user_roles')
        .select('role')
        .eq('user_id', throwaway.id)
        .single();
      expect(error).toBeNull();
      expect(roleRow?.role).toBe('editor');
    } finally {
      await deleteThrowawayUser(throwaway.id);
    }
  });

  it('returns 400 for an invalid UUID', async () => {
    const req = new NextRequest('http://localhost/api/admin/users/not-a-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'editor' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await patchUserRoute(req, {
      params: Promise.resolve({ userId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when the caller is not admin', async () => {
    restoreSession(authCookies, cachedSessions, 'editor');

    const throwaway = await createThrowawayUser();
    try {
      const req = new NextRequest(
        `http://localhost/api/admin/users/${throwaway.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: 'admin' }),
          headers: { 'content-type': 'application/json' },
        },
      );
      const res = await patchUserRoute(req, {
        params: Promise.resolve({ userId: throwaway.id }),
      });
      expect(res.status).toBe(403);
    } finally {
      await deleteThrowawayUser(throwaway.id);
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/[userId]
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/[userId] — real DB', () => {
  it('deactivates a throwaway user by setting banned_until', async () => {
    const throwaway = await createThrowawayUser();
    try {
      const req = new NextRequest(
        `http://localhost/api/admin/users/${throwaway.id}`,
        { method: 'DELETE' },
      );
      const res = await deleteUserRoute(req, {
        params: Promise.resolve({ userId: throwaway.id }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify the user is banned via the GoTrue admin API — this is
      // the OTHER major GoTrue admin call path, so exercising it
      // here proves the corrective migration didn't break this API
      // surface either.
      const { data, error } = await serviceClient.auth.admin.getUserById(
        throwaway.id,
      );
      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      // Supabase's deactivate sets banned_until to a far-future date
      // (876000h ≈ 100 years). A non-null value is sufficient proof.
      // The returned type includes banned_until on user_metadata in
      // some versions — accept either.
      const banned =
        (data.user as { banned_until?: string | null })?.banned_until ?? null;
      expect(banned, 'banned_until should be set after deactivate').not.toBe(
        null,
      );
    } finally {
      await deleteThrowawayUser(throwaway.id);
    }
  });

  it('refuses to self-deactivate', async () => {
    // The signed-in admin is TEST_USER_1. Attempting to DELETE their
    // own ID should fail with 400, regardless of permissions.
    const req = new NextRequest(
      `http://localhost/api/admin/users/${TEST_USER_1_ID}`,
      { method: 'DELETE' },
    );
    const res = await deleteUserRoute(req, {
      params: Promise.resolve({ userId: TEST_USER_1_ID }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cannot deactivate your own account/i);
  });

  it('returns 401 when the caller has no session', async () => {
    authCookies.clear();
    const throwaway = await createThrowawayUser();
    try {
      const req = new NextRequest(
        `http://localhost/api/admin/users/${throwaway.id}`,
        { method: 'DELETE' },
      );
      const res = await deleteUserRoute(req, {
        params: Promise.resolve({ userId: throwaway.id }),
      });
      expect(res.status).toBe(401);
    } finally {
      await deleteThrowawayUser(throwaway.id);
    }
  });
});
