/**
 * WP2 Phase 1 spec — 8.0.6 viewer write enforcement
 *
 * ID-131 "17-final" REPOINT (G-IMS-DELETE tail): the original draft targeted
 * `POST /api/items` and `POST /api/upload`, both deleted under {131.17}/
 * {131.24} (content_items write surface retired). This spec now targets the
 * two write routes that replaced them:
 *   - `POST /api/q-a-pairs/batch` (ID-131 {131.21} G-MANUAL-QA) — the manual
 *     Q&A batch-authoring route (`app/api/q-a-pairs/batch/route.ts`), gated
 *     `getAuthorisedClient(['admin', 'editor'])` same as the old items route.
 *   - `POST /api/ingest/folder-drop` (ID-138 {138.13}, ID-131.24 G-UPLOAD-GATE)
 *     — the single binding-admission gate that now backs the Upload tab,
 *     also gated `getAuthorisedClient(['admin', 'editor'])`.
 * Neither `q_a_pairs` nor `source_documents` carries a `created_by`/
 * `uploaded_by` column (ownership lives at the `record_lifecycle` governance
 * facet, not the row itself — see
 * `supabase/migrations/20260705100000_id131_facet_mint.sql`), so the
 * "nothing was written" check below is scoped to a per-attempt UNIQUE
 * sentinel value rather than a created_by row count. This is strictly
 * tighter than the old count comparison and also survives parallel-project
 * contamination (chromium-desktop + chromium-mobile share the same viewer
 * user).
 *
 * USER FLOW:
 *   1. Use the `viewerPage` fixture (TEST_USER_3, viewer role) so the
 *      browser session has a real authenticated viewer cookie.
 *   2. Without ever clicking a UI button, issue direct write requests via
 *      `page.request.post()` (bypasses any client-side gating; tests the
 *      server boundary directly):
 *        a. `POST /api/q-a-pairs/batch` with a minimal valid body for
 *           creating a manually-authored Q&A pair.
 *        b. `POST /api/procurement` with a minimal valid body for creating a
 *           bid (verify required fields against `ProcurementCreateBodySchema`
 *           in `lib/validation/schemas.ts` so the body passes validation and
 *           the test exercises the AUTH layer, not the validation layer).
 *        c. `POST /api/ingest/folder-drop` with a minimal valid multipart
 *           body (file + retention_class) for requesting a source-document
 *           admission (verify body shape against
 *           `app/api/ingest/folder-drop/route.ts`).
 *   3. For at least one of those endpoints (the bid one), also issue a
 *      `PATCH` against an existing row owned by ANOTHER user (use
 *      worker-seeded `procurementId`) to prove the role check holds even when
 *      the target row is real and the viewer might be expected to "see"
 *      it. The PATCH path is `/api/procurement/<procurementId>` — verify against
 *      `app/api/procurement/[id]/route.ts`.
 *   4. Capture pre-test state of the worker bid (`updated_at`, `name`,
 *     `issuing_organisation`) via service-key SELECT BEFORE step 3, so the
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
 *     explicit error key (`error: 'Forbidden'`, per `authFailureResponse`
 *     in `lib/auth/client.ts`).
 *   - PATCH against the seeded `form_instances` row returns 403 AND the row
 *     in DB is unchanged: `updated_at`, `name`, and `issuing_organisation`
 *     (the buyer field, ID-145 {145.6}/{145.18} — no more `domain_metadata`)
 *     all equal their pre-test values (strict equality against the captured
 *     snapshot, NOT just "row still exists").
 *   - Service-key SELECT confirms zero `q_a_pairs` rows exist with the
 *     attempt's unique `question_text` sentinel.
 *   - Service-key SELECT confirms zero `source_documents` rows exist with
 *     the attempt's unique `filename` sentinel.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - Worker-scoped `workerData.procurementId` from `test-data-fixture.ts` is
 *     the target row for the cross-user PATCH attempt.
 *   - Viewer user from `viewerPage` fixture (TEST_USER_3).
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Server-side role gating missing: route handler accepts viewer's
 *     auth cookie and inserts the row → caught by 403 assertion + DB
 *     sentinel-row assertion (BOTH must hold; one alone is satisfiable by
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
 *   afterAll: defensive service-key delete of any `q_a_pairs` /
 *   `source_documents` rows matching the `viewer-attempt-` sentinel prefix
 *   (the test should leave nothing behind, but a failure that creates a
 *   leak must not pollute the next run). No afterEach — each test is
 *   read-only at the DB level when passing, so cleanup is a single sweep.
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
// `workerData.procurementId` and no longer inline-seeds a workspaces row.
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { DB_OPTION } from '@/lib/supabase/schema';
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
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars.',
    );
  }
  if (!VIEWER_EMAIL || !VIEWER_PASSWORD) {
    throw new Error(
      'Missing TEST_USER_3_EMAIL or TEST_USER_3_PASSWORD env vars (viewer fixture user).',
    );
  }
  // ID-115 (S9): route to the exposed api schema
  const c = createClient(url, anon, { ...DB_OPTION });
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
    const procurementId = workerData.procurementId;
    const svc = createServiceClient();
    const viewerId = await getViewerUserId();

    // Unique per-run sentinel — q_a_pairs / source_documents carry no
    // created_by column, so "nothing was written" is proven by absence of
    // this exact value rather than a row-count comparison.
    const attemptId = `viewer-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ---- Pre-test snapshot: bid row ----
    //
    // ID-145 {145.6}/{145.18} form-first re-architecture (BI-1): the
    // procurement item IS a `form_instances` row — `workspaces` +
    // `domain_metadata` are wholesale-deleted for procurement (W1e). Buyer
    // lives on `issuing_organisation` directly.
    const { data: preBid, error: preBidErr } = await svc
      .from('form_instances')
      .select('id, name, updated_at, issuing_organisation')
      .eq('id', procurementId)
      .single();
    expect(preBidErr).toBeNull();
    expect(preBid).not.toBeNull();
    const preBidName = preBid!.name;
    const preBidUpdatedAt = preBid!.updated_at;
    const preBidBuyer = preBid!.issuing_organisation ?? null;

    // ---- Pre-test counts: bid rows (form_instances) owned by the viewer ----
    // No `application_type_id` discriminator needed post-W1 — `form_instances`
    // is procurement-only (there is no umbrella `workspaces` type to filter).
    const { count: preBidsCount, error: preBidsErr } = await svc
      .from('form_instances')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', viewerId);
    expect(preBidsErr).toBeNull();

    // ---- Endpoint A: POST /api/q-a-pairs/batch ----
    const itemsRes = await viewerPage.request.post('/api/q-a-pairs/batch', {
      data: {
        items: [
          {
            question_text: attemptId,
            answer_standard:
              'Viewer should not be able to create this Q&A pair.',
          },
        ],
      },
    });
    expect(itemsRes.status()).toBe(403);
    expect(itemsRes.headers()['content-type'] ?? '').toContain(
      'application/json',
    );
    const itemsBody = await itemsRes.json();
    expect(itemsBody).toEqual({ error: 'Forbidden' });

    // ---- Endpoint B: POST /api/procurement ----
    const bidsRes = await viewerPage.request.post('/api/procurement', {
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

    // ---- Endpoint C: POST /api/ingest/folder-drop (multipart) ----
    // Minimal non-empty payload — the route checks auth BEFORE parsing the
    // multipart body (app/api/ingest/folder-drop/route.ts), so even a
    // 4-byte buffer suffices to prove the 403 short-circuit fires before
    // any Storage PUT / source_documents mint.
    const uploadFilename = `${attemptId}.pdf`;
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const uploadRes = await viewerPage.request.post('/api/ingest/folder-drop', {
      multipart: {
        file: {
          name: uploadFilename,
          mimeType: 'application/pdf',
          buffer: pdfBytes,
        },
        retention_class: 'ingest_once',
      },
    });
    expect(uploadRes.status()).toBe(403);
    expect(uploadRes.headers()['content-type'] ?? '').toContain(
      'application/json',
    );
    const uploadBody = await uploadRes.json();
    expect(uploadBody).toEqual({ error: 'Forbidden' });

    // ---- Endpoint D (cross-user PATCH): PATCH /api/procurement/:id ----
    const patchRes = await viewerPage.request.patch(
      `/api/procurement/${procurementId}`,
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
      .from('form_instances')
      .select('id, name, updated_at, issuing_organisation')
      .eq('id', procurementId)
      .single();
    expect(postBidErr).toBeNull();
    expect(postBid).not.toBeNull();
    expect(postBid!.name).toBe(preBidName);
    expect(postBid!.updated_at).toBe(preBidUpdatedAt);
    expect(postBid!.issuing_organisation ?? null).toBe(preBidBuyer);

    // ---- Post-test: bid row count unchanged for the viewer ----
    const { count: postBidsCount } = await svc
      .from('form_instances')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', viewerId);
    expect(postBidsCount).toBe(preBidsCount);

    // ---- Post-test: no q_a_pairs row leaked from the forbidden POST ----
    const { data: leakedQAPairs, error: qaPairsErr } = await svc
      .from('q_a_pairs')
      .select('id')
      .eq('question_text', attemptId);
    expect(qaPairsErr).toBeNull();
    expect(leakedQAPairs).toEqual([]);

    // ---- Post-test: no source_documents row leaked from the forbidden
    //      folder-drop admission ----
    const { data: leakedSourceDocs, error: srcDocErr } = await svc
      .from('source_documents')
      .select('id')
      .eq('filename', uploadFilename);
    expect(srcDocErr).toBeNull();
    expect(leakedSourceDocs).toEqual([]);
  });

  test.afterAll(async () => {
    // Defensive sweep: remove any rows that somehow got created carrying the
    // `viewer-attempt-` sentinel prefix during the run. The test should
    // leave nothing behind (every assertion expects 403 + no write), but a
    // failure that leaks rows must not pollute the next run. Bounded to
    // sentinel-prefixed rows only — never touches admin/editor/worker data.
    // The worker-scoped `workerData` fixture handles teardown of its own
    // seeded graph, so we no longer need to delete a bid row here.
    try {
      const svc = createServiceClient();
      await svc
        .from('q_a_pairs')
        .delete()
        .like('question_text', 'viewer-attempt-%');
      await svc
        .from('source_documents')
        .delete()
        .like('filename', 'viewer-attempt-%');
    } catch (err) {
      console.error('[8.0.6 cleanup] sweep failed:', err);
    }
  });
});
