/**
 * Real-DB integration tests for the two display-name routes refactored
 * by S156 WP-2:
 *
 *   - POST /api/users/display-names
 *   - GET  /api/content-owners/stats
 *
 * These tests hit the live Supabase database end-to-end, signing in
 * with a real session (via `signInAsTestUser`) and letting the
 * production `getAuthenticatedClient` → `createClient` → cookie
 * validation → `user_roles` lookup run exactly as it does in prod.
 *
 * The point of this file is to close Sweep 4 Finding 4.3 from
 * `docs/audits/s156-auth-admin-sweep.md` — "No real-DB coverage for
 * app/api/users/display-names/route.ts or app/api/content-owners/stats
 * /route.ts" — AND to defend against the exact failure mode that
 * caused S156: a route whose happy-path tests passed while prod was
 * silently degrading because the test mocked the code path that broke.
 *
 * If this file ever reintroduces `vi.mock('@/lib/auth')` or
 * `vi.mock('@/lib/users/display-names')`, it stops doing its job.
 *
 * Prereqs:
 *   - `.env` with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY, TEST_USER_{1,2,3}_PASSWORD
 *   - `bun run seed:e2e-users` has been run against the target DB
 *   - The WP-2 migration `20260408223728_create_get_user_display_names.sql`
 *     has been applied
 *
 * Run: `bun run test:integration __tests__/integration/display-name-routes`
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars
import './helpers/service-client';
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
// with the production `createClient()` code path. Per-role sessions
// are cached in `cachedSessions` at `beforeAll` time (3 sign-ins total
// per file) and restored into `authCookies` at the start of each test
// to stay under the Supabase sign-in rate limit. See
// `helpers/auth-session.ts` for the full pattern explanation.
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
// Import routes AFTER the mock is registered so they pick up the
// mocked next/headers via their transitive `@/lib/supabase/server` →
// `createClient` dependency.
// ---------------------------------------------------------------------------

const { POST: displayNamesPost } =
  await import('@/app/api/users/display-names/route');
const { GET: contentOwnerStatsGet } =
  await import('@/app/api/content-owners/stats/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Well-known UUIDs
// ---------------------------------------------------------------------------

const PIPELINE_UUID = 'a0000000-0000-4000-8000-000000000001';
// Resolved at beforeAll from email via auth admin API (S186 WP-C — no
// more hardcoded OLD-project UUIDs).
let TEST_USER_1: string = '';
/** UUID guaranteed not to exist in auth.users (test range). */
const UNKNOWN_UUID = '00000000-4000-4000-8000-000000000999';

// ---------------------------------------------------------------------------
// Auth lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Resolve admin UUID by email so the tests keep working on any DB
  // where test users are seeded (S186 WP-C).
  TEST_USER_1 = await getTestUserId('admin');
  // Sign in as all 3 roles ONCE per file. All individual tests
  // restore from the cache rather than signing in afresh.
  await cacheAllTestUserSessions(cachedSessions);
});

beforeEach(() => {
  // Default role for this file is admin — both routes accept any
  // authenticated role, but admin keeps the tests deterministic and
  // matches the WP-1 admin-users integration test pattern.
  restoreSession(authCookies, cachedSessions, 'admin');
});

// ---------------------------------------------------------------------------
// POST /api/users/display-names — real DB
// ---------------------------------------------------------------------------

describe('POST /api/users/display-names — real DB', () => {
  function buildRequest(ids: string[]): NextRequest {
    return new NextRequest('http://localhost/api/users/display-names', {
      method: 'POST',
      body: JSON.stringify({ ids }),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('returns 200 and labels the pipeline service account "Pipeline (system)"', async () => {
    const res = await displayNamesPost(buildRequest([PIPELINE_UUID]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body[PIPELINE_UUID]).toBe('Pipeline (system)');
  });

  it('returns 200 and resolves TEST_USER_1 to a real (non-fallback) name', async () => {
    const res = await displayNamesPost(buildRequest([TEST_USER_1]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body[TEST_USER_1]).toBeDefined();
    expect(body[TEST_USER_1]).not.toBe('A team member');
    expect(body[TEST_USER_1].length).toBeGreaterThan(0);
  });

  it('returns "A team member" for an unknown UUID (C-1 load-bearing behaviour)', async () => {
    const res = await displayNamesPost(buildRequest([UNKNOWN_UUID]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    // The SQL function projects req.id from the driving unnest table —
    // if this assertion fails, the C-1 bug (unknown UUIDs dropped via
    // LEFT JOIN NULL) has been reintroduced.
    expect(body[UNKNOWN_UUID]).toBe('A team member');
  });

  it('handles a mixed batch in a single request', async () => {
    const res = await displayNamesPost(
      buildRequest([PIPELINE_UUID, TEST_USER_1, UNKNOWN_UUID]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body[PIPELINE_UUID]).toBe('Pipeline (system)');
    expect(body[TEST_USER_1]).not.toBe('A team member');
    expect(body[UNKNOWN_UUID]).toBe('A team member');
    // All 3 keys must be present — no silent drops.
    expect(Object.keys(body)).toHaveLength(3);
  });

  it('returns 401 when no valid session is in the cookie store', async () => {
    // Tear down the session cookies before the call — the route will
    // see no authentication and must return 401 via the real
    // getAuthenticatedClient / authFailureResponse path.
    authCookies.clear();

    const res = await displayNamesPost(buildRequest([TEST_USER_1]));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/content-owners/stats — real DB
// ---------------------------------------------------------------------------

describe('GET /api/content-owners/stats — real DB', () => {
  it('returns 200 with a JSON array', async () => {
    const res = await contentOwnerStatsGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      owner_id: string;
      display_name: string | null;
      total_items: number;
    }>;
    expect(Array.isArray(body)).toBe(true);
  });

  it('enriches every returned row with a non-empty display_name (no silent nulls)', async () => {
    // This is the load-bearing behavioural assertion from S156 WP-2:
    // before the refactor, pipeline-owned rows silently came back with
    // display_name === null because `auth.admin.getUserById` on the
    // broken-shape row was swallowed by Promise.allSettled. After the
    // refactor, every row must have a non-null display_name — real
    // name for humans, 'Pipeline (system)' for the service account,
    // or 'A team member' for unknowns.
    const res = await contentOwnerStatsGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      owner_id: string;
      display_name: string | null;
    }>;

    if (body.length === 0) {
      // No owner stats in the target DB — test passes trivially. This
      // is expected on a fresh rebuild and should not block the
      // regression guard for populated DBs.
      return;
    }

    for (const row of body) {
      expect(
        row.display_name,
        `owner_id=${row.owner_id} has a null display_name — S156 WP-2 regression`,
      ).not.toBeNull();
      expect(row.display_name).not.toBe('');
    }
  });

  it('labels the pipeline service account when it appears in owner stats', async () => {
    const res = await contentOwnerStatsGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      owner_id: string;
      display_name: string | null;
    }>;
    const pipelineRow = body.find((r) => r.owner_id === PIPELINE_UUID);
    if (!pipelineRow) {
      // Target DB has no pipeline-owned content in content_owner_stats —
      // not a failure, just means the assertion is unreachable here.
      // The dedicated integration test in
      // `get-user-display-names.integration.test.ts` covers the pipeline
      // label assertion against the SQL function directly.
      return;
    }
    expect(pipelineRow.display_name).toBe('Pipeline (system)');
  });

  it('returns 401 when no valid session is in the cookie store', async () => {
    authCookies.clear();
    const res = await contentOwnerStatsGet();
    expect(res.status).toBe(401);
  });
});
