/**
 * §5.5 Phase 2 T3 — Full lifecycle integration test for the review-cadence cron + auto-renewal.
 *
 * Walks the complete lifecycle that Phase 2 ships:
 *
 *   Insert → cron flip → notification dispatch → idempotency check
 *     → admin approve → auto-renewal of next_review_date + verified_at bump
 *
 * Each step is verified against the real database via the service-role client
 * (RLS-bypassed). The cron route handler is invoked directly via dynamic
 * import; the approve handler is invoked through the production
 * `getAuthorisedClient` path with a real signed-in admin session (cookie store
 * pattern, mirroring `admin-users.integration.test.ts`).
 *
 * Spec: docs/specs/p0-document-control-lifecycle-spec.md v1.3 §6.9 ACs 1+6+8.
 * Plan: docs/plans/§5.5-phase-2-cron-plan.md v1.1 T3.
 *
 * Prereqs:
 *   - `.env` with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, TEST_USER_1_PASSWORD.
 *   - §5.5 Phase 1 schema is live (governance_review_status CHECK includes
 *     'review_overdue'; notifications.type CHECK includes 'review_overdue').
 *   - §5.5 Phase 2 T1 (cron route) + T2 (renewal in approve handlers) shipped.
 *   - `bun run seed:e2e-users` has been run against the target DB.
 *
 * Runs via: `bun run test:integration -- review-cadence-lifecycle`
 *   (NOT picked up by `bun run test`; integration runner only — see CLAUDE.md
 *   feedback_test_runners_split.)
 *
 * Idempotency notes:
 *   - The cron is global (no workspace scope), so other test data with past
 *     `next_review_date` may inflate `items_flagged`. Assertions about the
 *     test row use re-fetch-by-ID, not global counts. The count-style
 *     assertions use `toBeGreaterThanOrEqual(1)` to tolerate concurrent leaks.
 *   - Test data is namespaced with a prefix that includes Date.now() + a
 *     random slug, so two parallel runs can't collide.
 *
 * ID-131.19 M6 retirement note (S450 GO tail): `content_items` was DROPPED
 * at M6. Both the cron (app/api/cron/review-cadence/route.ts) and the
 * approve handler (app/api/governance/review/route.ts) were ALREADY
 * re-pointed at ID-131.19 G-GOV-FACET onto the `record_lifecycle` facet
 * (owner_kind='source_document') for governance_review_status/
 * governance_review_due/governance_reviewer_id/next_review_date/
 * review_cadence_days/verified_at, joined to `source_documents` for
 * filename/publication_status/archived_at. This fixture is re-seeded
 * accordingly: a `source_documents` row + its `record_lifecycle` facet row.
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
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Mock next/headers at file scope so the hoisted cookieStore is shared with
// the production createClient() code path. Same pattern as
// admin-users.integration.test.ts.
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

// Import handlers AFTER the mock is registered.
const { GET: cronReviewCadenceGET } =
  await import('@/app/api/cron/review-cadence/route');
const { POST: governanceReviewPOST } =
  await import('@/app/api/governance/review/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUN_PREFIX = `S201-T3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_TITLE = `S201 T3 Lifecycle Test (${RUN_PREFIX})`;
const PAST_REVIEW_DATE = '2025-01-01';
const REVIEW_CADENCE_DAYS = 180;

// Tracked for guaranteed afterAll cleanup even if a step throws.
const createdItemIds: string[] = [];
let TEST_USER_1_ID = '';

// Skip the suite if env vars aren't present — mirrors the skip pattern used
// elsewhere in the integration suite (e.g. intelligence-golden-path).
const HAS_REQUIRED_ENV = Boolean(
  process.env.CRON_SECRET &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.TEST_USER_1_PASSWORD,
);

const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;

  TEST_USER_1_ID = await getTestUserId('admin');
  // Sign in as admin once and cache the cookie set. The approve step in this
  // test uses the admin role; we don't switch roles inside the test, so a
  // single sign-in is sufficient (well under the Supabase rate limit).
  await cacheAllTestUserSessions(cachedSessions);
}, 30_000);

beforeEach(() => {
  if (!HAS_REQUIRED_ENV) return;
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  if (createdItemIds.length === 0) return;

  // Cleanup ordering matters: notifications.entity_id is intentionally a
  // string (polymorphic) with no FK cascade, so we must delete notifications
  // BEFORE the source_documents rows. Per feedback_silent_failure_prevention
  // we still surface errors via expect(error).toBeNull() inside the test;
  // the afterAll path tolerates missing rows because some steps may not
  // have written notifications.
  for (const itemId of createdItemIds) {
    await serviceClient.from('notifications').delete().eq('entity_id', itemId);
  }
  // ID-131.19 M6 retirement: content_history/content_items DROPPED at M6.
  // Clean the record_lifecycle facet row before the source_documents row.
  await serviceClient
    .from('record_lifecycle')
    .delete()
    .eq('owner_kind', 'source_document')
    .in('source_document_id', createdItemIds);
  await serviceClient
    .from('source_documents')
    .delete()
    .in('id', createdItemIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describeIfEnv(
  '§5.5 Phase 2 T3 — Review-cadence full lifecycle (real DB)',
  () => {
    it('walks insert → cron flip → notification → idempotency → approve → auto-renewal', async () => {
      // ── Step 0: Setup — seed a source_documents + record_lifecycle row
      //    the cron will catch ──────────────────────────────────────────
      // ID-131.19 M6 retirement: content_items DROPPED at M6; the cron +
      // approve handler both key off `record_lifecycle`
      // (owner_kind='source_document') for governance_review_status/
      // next_review_date/review_cadence_days/content_owner_id/verified_at,
      // joined to `source_documents` for filename/publication_status. We
      // seed with `governance_review_status='approved'` (one of the cron's
      // eligible statuses per spec §6.3) and a `next_review_date` in the
      // past so the cron flips it to 'review_overdue'.
      const seedSlug = randomUUID();
      const { data: seededDoc, error: seedDocError } = await serviceClient
        .from('source_documents')
        .insert({
          filename: TEST_TITLE,
          mime_type: 'text/plain',
          file_size: 1,
          content_hash: `${RUN_PREFIX}-${seedSlug}`,
          storage_path: `test-fixtures/${RUN_PREFIX}/${seedSlug}.txt`,
          content_type: 'article',
        })
        .select('id')
        .single();

      expect(
        seedDocError,
        'seed source_documents insert must succeed',
      ).toBeNull();
      expect(seededDoc).toBeTruthy();
      const itemId = seededDoc!.id;
      createdItemIds.push(itemId);

      // upsert (not insert): trg_record_lifecycle_mint_source_document
      // (20260706100000_id131_facet_mint.sql) forward-mints a default
      // record_lifecycle row on every source_documents INSERT above, so a
      // plain insert here collides with the auto-minted row on the
      // record_lifecycle_owner_kind_owner_id_key unique constraint.
      const { error: seedLifecycleError } = await serviceClient
        .from('record_lifecycle')
        .upsert(
          {
            owner_kind: 'source_document',
            source_document_id: itemId,
            next_review_date: PAST_REVIEW_DATE,
            review_cadence_days: REVIEW_CADENCE_DAYS,
            governance_review_status: 'approved',
            content_owner_id: TEST_USER_1_ID,
            verified_at: null,
            domain: `${RUN_PREFIX} ${seedSlug}`,
          },
          { onConflict: 'owner_kind,owner_id' },
        );

      expect(
        seedLifecycleError,
        'seed record_lifecycle upsert must succeed',
      ).toBeNull();

      // Pin "today" for the renewal assertion — the cron computes
      // GREATEST(current, today) + cadence. Since current (2025-01-01) is in
      // the past, today wins. We capture today HERE in test code rather than
      // mocking it inside the handler: the renewal handler uses
      // `new Date()` directly via `computeNextReviewDate`, so we compare its
      // output against our wall-clock today + 180d with a 1-day tolerance to
      // absorb a midnight flip during the test run.
      const todayMs = Date.now();
      const expectedNextReviewMs = todayMs + REVIEW_CADENCE_DAYS * 86_400_000;

      // ── Step 1: Cron flip ──────────────────────────────────────────────
      const cronRequest = new Request(
        'http://localhost/api/cron/review-cadence',
        {
          headers: {
            authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
        },
      );
      const cronResponse = await cronReviewCadenceGET(
        cronRequest as NextRequest,
      );

      expect(cronResponse.status).toBe(200);
      const cronBody = (await cronResponse.json()) as {
        success: boolean;
        items_flagged: number;
        notifications_created: number;
        batch_summary_notification: boolean;
        executed_at: string;
      };
      // Global cron — other test data may inflate counts; assert >= 1, not
      // === 1 (per plan T3 gotcha "global cron — assert THE TEST ROW").
      expect(cronBody.items_flagged).toBeGreaterThanOrEqual(1);
      expect(cronBody.notifications_created).toBeGreaterThanOrEqual(1);

      // ── Step 2: DB invariants post-flip ────────────────────────────────
      const { data: postFlipItem, error: postFlipFetchErr } =
        await serviceClient
          .from('record_lifecycle')
          .select(
            'source_document_id, governance_review_status, governance_review_due, next_review_date',
          )
          .eq('owner_kind', 'source_document')
          .eq('source_document_id', itemId)
          .single();

      expect(postFlipFetchErr).toBeNull();
      expect(postFlipItem).toBeTruthy();
      expect(postFlipItem!.governance_review_status).toBe('review_overdue');
      expect(postFlipItem!.governance_review_due).not.toBeNull();
      // next_review_date should still be the past date — the cron flip does
      // not advance it (renewal is the approve handler's job).
      // next_review_date is `timestamp with time zone` (not `date`), so
      // PostgREST round-trips it as a full ISO timestamp — compare the
      // date-only prefix, matching the slice(0, 10) idiom used below for the
      // post-approve drift check.
      expect(postFlipItem!.next_review_date?.slice(0, 10)).toBe(
        PAST_REVIEW_DATE,
      );

      // ── Step 3: Notification row exists for the test item ─────────────
      const { data: notifications, error: notifFetchErr } = await serviceClient
        .from('notifications')
        .select('id, user_id, type, entity_id, entity_type, title, message')
        .eq('entity_id', itemId)
        .eq('type', 'review_overdue');

      expect(notifFetchErr).toBeNull();
      expect(notifications).toBeTruthy();
      expect(notifications!.length).toBe(1);
      const notif = notifications![0];
      expect(notif.user_id).toBe(TEST_USER_1_ID);
      expect(notif.entity_type).toBe('content_item');
      expect(notif.title).toContain('Review overdue');

      // ── Step 4: Idempotency — re-invoke the cron ──────────────────────
      // After the first run, the test row has `governance_review_status =
      // 'review_overdue'`, which is excluded by the cron's `OR
      // (governance_review_status IS NULL OR = 'approved')` filter. So the
      // test row should NOT appear again as a candidate. Check by:
      //   (a) re-fetching the item — status stays 'review_overdue';
      //   (b) re-counting notifications for entity_id — stays at 1.
      const cronRequest2 = new Request(
        'http://localhost/api/cron/review-cadence',
        {
          headers: {
            authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
        },
      );
      const cronResponse2 = await cronReviewCadenceGET(
        cronRequest2 as NextRequest,
      );
      expect(cronResponse2.status).toBe(200);

      const { data: postRerunItem, error: postRerunFetchErr } =
        await serviceClient
          .from('record_lifecycle')
          .select('governance_review_status')
          .eq('owner_kind', 'source_document')
          .eq('source_document_id', itemId)
          .single();
      expect(postRerunFetchErr).toBeNull();
      expect(postRerunItem!.governance_review_status).toBe('review_overdue');

      const { data: postRerunNotifs, error: postRerunNotifErr } =
        await serviceClient
          .from('notifications')
          .select('id')
          .eq('entity_id', itemId)
          .eq('type', 'review_overdue');
      expect(postRerunNotifErr).toBeNull();
      expect(postRerunNotifs!.length).toBe(1);

      // ── Step 5: Admin approve via POST /api/governance/review ─────────
      // The handler validates that the item is in one of the
      // ALLOWED_REVIEW_INPUT_STATUSES (post-Phase-1: ['pending', 'review_overdue']).
      // Since our item is now 'review_overdue', the approve branch executes
      // and triggers the auto-renewal logic added in T2.
      const approveRequest = new NextRequest(
        'http://localhost/api/governance/review',
        {
          method: 'POST',
          body: JSON.stringify({ item_id: itemId, action: 'approve' }),
          headers: { 'content-type': 'application/json' },
        },
      );
      const approveBeforeMs = Date.now();
      const approveResponse = await governanceReviewPOST(approveRequest);
      const approveAfterMs = Date.now();

      const approveBodyText = await approveResponse.text();
      let approveBody: {
        success?: boolean;
        action?: string;
        item_id?: string;
        error?: string;
      };
      try {
        approveBody = JSON.parse(approveBodyText);
      } catch {
        approveBody = { error: approveBodyText };
      }
      expect(
        approveResponse.status,
        `approve POST failed: ${approveBodyText}`,
      ).toBe(200);
      expect(approveBody.success).toBe(true);
      expect(approveBody.action).toBe('approve');
      expect(approveBody.item_id).toBe(itemId);

      // ── Step 6: Post-approve invariants ───────────────────────────────
      const { data: postApproveItem, error: postApproveFetchErr } =
        await serviceClient
          .from('record_lifecycle')
          .select(
            'source_document_id, governance_review_status, governance_review_due, next_review_date, verified_at, review_cadence_days',
          )
          .eq('owner_kind', 'source_document')
          .eq('source_document_id', itemId)
          .single();

      expect(postApproveFetchErr).toBeNull();
      expect(postApproveItem).toBeTruthy();

      // (a) status flipped back to approved
      expect(postApproveItem!.governance_review_status).toBe('approved');

      // (b) governance_review_due cleared
      expect(postApproveItem!.governance_review_due).toBeNull();

      // (c) next_review_date advanced — should be today + 180 days
      // (GREATEST(2025-01-01, today) = today; today + 180d).
      // Allow a 1-day tolerance to absorb midnight UTC flip during the test.
      expect(postApproveItem!.next_review_date).not.toBeNull();
      const actualNextReviewMs = new Date(
        postApproveItem!.next_review_date as string,
      ).getTime();
      const driftMs = Math.abs(actualNextReviewMs - expectedNextReviewMs);
      expect(
        driftMs,
        `next_review_date drift: actual=${postApproveItem!.next_review_date} expected≈${new Date(expectedNextReviewMs).toISOString().slice(0, 10)} (drift ${driftMs}ms)`,
      ).toBeLessThanOrEqual(86_400_000); // ≤ 1 day

      // (d) verified_at is a fresh ISO timestamp within the approve window
      // (give a 60s grace either side to absorb clock skew + handler latency).
      expect(postApproveItem!.verified_at).not.toBeNull();
      const verifiedMs = new Date(
        postApproveItem!.verified_at as string,
      ).getTime();
      expect(verifiedMs).toBeGreaterThanOrEqual(approveBeforeMs - 60_000);
      expect(verifiedMs).toBeLessThanOrEqual(approveAfterMs + 60_000);

      // (e) cadence_days unchanged — the renewal must not mutate the cadence
      expect(postApproveItem!.review_cadence_days).toBe(REVIEW_CADENCE_DAYS);
    }, 90_000);
  },
);
