/**
 * WP2 Phase 1 spec — 8.0.6 viewer write enforcement
 *
 * VERIFIED AGAINST PRODUCTION (Phase 2 adversarial review):
 *   - The upload endpoint is `/api/upload` (verified at
 *     `app/api/upload/route.ts`). The earlier draft referenced
 *     `/api/upload-urls`, which does NOT exist.
 *   - `app/api/bids/route.ts` POST uses
 *     `getAuthorisedClient(['admin', 'editor'])` and returns
 *     `authFailureResponse(auth)` on failure, which routes `forbidden`
 *     → 403 (per CLAUDE.md gotcha). Viewer POST therefore returns 403.
 *   - `viewerPage` fixture exists in `e2e/fixtures/auth.ts:52` (TEST_USER_3).
 *
 * USER FLOW:
 *   1. Use the `viewerPage` fixture (TEST_USER_3, viewer role) so the
 *      browser session has a real authenticated viewer cookie.
 *   2. Without ever clicking a UI button, issue direct write requests via
 *      `page.request.post()` (bypasses any client-side gating; tests the
 *      server boundary directly):
 *        a. `POST /api/items` with a minimal valid body for creating a
 *           content item.
 *        b. `POST /api/bids` with a minimal valid body for creating a bid
 *           (e.g. `{ name: "viewer-attempt-<ts>", buyer: "x" }` — verify
 *           required fields against `BidCreateBodySchema` in
 *           `lib/validation/schemas.ts` so the body passes validation
 *           and the test exercises the AUTH layer, not the validation
 *           layer).
 *        c. `POST /api/upload` with a minimal valid multipart body
 *           for requesting an upload (verify body shape against
 *           `app/api/upload/route.ts`).
 *   3. For at least one of those endpoints (the bid one), also issue a
 *      `PATCH` against an existing row owned by ANOTHER user (use
 *      worker-seeded `bidId`) to prove the role check holds even when
 *      the target row is real and the viewer might be expected to "see"
 *      it. The PATCH path is `/api/bids/<bidId>` — verify against
 *      `app/api/bids/[id]/route.ts`.
 *   4. Capture pre-test state of the worker bid (`updated_at`, `name`,
 *     `domain_metadata`) via service-key SELECT BEFORE step 3, so the
 *     post-test "unchanged" assertion is a real diff.
 *   5. Verify the database afterwards: no rows were created or modified.
 *
 * ASSERTIONS (each must be verifiable from response state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - Each of the three POSTs returns HTTP 403 (NOT 200, NOT 302
 *     redirect, NOT 401, NOT 400, NOT 500). The exact-status assertion
 *     catches the discriminated-union regression where a route returns
 *     401 instead of 403 for an authenticated-but-unauthorised request.
 *   - Each response body parses as JSON (NOT HTML) AND contains an
 *     explicit error key (e.g. `error: "forbidden"` or similar). Phase 3
 *     pins the exact key by inspecting `authFailureResponse` in
 *     `lib/auth.ts`.
 *   - PATCH against the seeded `workspaces` row returns 403 AND the row
 *     in DB is unchanged: `updated_at`, `name`, and the buyer field of
 *     `domain_metadata` all equal their pre-test values (strict equality
 *     against the captured snapshot, NOT just "row still exists").
 *   - Service-key COUNT query confirms zero new `content_items` rows
 *     where `created_by = <viewer.id>` within the test window (capture
 *     a pre-test count; assert post-test count is identical).
 *   - Service-key COUNT query confirms zero new `workspaces` rows of
 *     `type='bid'` where `created_by = <viewer.id>` within the test
 *     window (same pre/post pattern).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - Worker-scoped `workerData.bidId` from `test-data-fixture.ts` is
 *     the target row for the cross-user PATCH attempt.
 *   - Viewer user from `viewerPage` fixture (TEST_USER_3).
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Server-side role gating missing: route handler accepts viewer's
 *     auth cookie and inserts the row → caught by 403 assertion + DB
 *     row-count assertion (BOTH must hold; one alone is satisfiable by
 *     a stub that returns 403 but still inserts).
 *   - Role check regressed to client-only (button hidden but POST still
 *     works) → caught by direct `page.request.post()` bypassing the UI.
 *   - `getAuthorisedClient()` consumer hand-rolled the wrong status (e.g.
 *     401 instead of 403, dropping the discriminated-union distinction
 *     CLAUDE.md warns about) → caught by exact-status assertion per route.
 *   - PATCH on the seeded bid silently no-ops (REST PATCH on wrong UUID
 *     gotcha returns 200 with 0 rows) → caught by 403 + DB unchanged
 *     assertion (the production code must REJECT viewer PATCH, not
 *     accept-and-no-op).
 *   - Route returns HTML error page on viewer write → caught by JSON
 *     parse + error key assertion.
 *   - Route returns 403 with a generic 500-style stack trace in the
 *     body (information disclosure) → caught by JSON shape assertion
 *     (must be a clean error envelope, not a stack).
 *
 * ROLE SCOPING:
 *   Uses `viewerPage` fixture exclusively. Reason: this entire spec
 *   exists to prove the viewer role cannot write — admin/editor positive
 *   paths are covered by 8.0.3 (bid create) and 8.0.4/8.0.5 (ingestion).
 *
 * CLEANUP:
 *   afterAll: defensive service-key delete of any rows that somehow got
 *   created with `created_by = viewer.id` during the run (the test
 *   should leave nothing behind, but a failure that creates a leak must
 *   not pollute the next run). No afterEach — each test is read-only at
 *   the DB level when passing, so cleanup is a single sweep.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock any `/api/*` endpoint. The whole point is to exercise
 *     the real route handler + real `getAuthorisedClient` chain.
 *   - DO NOT skip endpoints that "should obviously work" — every
 *     write endpoint listed must be tested. Coverage gaps in this spec
 *     translate directly to missed regressions.
 *   - DO NOT replace the exact-status `=== 403` assertion with
 *     `>= 400 && < 500` — the discriminated-union distinction between
 *     401 and 403 is the load-bearing detail this test exists to catch.
 *   - DO NOT wrap any assertion in a conditional. Every assertion runs
 *     unconditionally for every endpoint.
 *   - DO NOT skip the pre-test snapshot of the worker bid. Without it,
 *     the "unchanged" assertion degrades to "row still exists", which
 *     is satisfiable by any no-op handler.
 */
// S152A root-cause fix: the original version of this spec bypassed the
// worker-scoped `workerData` fixture because it was failing on a supposed
// `feed_sources` schema-cache drift (the fixture referenced `active`,
// `feed_url`, `poll_interval_minutes`). The root cause was a fixture bug,
// not schema drift: the `FeedSourceShape` in `e2e/fixtures/test-data.ts`
// invented column names that never existed in the live schema. That was
// fixed in commit `5fdb086`, so this spec now uses the standard
// `workerData.bidId` and no longer inline-seeds a workspaces row.
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { BrowserContext, Page } from '@playwright/test';
import { createServiceClient } from '../fixtures/supabase';
import { test as dataTest } from '../fixtures/test-data-fixture';

type ViewerFixtures = {
  viewerPage: Page;
};

const test = dataTest.extend<ViewerFixtures>({
  viewerPage: async ({ browser }, use) => {
    const ctx: BrowserContext = await browser.newContext({
      storageState: 'e2e/.auth/viewer.json',
    });
    const page = await ctx.newPage();
    // `use` here is Playwright's fixture-teardown callback, not a React
    // hook — silence react-hooks/rules-of-hooks for this single call.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    await ctx.close();
  },
});

// Resolve viewer user id once for the suite — used by DB count assertions
// and the defensive cleanup sweep. TEST_USER_3 is the viewer fixture user.
//
// Note: we deliberately do NOT use `supabase.auth.admin.listUsers()` here
// because the new `sb_secret_*` key format does not support that endpoint
// (returns "Database error finding users"). Instead we sign the viewer in
// once with the public anon key and read the user id from the returned
// session — exactly the pattern `e2e/auth.setup.ts` uses.
const VIEWER_EMAIL = process.env.TEST_USER_3_EMAIL ?? '';
const VIEWER_PASSWORD = process.env.TEST_USER_3_PASSWORD ?? '';

async function getViewerUserId(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.',
    );
  }
  if (!VIEWER_EMAIL || !VIEWER_PASSWORD) {
    throw new Error(
      'Missing TEST_USER_3_EMAIL or TEST_USER_3_PASSWORD env vars (viewer fixture user).',
    );
  }
  const c = createClient(url, anon);
  const { data, error } = await c.auth.signInWithPassword({
    email: VIEWER_EMAIL,
    password: VIEWER_PASSWORD,
  });
  if (error || !data.user) {
    throw new Error(
      `Viewer sign-in failed for "${VIEWER_EMAIL}": ${error?.message ?? 'no user returned'}`,
    );
  }
  return data.user.id;
}

test.describe('8.0.6 viewer write enforcement (server-side)', () => {
  test('viewer POSTs to write endpoints all return 403 and leave the DB untouched', async ({
    viewerPage,
    workerData,
  }) => {
    const bidId = workerData.bidId;
    const svc = createServiceClient();
    const viewerId = await getViewerUserId();

    // ---- Pre-test snapshot: bid row ----
    const { data: preBid, error: preBidErr } = await svc
      .from('workspaces')
      .select('id, name, updated_at, domain_metadata')
      .eq('id', bidId)
      .single();
    expect(preBidErr).toBeNull();
    expect(preBid).not.toBeNull();
    const preBidName = preBid!.name;
    const preBidUpdatedAt = preBid!.updated_at;
    const preBidBuyer =
      (preBid!.domain_metadata as { buyer?: string } | null)?.buyer ?? null;

    // ---- Pre-test counts: rows owned by the viewer ----
    const { count: preItemCount, error: preItemErr } = await svc
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', viewerId);
    expect(preItemErr).toBeNull();

    const { count: preBidsCount, error: preBidsErr } = await svc
      .from('workspaces')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', viewerId)
      .eq('type', 'bid');
    expect(preBidsErr).toBeNull();

    // ---- Endpoint A: POST /api/items ----
    const itemsRes = await viewerPage.request.post('/api/items', {
      data: {
        title: `viewer-attempt-${Date.now()}`,
        content: 'Viewer should not be able to create this content item.',
        content_type: 'note',
        auto_classify: false,
        auto_summarise: false,
        auto_embed: false,
      },
    });
    expect(itemsRes.status()).toBe(403);
    expect(itemsRes.headers()['content-type'] ?? '').toContain(
      'application/json',
    );
    const itemsBody = await itemsRes.json();
    expect(itemsBody).toEqual({ error: 'Forbidden' });

    // ---- Endpoint B: POST /api/bids ----
    const bidsRes = await viewerPage.request.post('/api/bids', {
      data: {
        name: `viewer-attempt-bid-${Date.now()}`,
        buyer: 'Test Buyer',
      },
    });
    expect(bidsRes.status()).toBe(403);
    expect(bidsRes.headers()['content-type'] ?? '').toContain(
      'application/json',
    );
    const bidsBody = await bidsRes.json();
    expect(bidsBody).toEqual({ error: 'Forbidden' });

    // ---- Endpoint C: POST /api/upload (multipart) ----
    // Minimal valid PDF magic-bytes payload — the route checks magic bytes
    // AFTER the auth check, so even a 4-byte buffer suffices to prove the
    // 403 short-circuit fires before any file processing.
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const uploadRes = await viewerPage.request.post('/api/upload', {
      multipart: {
        file: {
          name: 'viewer-attempt.pdf',
          mimeType: 'application/pdf',
          buffer: pdfBytes,
        },
      },
    });
    expect(uploadRes.status()).toBe(403);
    expect(uploadRes.headers()['content-type'] ?? '').toContain(
      'application/json',
    );
    const uploadBody = await uploadRes.json();
    expect(uploadBody).toEqual({ error: 'Forbidden' });

    // ---- Endpoint D (cross-user PATCH): PATCH /api/bids/:id ----
    const patchRes = await viewerPage.request.patch(
      `/api/bids/${bidId}`,
      {
        data: {
          name: `HACKED-${Date.now()}`,
          buyer: 'HACKED-BUYER',
        },
      },
    );
    expect(patchRes.status()).toBe(403);
    expect(patchRes.headers()['content-type'] ?? '').toContain(
      'application/json',
    );
    const patchBody = await patchRes.json();
    expect(patchBody).toEqual({ error: 'Forbidden' });

    // ---- Post-test: bid row unchanged ----
    const { data: postBid, error: postBidErr } = await svc
      .from('workspaces')
      .select('id, name, updated_at, domain_metadata')
      .eq('id', bidId)
      .single();
    expect(postBidErr).toBeNull();
    expect(postBid).not.toBeNull();
    expect(postBid!.name).toBe(preBidName);
    expect(postBid!.updated_at).toBe(preBidUpdatedAt);
    expect(
      (postBid!.domain_metadata as { buyer?: string } | null)?.buyer ?? null,
    ).toBe(preBidBuyer);

    // ---- Post-test: row counts unchanged for viewer-owned rows ----
    const { count: postItemCount } = await svc
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', viewerId);
    expect(postItemCount).toBe(preItemCount);

    const { count: postBidsCount } = await svc
      .from('workspaces')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', viewerId)
      .eq('type', 'bid');
    expect(postBidsCount).toBe(preBidsCount);
  });

  test.afterAll(async () => {
    // Defensive sweep: remove any rows that somehow got created with
    // `created_by = viewer.id` during the run. The test should leave
    // nothing behind (every assertion expects 403 + no write), but a
    // failure that leaks rows must not pollute the next run. Bounded to
    // viewer-owned rows only — never touches admin/editor/worker data.
    // The worker-scoped `workerData` fixture handles teardown of its own
    // seeded graph, so we no longer need to delete a bid row here.
    try {
      const svc = createServiceClient();
      if (VIEWER_EMAIL) {
        const viewerId = await getViewerUserId();
        await svc.from('content_items').delete().eq('created_by', viewerId);
        await svc
          .from('workspaces')
          .delete()
          .eq('created_by', viewerId)
          .eq('type', 'bid');
      }
    } catch (err) {
      console.error('[8.0.6 cleanup] sweep failed:', err);
    }
  });
});
