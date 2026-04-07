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
