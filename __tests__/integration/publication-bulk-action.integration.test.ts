/**
 * §5.3 Publication Approval Gate — bulk-action integration test
 * (S220 W1a IMPL-B1).
 *
 * Real-DB integration coverage for `POST /api/review/publication-bulk-action`
 * (shipped S219 W1; route at `app/api/review/publication-bulk-action/route.ts`).
 * Spec: `docs/specs/publication-approval-gate-spec.md` v1 §6 + §8.3 + §8.5.
 *
 * The unit-test analogue at `__tests__/api/review-publication-bulk-action.test.ts`
 * covers AC-bulk-1.x + 2.1..2.10 against a mocked Supabase client. This file
 * exercises the FULL audit-trail chain against the staging Supabase branch:
 *
 *   - AC-bulk-3.1 — 20 successful approves emit exactly 20 content_history
 *     rows with `change_type='publication_state'`,
 *     `change_reason='bulk_approve'`,
 *     `change_summary='Publication status: in_review -> published'`.
 *   - AC-bulk-3.2 — 3 successful return-to-draft transitions emit 3 history
 *     rows with `change_reason='bulk_return_to_draft'`.
 *   - AC-bulk-3.3 — Mixed batch: 5 ids, 2 not in_review, only 3 succeed →
 *     exactly 3 history rows, NOT 5 (failure-row audit policy §6.4).
 *   - AC-bulk-3.4 — Smoke check that every history row carries a non-empty
 *     `change_reason` (the dedicated guard at
 *     `__tests__/validation/content-history-change-reason.test.ts` is the
 *     primary enforcer; this is a belt-and-braces assertion).
 *   - AC-bulk-3.5 — `auto_version_content_history` BEFORE-INSERT trigger
 *     bumps `version` correctly across bulk iterations.
 *   - AC-bulk-5.1 — `.eq('publication_status', fromStatus)` optimistic-
 *     concurrency filter is exercised behaviourally (success path).
 *   - AC-bulk-5.2 — Race-loss simulated via the deterministic pre-loop
 *     guard variant (a `'published'`-state row in the input array). True
 *     interleaved-write injection is deferred to a future test infra.
 *   - AC-bulk-5.3 — Pre-loop fromStatus guard rejects `'archived'` rows
 *     with the verbatim "Pre-loop guard: …" reason text.
 *   - AC-bulk-5.4 — Two sequential bulk requests on the same ids: first
 *     all-success, second all-conflict (pre-loop guard catches the
 *     now-`published` rows on the second pass).
 *   - AC-bulk-1.2 (editor at integration layer) — editor can bulk-approve.
 *
 * Pattern is copied from `items-patch-publication-status.integration.test.ts`
 * (cookie-store + cached-sessions + service-client fixture seeding) — see
 * that file for the rationale of mocking `next/headers` while running the
 * real `@/lib/auth` and `@/lib/supabase/*` chains end-to-end.
 *
 * Prereqs:
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL,
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *     TEST_USER_1_PASSWORD, TEST_USER_2_PASSWORD, NEXT_PUBLIC_CLIENT_ID.
 *   - `bun run seed:e2e-users` has been run against the target DB.
 *   - Schema includes the §6.6 archive-state trigger + the
 *     `content_history.change_type='publication_state'` CHECK extension
 *     (live on `rovrymhhffssilaftdwd` and the staging branch
 *     `turayklvaunphgbgscat`).
 *
 * Runs via: `bun run test:integration -- publication-bulk-action`
 *   (NOT picked up by `bun run test`; integration runner only — see
 *   feedback_test_runners_split + feedback_integration_test_location.)
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
// Mock next/headers at file scope so the hoisted authCookies is shared with
// the production createClient() code path. Same pattern as
// items-patch-publication-status.integration.test.ts.
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

// Import the route handler AFTER the mock is registered.
const { POST: bulkActionPost } =
  await import('@/app/api/review/publication-bulk-action/route');

import { NextRequest } from 'next/server';
import type {
  PublicationBulkActionResponse,
  PublicationBulkActionResult,
} from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Constants + fixture tracking
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[PUB-BULK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededIds: string[] = [];
let TEST_USER_1_ID = '';
let TEST_USER_2_ID = '';

// Skip the suite if env vars aren't present — mirrors the skip pattern used
// elsewhere in the integration suite.
const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.TEST_USER_1_PASSWORD &&
  process.env.TEST_USER_2_PASSWORD,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Direct service-role insert for a fresh `content_items` row at the requested
 * `publication_status`. Bypasses the API deliberately — we want a clean
 * baseline so the bulk endpoint can immediately exercise transitions out of
 * that state.
 *
 * `content_text_hash` is GENERATED ALWAYS so it MUST be omitted (CLAUDE.md
 * gotcha). Archive metadata is added when seeding `'archived'` to keep the
 * §6.6 trigger and the spec invariant happy on insert.
 *
 * Tracks the inserted id in `seededIds` for `afterAll` cleanup.
 */
async function seedItem(
  initialStatus: 'draft' | 'in_review' | 'published' | 'archived',
  label: string,
): Promise<string> {
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
      content: `Publication-bulk-action integration fixture: ${label}. Disposable.`,
      content_type: 'article',
      publication_status: initialStatus,
      created_by: TEST_USER_1_ID,
      ...archiveMetadata,
    })
    .select('id, publication_status')
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
 * Seed N items at the same `initialStatus`. Returns the array of ids in
 * insertion order. Inserted sequentially (not Promise.all) so a `created_at`
 * ordering test would be deterministic — though the bulk endpoint's iteration
 * order is the one we actually care about.
 */
async function seedItems(
  count: number,
  initialStatus: 'draft' | 'in_review' | 'published' | 'archived',
  labelPrefix: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(await seedItem(initialStatus, `${labelPrefix}-${i}`));
  }
  return ids;
}

/**
 * Invoke the production POST handler with the requested body. The handler
 * reads cookies via the file-scoped next/headers mock, which `restoreSession`
 * primes in `beforeEach`. Returns the parsed JSON response (always 200 for
 * the per-item-failure cases this suite exercises) plus the underlying
 * `Response` object for status-code assertions.
 */
async function postBulkAction(body: {
  ids: string[];
  action: 'approve' | 'return_to_draft';
}): Promise<{
  status: number;
  json: PublicationBulkActionResponse;
  rawText: string;
}> {
  const req = new NextRequest(
    'http://localhost/api/review/publication-bulk-action',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
  const res = await bulkActionPost(req);
  const rawText = await res.clone().text();
  // The route always returns JSON for 200/4xx/5xx; parse once.
  const json = (await res.json()) as PublicationBulkActionResponse;
  return { status: res.status, json, rawText };
}

/**
 * Fetch all `publication_state` history rows for the given content_item_ids,
 * ordered by `version` ascending (which is also `created_at` ascending under
 * the auto-version trigger). Filters to `change_type='publication_state'`
 * because the deferred `trg_content_items_ensure_v1_history` constraint
 * trigger writes a v1 row with `change_type='create'` for each newly-seeded
 * item (S186 WP-E backstop) — those are unrelated to the bulk-action audit.
 */
async function fetchPublicationHistoryFor(contentItemIds: string[]): Promise<
  Array<{
    content_item_id: string;
    version: number;
    change_type: string;
    change_reason: string | null;
    change_summary: string | null;
    created_at: string;
  }>
> {
  const { data, error } = await serviceClient
    .from('content_history')
    .select(
      'content_item_id, version, change_type, change_reason, change_summary, created_at',
    )
    .in('content_item_id', contentItemIds)
    .eq('change_type', 'publication_state')
    .order('content_item_id', { ascending: true })
    .order('version', { ascending: true });

  if (error) {
    throw new Error(`fetchPublicationHistoryFor failed: ${error.message}`);
  }
  // content_history.content_item_id is generated as nullable in the
  // Database type but is always populated for production-written rows.
  // Filter null defensively to satisfy the non-nullable return type.
  return (data ?? [])
    .filter(
      (row): row is typeof row & { content_item_id: string } =>
        row.content_item_id !== null,
    )
    .map((row) => ({
      content_item_id: row.content_item_id,
      version: row.version,
      change_type: row.change_type,
      change_reason: row.change_reason,
      change_summary: row.change_summary,
      created_at: row.created_at,
    }));
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  TEST_USER_1_ID = await getTestUserId('admin');
  TEST_USER_2_ID = await getTestUserId('editor');
  void TEST_USER_2_ID; // referenced inside the editor-role test below.
  await cacheAllTestUserSessions(cachedSessions);
}, 30_000);

beforeEach(() => {
  if (!HAS_REQUIRED_ENV) return;
  // Default role for each test is admin — the §5.2 RBAC matrix permits both
  // admin and editor for `'in_review' → {published, draft}`, so admin
  // exercises every transition. Tests needing a different role call
  // restoreSession() inline.
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  if (seededIds.length === 0) return;

  // content_history rows reference content_items via FK — delete history
  // rows first to avoid the FK blocking. Includes BOTH the deferred-trigger
  // v1 rows (`change_type='create'`) and the explicit bulk-action rows
  // (`change_type='publication_state'`).
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);
  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 60_000);

// ---------------------------------------------------------------------------
// Tests — AC-bulk-3.x audit trail
// ---------------------------------------------------------------------------

describeIfEnv(
  '§5.3 publication-bulk-action — audit trail (AC-bulk-3.x)',
  () => {
    it('AC-bulk-3.1: 20 successful approves emit exactly 20 publication_state history rows with bulk_approve literal', async () => {
      const ids = await seedItems(20, 'in_review', 'ac3-1-approve');

      const { status, json } = await postBulkAction({ ids, action: 'approve' });

      expect(status).toBe(200);
      expect(json.action).toBe('approve');
      expect(json.totalRequested).toBe(20);
      expect(json.successCount).toBe(20);
      expect(json.failureCount).toBe(0);
      expect(json.results).toHaveLength(20);
      expect(json.results.every((r) => r.status === 'success')).toBe(true);

      // Audit-trail assertion. Filter by content_item_id IN (ids) to
      // exclude unrelated history written by other concurrent tests on the
      // shared staging branch.
      const history = await fetchPublicationHistoryFor(ids);
      expect(history).toHaveLength(20);

      for (const row of history) {
        expect(row.change_type).toBe('publication_state');
        expect(row.change_reason).toBe('bulk_approve');
        expect(row.change_summary).toBe(
          'Publication status: in_review -> published',
        );
        // AC-bulk-3.4 belt-and-braces: change_reason is non-null/non-empty.
        expect(row.change_reason).toBeTruthy();
      }

      // Every seeded id appears exactly once in the history result set.
      const historyByItem = new Map<string, number>();
      for (const row of history) {
        historyByItem.set(
          row.content_item_id,
          (historyByItem.get(row.content_item_id) ?? 0) + 1,
        );
      }
      for (const id of ids) {
        expect(historyByItem.get(id)).toBe(1);
      }
    }, 90_000);

    it('AC-bulk-3.2: 3 successful return_to_draft emit 3 publication_state history rows with bulk_return_to_draft literal', async () => {
      const ids = await seedItems(3, 'in_review', 'ac3-2-return');

      const { status, json } = await postBulkAction({
        ids,
        action: 'return_to_draft',
      });

      expect(status).toBe(200);
      expect(json.action).toBe('return_to_draft');
      expect(json.successCount).toBe(3);
      expect(json.failureCount).toBe(0);

      const history = await fetchPublicationHistoryFor(ids);
      expect(history).toHaveLength(3);

      for (const row of history) {
        expect(row.change_type).toBe('publication_state');
        expect(row.change_reason).toBe('bulk_return_to_draft');
        expect(row.change_summary).toBe(
          'Publication status: in_review -> draft',
        );
      }
    }, 60_000);

    it('AC-bulk-3.3: mixed batch — 3 of 5 succeed → exactly 3 publication_state history rows (failure-row audit policy §6.4)', async () => {
      // Seed 3 in_review (will succeed) + 1 published + 1 draft (both will
      // hit the §5.3 pre-loop guard with status='conflict').
      const inReviewIds = await seedItems(
        3,
        'in_review',
        'ac3-3-mixed-success',
      );
      const publishedId = await seedItem('published', 'ac3-3-mixed-pub');
      const draftId = await seedItem('draft', 'ac3-3-mixed-draft');
      const allIds = [...inReviewIds, publishedId, draftId];

      const { status, json } = await postBulkAction({
        ids: allIds,
        action: 'approve',
      });

      expect(status).toBe(200);
      expect(json.totalRequested).toBe(5);
      expect(json.successCount).toBe(3);
      expect(json.failureCount).toBe(2);

      // The 3 in_review rows are 'success'; the 2 non-in_review rows are
      // 'conflict' with previousStatus reflecting the actual state.
      const successResults = json.results.filter((r) => r.status === 'success');
      const conflictResults = json.results.filter(
        (r) => r.status === 'conflict',
      );
      expect(successResults).toHaveLength(3);
      expect(conflictResults).toHaveLength(2);
      const conflictPrevStatuses = conflictResults
        .map((r) => r.previousStatus)
        .sort();
      expect(conflictPrevStatuses).toEqual(['draft', 'published']);

      // Critical §6.4 assertion: failure rows produce ZERO content_history
      // rows. So the 5-id batch yields exactly 3 publication_state rows.
      const history = await fetchPublicationHistoryFor(allIds);
      expect(history).toHaveLength(3);

      // Sanity: the 3 history rows belong to the 3 in_review ids, not the
      // failure ids.
      const historyItemIds = new Set(history.map((r) => r.content_item_id));
      for (const id of inReviewIds) {
        expect(historyItemIds.has(id)).toBe(true);
      }
      expect(historyItemIds.has(publishedId)).toBe(false);
      expect(historyItemIds.has(draftId)).toBe(false);

      for (const row of history) {
        expect(row.change_reason).toBe('bulk_approve');
      }
    }, 60_000);

    it('AC-bulk-3.5: auto_version_content_history trigger increments version monotonically per content_item_id across bulk iterations', async () => {
      // Seed fresh in_review items. Each newly-inserted content_items row
      // gets a v1 history row from the deferred backstop trigger
      // (change_type='create'). The bulk-approve path then writes a
      // change_type='publication_state' row whose version is bumped by
      // the auto_version BEFORE-INSERT trigger relative to the existing
      // history for that item — typically v=2.
      const ids = await seedItems(5, 'in_review', 'ac3-5-version');

      // Capture the pre-bulk max version per item (v1 from the backstop).
      const { data: preRows, error: preErr } = await serviceClient
        .from('content_history')
        .select('content_item_id, version')
        .in('content_item_id', ids);
      expect(preErr).toBeNull();
      const preMaxByItem = new Map<string, number>();
      for (const row of preRows ?? []) {
        if (row.content_item_id === null) continue;
        const cur = preMaxByItem.get(row.content_item_id) ?? 0;
        if (row.version > cur)
          preMaxByItem.set(row.content_item_id, row.version);
      }
      // Every item should already have at least one history row (v1) from
      // the deferred backstop.
      for (const id of ids) {
        expect(preMaxByItem.get(id) ?? 0).toBeGreaterThanOrEqual(1);
      }

      const { json } = await postBulkAction({ ids, action: 'approve' });
      expect(json.successCount).toBe(5);

      // Per-item: the new publication_state row's version equals
      // pre-existing max + 1.
      const postHistory = await fetchPublicationHistoryFor(ids);
      expect(postHistory).toHaveLength(5);
      for (const row of postHistory) {
        const preMax = preMaxByItem.get(row.content_item_id) ?? 0;
        expect(row.version).toBe(preMax + 1);
      }
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// Tests — AC-bulk-5.x optimistic concurrency
// ---------------------------------------------------------------------------

describeIfEnv(
  '§5.3 publication-bulk-action — optimistic concurrency (AC-bulk-5.x)',
  () => {
    it('AC-bulk-5.1: successful UPDATE behaviour — .eq(publication_status, fromStatus) filter passes when no concurrent writer interferes', async () => {
      // Behavioural assertion (no spy at integration layer): seeding an
      // in_review row, posting bulk-approve with no concurrent writer, and
      // observing a `'success'` result implies the
      //   .update(...).eq('id', id).eq('publication_status', 'in_review')
      //   .select(...).single()
      // pipeline (route line 213-229) executed end-to-end against the real
      // DB without PGRST116 — which only happens when the .eq filter
      // matched. AC-bulk-5.1 spec text says "verified via mock spy"; the
      // unit test at __tests__/api/review-publication-bulk-action.test.ts
      // owns that spy assertion. This integration test covers the
      // behavioural outcome on the live DB.
      const id = await seedItem('in_review', 'ac5-1-success');

      const { json } = await postBulkAction({ ids: [id], action: 'approve' });
      expect(json.successCount).toBe(1);
      const result = json.results[0]!;
      expect(result.status).toBe('success');
      expect(result.previousStatus).toBe('in_review');
      expect(result.newStatus).toBe('published');

      // Confirm the row's publication_status actually transitioned.
      const { data } = await serviceClient
        .from('content_items')
        .select('publication_status')
        .eq('id', id)
        .single();
      expect(data?.publication_status).toBe('published');
    }, 30_000);

    it('AC-bulk-5.2: race-loss simulated via deterministic pre-loop-guard variant — published-state row in input array → conflict', async () => {
      // The true "interleave a concurrent UPDATE between SELECT and
      // UPDATE" race requires injecting a delay into the route handler
      // (no test-only hook exists; not adding one). The deterministic
      // semantic equivalent: include a row whose publication_status is
      // already 'published' at fetch time. The pre-loop fromStatus guard
      // (route line 173-182) catches it as 'conflict' with previousStatus
      // reflecting the post-race state — exactly what a true race-loss
      // produces at the request-shape level.
      //
      // AC-bulk-5.2 + AC-bulk-2.5 + AC-bulk-2.10 are equivalent at this
      // level; the spec separates them to document the three different
      // motivations (race-loss, attacker-submission, stale-cache) for the
      // same bulk endpoint behaviour.
      const racedId = await seedItem('published', 'ac5-2-raced');
      const goodId = await seedItem('in_review', 'ac5-2-good');

      const { json } = await postBulkAction({
        ids: [racedId, goodId],
        action: 'approve',
      });

      expect(json.totalRequested).toBe(2);
      expect(json.successCount).toBe(1);
      expect(json.failureCount).toBe(1);

      const racedResult = json.results.find(
        (r: PublicationBulkActionResult) => r.id === racedId,
      );
      expect(racedResult).toBeDefined();
      expect(racedResult!.status).toBe('conflict');
      expect(racedResult!.previousStatus).toBe('published');

      const goodResult = json.results.find(
        (r: PublicationBulkActionResult) => r.id === goodId,
      );
      expect(goodResult!.status).toBe('success');

      // Failure row produced ZERO history rows; success row produced 1.
      const history = await fetchPublicationHistoryFor([racedId, goodId]);
      expect(history).toHaveLength(1);
      expect(history[0]!.content_item_id).toBe(goodId);
    }, 30_000);

    it('AC-bulk-5.3: pre-loop fromStatus guard rejects archived rows with verbatim "Pre-loop guard: …" reason', async () => {
      const archivedId = await seedItem('archived', 'ac5-3-archived');

      const { json } = await postBulkAction({
        ids: [archivedId],
        action: 'approve',
      });

      expect(json.successCount).toBe(0);
      expect(json.failureCount).toBe(1);

      const result = json.results[0]!;
      expect(result.status).toBe('conflict');
      expect(result.previousStatus).toBe('archived');
      expect(result.reason).toBeDefined();
      // Verbatim from route line 178; assertion as substring to be robust
      // against future single-quote / double-quote tweaks while still
      // pinning the canonical phrase.
      expect(result.reason).toContain('Pre-loop guard');
      expect(result.reason).toContain("fromStatus 'archived'");
      expect(result.reason).toContain("not 'in_review'");

      // No history row written for the conflict.
      const history = await fetchPublicationHistoryFor([archivedId]);
      expect(history).toHaveLength(0);
    }, 30_000);

    it('AC-bulk-5.4: two sequential bulk-approve requests on same 5 ids — first all-success, second all-conflict (pre-loop guard catches now-published rows)', async () => {
      // Sequential, not Promise.all — true parallel-write racing is flaky
      // by nature on a real DB. The sequential approach is semantically
      // equivalent to "two callers raced; one won": the second request
      // sees fromStatus='published' (the winning state) and the pre-loop
      // guard returns 'conflict' for every row.
      //
      // This validates that the bulk endpoint cannot double-publish the
      // same row, regardless of how callers are ordered.
      const ids = await seedItems(5, 'in_review', 'ac5-4-race');

      const first = await postBulkAction({ ids, action: 'approve' });
      expect(first.json.successCount).toBe(5);
      expect(first.json.failureCount).toBe(0);

      const second = await postBulkAction({ ids, action: 'approve' });
      expect(second.json.totalRequested).toBe(5);
      expect(second.json.successCount).toBe(0);
      expect(second.json.failureCount).toBe(5);
      for (const r of second.json.results) {
        expect(r.status).toBe('conflict');
        expect(r.previousStatus).toBe('published');
      }

      // Audit table: exactly 5 publication_state rows from the FIRST
      // request; the second request's pre-loop guard rejections produced
      // ZERO additional history rows (failure-row audit policy §6.4).
      const history = await fetchPublicationHistoryFor(ids);
      expect(history).toHaveLength(5);
      for (const row of history) {
        expect(row.change_reason).toBe('bulk_approve');
      }
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// Tests — Editor role at integration layer (AC-bulk-1.2 equivalent)
// ---------------------------------------------------------------------------

describeIfEnv(
  '§5.3 publication-bulk-action — editor role (AC-bulk-1.2 integration)',
  () => {
    it('editor can bulk-approve in_review items end-to-end with bulk_approve audit row', async () => {
      // Switch active session to editor for this test. The default
      // beforeEach sets admin; restoreSession() clears + repopulates.
      restoreSession(authCookies, cachedSessions, 'editor');

      const ids = await seedItems(2, 'in_review', 'editor-approve');

      const { status, json } = await postBulkAction({ ids, action: 'approve' });

      expect(status).toBe(200);
      expect(json.successCount).toBe(2);
      expect(json.failureCount).toBe(0);
      for (const r of json.results) {
        expect(r.status).toBe('success');
        expect(r.previousStatus).toBe('in_review');
        expect(r.newStatus).toBe('published');
      }

      // PR-1 RBAC matrix sanity: editor's writes are attributed to the
      // editor user (TEST_USER_2) in content_history.created_by, not to
      // the admin user.
      const { data: hist, error: histErr } = await serviceClient
        .from('content_history')
        .select('content_item_id, change_reason, created_by')
        .in('content_item_id', ids)
        .eq('change_type', 'publication_state');
      expect(histErr).toBeNull();
      expect(hist).toHaveLength(2);
      for (const row of hist!) {
        expect(row.change_reason).toBe('bulk_approve');
        expect(row.created_by).toBe(TEST_USER_2_ID);
      }
    }, 60_000);
  },
);
