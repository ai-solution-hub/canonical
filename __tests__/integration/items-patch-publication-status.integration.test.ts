/**
 * §5.2 Phase 2 (T6) — items PATCH publication_status integration test.
 *
 * Wave-3 V1-M2: closes the regression-blind spot the verifier flagged on
 * the T6 PATCH route. Existing T6 unit tests are pure mock; the prod path
 * also exercises:
 *   - Pre-T6 content_history.change_type CHECK extension to include
 *     `'publication_state'` (commit eeb8ae25). Mock tests miss the
 *     CHECK rejection.
 *   - The §6.6 `enforce_archive_state_consistency` BEFORE-UPDATE trigger
 *     (Direction 1: archive stamp; Direction 2: archived_at clear on
 *     un-archive). Mock tests bypass the trigger entirely.
 *   - The auto_version_content_history BEFORE-INSERT trigger that bumps
 *     content_history.version per row.
 *   - publication_status CHECK rejecting unknown enum values at the DB.
 *
 * This test runs the production PATCH handler (`app/api/items/[id]/route.ts`)
 * against the live production DB with a real signed-in admin
 * session (cookie-store pattern, mirroring
 * `review-cadence-lifecycle.integration.test.ts`).
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §3.2 (transition
 *   matrix), §3.4 (role-gate matrix), §6.6 (bidirectional trigger), §8.3
 *   (handler sample).
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T6.
 *
 * Prereqs:
 *   - `.env` with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY, TEST_USER_1_PASSWORD.
 *   - §5.2 Phase 1 schema is live (publication_status NOT NULL DEFAULT
 *     'published'; CHECK over the 4-value enum; trigger
 *     `trg_enforce_archive_state_consistency`).
 *   - `bun run seed:e2e-users` has been run against the target DB.
 *
 * Runs via: `bun run test:integration -- items-patch-publication-status`
 *   (NOT picked up by `bun run test`; integration runner only — see CLAUDE.md
 *   feedback_test_runners_split.)
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
  afterAll,
} from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars.
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
// Mock next/headers at file scope so the hoisted cookieStore is shared with
// the production createClient() code path. Same pattern as
// review-cadence-lifecycle.integration.test.ts.
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

// Import handler AFTER the mock is registered.
const { PATCH: itemsPatch } = await import('@/app/api/items/[id]/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[PUB-PATCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededIds: string[] = [];
let TEST_USER_1_ID = '';

// Skip the suite if env vars aren't present — mirrors the skip pattern used
// elsewhere in the integration suite.
const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.TEST_USER_1_PASSWORD,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Direct service-role insert for a fresh content_items fixture. Bypasses the
 * PATCH route deliberately — we want a clean baseline at the requested
 * `publication_status` so the test can immediately exercise transitions out
 * of that state. `content_text_hash` is GENERATED ALWAYS so it MUST be
 * omitted (CLAUDE.md gotcha).
 *
 * NOTE: the schema enforces `publication_status='archived' ↔ archived_at
 * IS NOT NULL` via the §6.6 trigger (and via the §3.2 mutation rules), so
 * fixtures requesting `publication_status='archived'` get an explicit
 * `archived_at` populated to keep the trigger and the spec invariant
 * happy on insert.
 */
async function seedItem(
  initialStatus: 'draft' | 'in_review' | 'published' | 'archived',
  label: string,
): Promise<string> {
  // Inline object literal so the supabase-js Insert type narrows correctly.
  // Archive metadata is conditionally added via spread to keep the literal
  // shape compatible with the strict generated types.
  const archiveMetadata =
    initialStatus === 'archived'
      ? {
          archived_at: new Date().toISOString(),
          archived_by: TEST_USER_1_ID,
        }
      : {};

  const { data, error } = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} ${label}`,
      content: `Publication-status PATCH integration fixture: ${label}. Disposable.`,
      content_type: 'article',
      publication_status: initialStatus,
      created_by: TEST_USER_1_ID,
      ...archiveMetadata,
    })
    .select('id, publication_status, archived_at')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  if (data.publication_status !== initialStatus) {
    throw new Error(
      `Seed item "${label}" baseline drift: requested ${initialStatus}, got ${data.publication_status}`,
    );
  }

  seededIds.push(data.id);
  return data.id;
}

/**
 * Invoke the production PATCH handler with the requested body. Returns the
 * NextResponse so the caller can assert status + JSON. The handler reads
 * cookies via the file-scoped next/headers mock, which restoreSession()
 * primes in beforeEach.
 */
async function patchPublicationStatus(
  itemId: string,
  newStatus: 'draft' | 'in_review' | 'published' | 'archived',
  options: { archive_reason?: string } = {},
): Promise<Response> {
  const body: Record<string, unknown> = {
    field: 'publication_status',
    value: newStatus,
  };
  if (options.archive_reason !== undefined) {
    body.archive_reason = options.archive_reason;
  }
  const req = new NextRequest(`http://localhost/api/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return itemsPatch(req, { params: Promise.resolve({ id: itemId }) });
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  TEST_USER_1_ID = await getTestUserId('admin');
  await cacheAllTestUserSessions(cachedSessions);
}, 30_000);

beforeEach(() => {
  if (!HAS_REQUIRED_ENV) return;
  // The PATCH handler accepts admin + editor; for the lifecycle test we
  // run as admin so every transition in the §3.2 matrix is reachable
  // (editor cannot leave 'published' or 'archived').
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  if (seededIds.length === 0) return;

  // content_history rows are emitted by both the auto_version trigger
  // (AFTER INSERT on content_items) and by the route's explicit insert
  // for the publication-state transition. Delete them BEFORE the parent
  // rows so the FK does not block.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);
  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfEnv(
  'items PATCH publication_status — full DB path (S202 §5.2 Phase 2 / T6 V1-M2)',
  () => {
    it('happy path: draft → in_review → published → archived → published with audit log + trigger interaction', async () => {
      const itemId = await seedItem('draft', 'happy-path-lifecycle');

      // ---------------- draft → in_review ----------------
      {
        const res = await patchPublicationStatus(itemId, 'in_review');
        expect(res.status, await res.clone().text()).toBe(200);
        const json = (await res.json()) as { success: boolean };
        expect(json.success).toBe(true);

        const { data, error } = await serviceClient
          .from('content_items')
          .select(
            'publication_status, archived_at, archived_by, archive_reason',
          )
          .eq('id', itemId)
          .single();
        expect(error).toBeNull();
        expect(data?.publication_status).toBe('in_review');
        expect(data?.archived_at).toBeNull();
      }

      // ---------------- in_review → published ----------------
      {
        const res = await patchPublicationStatus(itemId, 'published');
        expect(res.status, await res.clone().text()).toBe(200);

        const { data } = await serviceClient
          .from('content_items')
          .select('publication_status, archived_at')
          .eq('id', itemId)
          .single();
        expect(data?.publication_status).toBe('published');
        expect(data?.archived_at).toBeNull();
      }

      // ---------------- published → archived (with reason) ----------------
      {
        const archiveReason = 'V1-M2 lifecycle test archive reason';
        const beforeArchiveMs = Date.now();
        const res = await patchPublicationStatus(itemId, 'archived', {
          archive_reason: archiveReason,
        });
        expect(res.status, await res.clone().text()).toBe(200);

        const { data } = await serviceClient
          .from('content_items')
          .select(
            'publication_status, archived_at, archived_by, archive_reason',
          )
          .eq('id', itemId)
          .single();
        expect(data?.publication_status).toBe('archived');
        // Side-effect helper stamps archived_at first; the §6.6 trigger
        // sees archived_at already populated and is a no-op (Direction 1
        // idempotency — caller-provided value preserved).
        expect(data?.archived_at).not.toBeNull();
        const archivedTs = new Date(data!.archived_at as string).getTime();
        expect(archivedTs).toBeGreaterThanOrEqual(beforeArchiveMs - 5_000);
        expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
        expect(data?.archived_by).toBe(TEST_USER_1_ID);
        expect(data?.archive_reason).toBe(archiveReason);
      }

      // ---------------- archived → published (un-archive) ----------------
      {
        const res = await patchPublicationStatus(itemId, 'published');
        expect(res.status, await res.clone().text()).toBe(200);

        const { data } = await serviceClient
          .from('content_items')
          .select(
            'publication_status, archived_at, archived_by, archive_reason',
          )
          .eq('id', itemId)
          .single();
        expect(data?.publication_status).toBe('published');
        // applyTransitionSideEffects sets archived_at: null; the trigger
        // sees publication_status moving away from 'archived' (Direction 2)
        // and reinforces the clear. End state: archived_at IS NULL.
        expect(data?.archived_at).toBeNull();
        // Audit retention: archived_by + archive_reason preserved per
        // helper contract (and spec §3.2 D-9 rationale).
        expect(data?.archived_by).toBe(TEST_USER_1_ID);
        expect(data?.archive_reason).toBe(
          'V1-M2 lifecycle test archive reason',
        );
      }

      // ---------------- content_history audit log ----------------
      // Four PATCH transitions ⇒ four content_history rows tagged
      // change_type='publication_state'. Each must carry the canonical
      // change_reason "Transition from <from> to <to>"; the archive
      // transition appends "(reason: …)" per route logic.
      const { data: history, error: historyErr } = await serviceClient
        .from('content_history')
        .select('change_type, change_reason, change_summary, version')
        .eq('content_item_id', itemId)
        .eq('change_type', 'publication_state')
        .order('version', { ascending: true });

      expect(historyErr).toBeNull();
      expect(history).toBeTruthy();
      expect(history!.length).toBe(4);

      const expectedTransitions = [
        { from: 'draft', to: 'in_review', withReason: false },
        { from: 'in_review', to: 'published', withReason: false },
        {
          from: 'published',
          to: 'archived',
          withReason: true,
          reasonText: 'V1-M2 lifecycle test archive reason',
        },
        { from: 'archived', to: 'published', withReason: false },
      ];

      for (let i = 0; i < expectedTransitions.length; i++) {
        const row = history![i]!;
        const expected = expectedTransitions[i]!;
        expect(row.change_type).toBe('publication_state');
        const expectedReason = expected.withReason
          ? `Transition from ${expected.from} to ${expected.to} (reason: ${expected.reasonText})`
          : `Transition from ${expected.from} to ${expected.to}`;
        expect(row.change_reason).toBe(expectedReason);
        expect(row.change_summary).toBe(
          `Publication status: ${expected.from} -> ${expected.to}`,
        );
      }

      // Versions must be monotonically increasing (the auto_version
      // BEFORE-INSERT trigger plus our explicit version param). At a
      // minimum: each subsequent version > the prior version.
      for (let i = 1; i < history!.length; i++) {
        expect(history![i]!.version).toBeGreaterThan(history![i - 1]!.version);
      }
    }, 60_000);

    it('CHECK enforcement: direct INSERT with invalid publication_status is rejected', async () => {
      // This exercises the DB CHECK directly (bypassing the PATCH handler).
      // Spec §4.1 + AC1.2: invalid enum values raise a 23514 CHECK violation
      // at the storage layer regardless of how the row arrives. The
      // generated Database type currently models `publication_status` as
      // `string`, so the literal `'unknown_state'` is assignable at TS;
      // the DB CHECK is the actual gate, which is exactly what this test
      // verifies (defence-in-depth against a future TS-side narrowing
      // gone wrong).
      const { error } = await serviceClient
        .from('content_items')
        .insert({
          title: `${TEST_PREFIX} invalid-publication-status`,
          content: 'fixture for CHECK rejection — should never persist.',
          content_type: 'article',
          publication_status: 'unknown_state',
          created_by: TEST_USER_1_ID,
        })
        .select('id')
        .single();

      expect(error).not.toBeNull();
      expect((error as { code?: string } | null)?.code).toBe('23514');
    });

    it('§6.6 trigger Direction 1: published → archived stamps archived_at via the helper, not the trigger', async () => {
      // Direction 1 fires only when archived_at IS NULL on the way in. The
      // PATCH route's applyTransitionSideEffects sets archived_at = NOW()
      // BEFORE the UPDATE statement reaches the trigger, so by the time
      // Direction 1 evaluates its predicate, archived_at is already
      // populated. The trigger is therefore a NO-OP idempotency safety
      // net for this code path — but the end-state invariant
      // (publication_status='archived' ↔ archived_at IS NOT NULL) is
      // still upheld.
      const itemId = await seedItem('published', 'D1-idempotency');

      const { data: pre } = await serviceClient
        .from('content_items')
        .select('publication_status, archived_at')
        .eq('id', itemId)
        .single();
      expect(pre?.publication_status).toBe('published');
      expect(pre?.archived_at).toBeNull();

      const res = await patchPublicationStatus(itemId, 'archived', {
        archive_reason: 'D1 idempotency test',
      });
      expect(res.status, await res.clone().text()).toBe(200);

      const { data: post } = await serviceClient
        .from('content_items')
        .select('publication_status, archived_at, archived_by, archive_reason')
        .eq('id', itemId)
        .single();
      expect(post?.publication_status).toBe('archived');
      expect(post?.archived_at).not.toBeNull();
      expect(post?.archived_by).toBe(TEST_USER_1_ID);
      expect(post?.archive_reason).toBe('D1 idempotency test');
    });

    it('§6.6 trigger Direction 2: archived → published clears archived_at end-to-end', async () => {
      // Direction 2 fires whenever publication_status moves AWAY from
      // 'archived'. The route's applyTransitionSideEffects also writes
      // archived_at: null on un-archive paths — both contribute to the
      // same outcome. End state: archived_at IS NULL while archived_by /
      // archive_reason are preserved per spec §3.2 D-9.
      const itemId = await seedItem('archived', 'D2-unarchive');

      // Sanity: the seed populated archived_at (we set it explicitly in
      // seedItem to keep the §6.6 invariant on insert).
      const { data: pre } = await serviceClient
        .from('content_items')
        .select('publication_status, archived_at, archived_by')
        .eq('id', itemId)
        .single();
      expect(pre?.publication_status).toBe('archived');
      expect(pre?.archived_at).not.toBeNull();
      expect(pre?.archived_by).toBe(TEST_USER_1_ID);

      const res = await patchPublicationStatus(itemId, 'published');
      expect(res.status, await res.clone().text()).toBe(200);

      const { data: post } = await serviceClient
        .from('content_items')
        .select('publication_status, archived_at, archived_by, archive_reason')
        .eq('id', itemId)
        .single();
      expect(post?.publication_status).toBe('published');
      expect(post?.archived_at).toBeNull();
      // Audit fields preserved through the un-archive (helper does NOT
      // clear them; trigger does NOT clear them).
      expect(post?.archived_by).toBe(TEST_USER_1_ID);
    });
  },
);
