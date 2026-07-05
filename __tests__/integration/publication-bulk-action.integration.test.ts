/**
 * ID-131.19 M6 retirement (S450 GO tail — resolves the Wave 1 Fix 4 FLAG
 * left in this header): `app/api/review/publication-bulk-action/route.ts`
 * no longer performs the content_history audit INSERT (retired at Wave 1
 * Fix 4, see the route's own header) AND is now re-pointed onto
 * `source_documents` (content_items DROPPED at M6). The AC-bulk-3.x describe
 * block below (20/3/mixed-batch history-row-count + change_reason/
 * change_summary assertions + the AC-bulk-3.5 auto_version_content_history
 * trigger assertion) tested an audit-trail write that no longer exists on
 * ANY table — it is RETIRED here with no replacement (the route's own
 * header documents the gap: "the specific 'who changed it from X to Y and
 * why' audit trail is lost until a proper replacement is designed"). The
 * surviving AC-bulk-5.x (optimistic concurrency) and editor-role blocks are
 * re-seeded onto `source_documents` and have their now-meaningless
 * content_history assertions trimmed — their core subject (concurrency
 * guard behaviour, RBAC transitions) is unaffected and still fully live.
 *
 * §5.3 Publication Approval Gate — bulk-action integration test
 * (S220 W1a IMPL-B1).
 *
 * Real-DB integration coverage for `POST /api/review/publication-bulk-action`
 * (shipped S219 W1; route at `app/api/review/publication-bulk-action/route.ts`).
 * Spec: `docs/specs/publication-approval-gate-spec.md` v1 §6 + §8.3 + §8.5.
 *
 * The unit-test analogue at `__tests__/api/review-publication-bulk-action.test.ts`
 * covers AC-bulk-1.x + 2.1..2.10 against a mocked Supabase client. This file
 * exercises the concurrency-guard + RBAC chain against the staging Supabase
 * branch:
 *
 *   - AC-bulk-3.x (content_history audit-trail) — RETIRED (ID-131.19 M6;
 *     see the header note above). The route no longer writes an audit
 *     trail at all.
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
 *   - Schema includes the §6.6 archive-state trigger (live on the
 *     production project and the staging branch).
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
 * Direct service-role insert for a fresh `source_documents` row at the
 * requested `publication_status`. Bypasses the API deliberately — we want a
 * clean baseline so the bulk endpoint can immediately exercise transitions
 * out of that state.
 *
 * ID-131.19 M6 retirement: content_items DROPPED at M6; the production
 * route reads/writes `source_documents` (BI-20 inline hot). Archive
 * metadata is added when seeding `'archived'` to keep the §6.6 trigger
 * and the spec invariant happy on insert.
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
    .from('source_documents')
    .insert({
      filename: `${TEST_PREFIX} ${label}.txt`,
      mime_type: 'text/plain',
      file_size: 1,
      content_hash: `${TEST_PREFIX}-${label}`,
      storage_path: `test-fixtures/${TEST_PREFIX}/${label}.txt`,
      content_type: 'article',
      publication_status: initialStatus,
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

// ID-131.19 M6 retirement: `fetchPublicationHistoryFor` (queried
// content_history for the bulk-action audit trail) is REMOVED — the route
// no longer writes an audit trail at all (Wave 1 Fix 4 retired the insert;
// content_history itself was DROPPED at M6). See the module header.

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
  // ID-131.19 M6 retirement: content_history/content_items DROPPED at M6 —
  // no history cleanup step needed anymore.
  await serviceClient.from('source_documents').delete().in('id', seededIds);
}, 60_000);

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
        .from('source_documents')
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

      // ID-131.19 M6 retirement: the route no longer writes an audit trail
      // (content_history DROPPED); the state-write proof is a direct
      // re-read of source_documents.publication_status instead — the
      // conflict row must stay 'published' (untouched), the success row
      // must actually flip to 'published'.
      const { data: racedRow } = await serviceClient
        .from('source_documents')
        .select('publication_status')
        .eq('id', racedId)
        .single();
      expect(racedRow?.publication_status).toBe('published');

      const { data: goodRow } = await serviceClient
        .from('source_documents')
        .select('publication_status')
        .eq('id', goodId)
        .single();
      expect(goodRow?.publication_status).toBe('published');
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

      // ID-131.19 M6 retirement: no audit trail to check (content_history
      // DROPPED); confirm no write occurred instead — the row must remain
      // 'archived' (the conflict path never reaches the UPDATE step).
      const { data: row } = await serviceClient
        .from('source_documents')
        .select('publication_status')
        .eq('id', archivedId)
        .single();
      expect(row?.publication_status).toBe('archived');
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

      // ID-131.19 M6 retirement: no audit trail to check (content_history
      // DROPPED); confirm the state-write landed for all 5 from the FIRST
      // request instead — every row must now be 'published'.
      for (const id of ids) {
        const { data: row } = await serviceClient
          .from('source_documents')
          .select('publication_status')
          .eq('id', id)
          .single();
        expect(row?.publication_status).toBe('published');
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
    it('editor can bulk-approve in_review items end-to-end, attributed to the editor via updated_by', async () => {
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

      // ID-131.19 M6 retirement: content_history (and its created_by audit
      // trail) DROPPED at M6. PR-1 RBAC matrix sanity now checks the
      // surviving attribution column instead — the route's step-4 UPDATE
      // sets `updated_by: user.id` on `source_documents` directly (see
      // app/api/review/publication-bulk-action/route.ts) — editor's writes
      // must be attributed to the editor user (TEST_USER_2), not admin.
      const { data: rows, error: rowsErr } = await serviceClient
        .from('source_documents')
        .select('id, publication_status, updated_by')
        .in('id', ids);
      expect(rowsErr).toBeNull();
      expect(rows).toHaveLength(2);
      for (const row of rows!) {
        expect(row.publication_status).toBe('published');
        expect(row.updated_by).toBe(TEST_USER_2_ID);
      }
    }, 60_000);
  },
);
