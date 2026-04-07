/**
 * WP2 Phase 1 spec — 8.0.6 viewer write enforcement
 *
 * USER FLOW:
 *   1. Use the `viewerPage` fixture (TEST_USER_3, viewer role) so the
 *      browser session has a real authenticated viewer cookie.
 *   2. Without ever clicking a UI button, issue direct write requests via
 *      `page.request.post()` (bypasses any client-side gating; tests the
 *      server boundary directly):
 *        a. `POST /api/items` with a minimal valid body for creating a
 *           content item.
 *        b. `POST /api/bids` with a minimal valid body for creating a bid.
 *        c. `POST /api/upload-urls` with a minimal valid body for
 *           requesting a signed upload URL.
 *   3. For at least one of those endpoints (the bid one), also issue a
 *      `PATCH` / `PUT` against an existing row owned by ANOTHER user (use
 *      worker-seeded `bidId`) to prove the role check holds even when the
 *      target row is real and the viewer might be expected to "see" it.
 *   4. Verify the database afterwards: no rows were created or modified.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - Each of the three POSTs returns HTTP 403 (the project's
 *     `authFailureResponse(auth)` helper maps `forbidden` → 403; this is
 *     the canonical viewer-write rejection per CLAUDE.md). NOT 200, NOT
 *     302 redirect, NOT 401.
 *   - Each response body parses as JSON with an explicit error message
 *     (e.g. `{ error: "forbidden" }` or similar) — proves the route
 *     intentionally rejected, did not 500 or HTML-error-page.
 *   - The PATCH against the seeded `workspaces` row returns 403 AND the
 *     row in DB is unchanged (compare `updated_at` and key fields before
 *     vs after via service-key query).
 *   - Service-key DB query confirms zero new `content_items` rows
 *     attributable to the viewer test user (and zero new `workspaces`
 *     rows of `type='bid'` created_by viewer) within the test window.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - Worker-scoped `workerData.bidId` from `test-data-fixture.ts` is the
 *     target row for the cross-user PATCH attempt.
 *   - Viewer user from `viewerPage` fixture (TEST_USER_3).
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Server-side role gating missing: route handler accepts viewer's
 *     auth cookie and inserts the row → caught by 403 assertion + DB
 *     row-count assertion.
 *   - Role check regressed to client-only (button hidden but POST still
 *     works) → caught by direct page.request.post() bypassing the UI.
 *   - `getAuthorisedClient()` consumer hand-rolled the wrong status (e.g.
 *     401 instead of 403, dropping the discriminated-union distinction
 *     CLAUDE.md warns about) → caught by exact-status assertion per route.
 *   - PATCH on the seeded bid silently no-ops (REST PATCH on wrong UUID
 *     gotcha returns 200 with 0 rows) → caught by 403 + DB unchanged
 *     assertion (NOT 200).
 *   - Route returns HTML error page on viewer write → caught by JSON
 *     parse + error key assertion.
 *
 * ROLE SCOPING:
 *   Uses `viewerPage` fixture exclusively. Reason: this entire spec exists
 *   to prove the viewer role cannot write — admin/editor positive paths
 *   are covered by 8.0.3 (bid create) and 8.0.4/8.0.5 (ingestion).
 *
 * CLEANUP:
 *   afterAll: defensive service-key delete of any rows that somehow got
 *   created with `created_by = viewer.id` during the run (the test
 *   should leave nothing behind, but a failure that creates a leak must
 *   not pollute the next run). No afterEach — each test is read-only at
 *   the DB level when passing, so cleanup is a single sweep.
 */
