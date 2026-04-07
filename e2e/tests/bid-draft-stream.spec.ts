/**
 * WP2 Phase 1 spec — 8.0.7 bid draft-stream happy path
 *
 * VERIFIED AGAINST PRODUCTION (Phase 2 adversarial review):
 *   - `bid_response_history` table EXISTS with `response_text`,
 *     `response_text_advanced`, and `version` columns (verified at
 *     `supabase/types/database.types.ts:92-130`). Spec table name is
 *     correct.
 *   - The bid session route `/bid/[id]/session` exists at
 *     `app/bid/[id]/session/page.tsx`.
 *   - Draft-stream endpoint exists at
 *     `app/api/bids/[id]/responses/draft-stream/route.ts`.
 *   - Restore endpoint exists at
 *     `app/api/bids/[id]/responses/[rId]/restore/route.ts` and updates
 *     `bid_responses` (a DB trigger snapshots the previous version into
 *     `bid_response_history` with the next version number — confirmed
 *     forward-only revert).
 *
 * USER FLOW:
 *   1. Use the worker-seeded bid (`workerData.bidId`) and one of its
 *      questions (`workerData.questionIds[0]`). The worker fixture
 *      already advances the bid to the `drafting` state, so the editor
 *      view is reachable.
 *   2. `beforeEach`: defensive service-key delete of any pre-existing
 *      `bid_responses` AND `bid_response_history` rows for the chosen
 *      question id, so each test starts from a known empty state.
 *   3. As admin (authenticatedPage), navigate to `/bid/<bidId>/session`.
 *   4. Locate the question card for `questionIds[0]`.
 *   5. Attach a `page.on('response', ...)` listener BEFORE clicking, to
 *      capture the SSE endpoint response object so we can later assert at
 *      least one streaming chunk was received and the final status code.
 *   6. Click the "Draft with AI" / "Draft response" button.
 *   7. Use `page.waitForResponse(<sse url predicate>)` to wait for the
 *      stream endpoint to FINISH. NOT a fixed timeout.
 *   8. Wait for the editor textarea / rich text region for that question
 *      to contain non-empty content.
 *   9. Service-key query `bid_responses` for the question id and capture
 *      `response_text`, `version`, and `id`. Then service-key query
 *      `bid_response_history` for the same `response_id`.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - The SSE endpoint emitted at least one non-empty data chunk during
 *     the stream (chunk count >= 1 AND total streamed bytes > 0). Phase 3
 *     implementer accumulates chunks via the `response` listener.
 *   - The SSE response completed with HTTP status 200 (NOT 500 mid-stream).
 *   - `bid_responses` row exists for the question id with non-empty
 *     `response_text` AND `version === 1` (or whatever the production
 *     code's initial version value is — Phase 3 verifies; the assertion
 *     must be exact equality, NOT `version >= 1`, so a regression that
 *     skips version-tracking is caught).
 *   - The drafted text rendered in the UI EQUALS the DB-stored
 *     `response_text` (string equality, not just substring; if the UI
 *     applies trimming/normalisation, Phase 3 normalises both sides
 *     before comparing). Proves the stream output and the persisted
 *     content are the same payload, not two divergent paths.
 *   - The `bid_response_history` query for this `response_id` returns
 *     either zero rows (if the trigger only snapshots on UPDATE, not
 *     INSERT) OR one row with `version === 1`. Phase 3 must inspect the
 *     trigger definition in `supabase/migrations/` and pin the expected
 *     count BEFORE writing the assertion — the assertion must be exact
 *     count equality, not `>= 0`. The spec passes either way, but the
 *     EXACT count is what catches regressions in 8.0.8.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - `workerData.bidId` (advanced to drafting) and
 *     `workerData.questionIds` from `test-data-fixture.ts`.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - SSE handler opens a stream and emits zero chunks (silent failure
 *     in `use-draft-stream.ts` or upstream Anthropic call) → caught by
 *     chunk-count >= 1 assertion.
 *   - SSE handler 500s mid-stream but UI shows "saved" → caught by
 *     status === 200 + non-empty DB assertion.
 *   - Stream output rendered in UI but never persisted → caught by
 *     DB `response_text` non-empty + UI/DB equality assertions.
 *   - DB persisted but UI shows empty editor (state-sync regression) →
 *     caught by editor non-empty assertion.
 *   - Initial draft assigned wrong version (e.g. 0 or null) → caught by
 *     exact-equality version assertion.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: drafting is a
 *   write operation; admin is the canonical happy path.
 *
 * CLEANUP:
 *   afterEach: service-key delete of any `bid_responses` and
 *   `bid_response_history` rows for the targeted question id. The
 *   worker bid itself is owned by the worker fixture and not deleted
 *   here.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock the SSE endpoint or the Anthropic streaming client.
 *     The whole point is to exercise the real stream + real persistence.
 *   - DO NOT pre-seed a `bid_responses` row in `beforeEach` — that
 *     would make the "row exists" assertion trivially true (Attack 2).
 *     The defensive delete in `beforeEach` is required; the seed is
 *     forbidden.
 *   - DO NOT replace the chunk-count assertion with "stream completed".
 *     A stream that opens and immediately closes with zero chunks
 *     "completes" successfully but is the bug we're hunting.
 *   - DO NOT wrap the DB assertion in `if (responseRow) { ... }`. If
 *     the row is missing, that IS the failure — let it throw.
 *   - DO NOT use `expect(text).toContain('')` or
 *     `expect(text.length).toBeGreaterThanOrEqual(0)` — both are
 *     trivially true.
 */

/**
 * WP2 Phase 1 spec — 8.0.8 bid regenerate + restore
 *
 * VERIFIED AGAINST PRODUCTION (Phase 2 adversarial review):
 *   - Restore route at `app/api/bids/[id]/responses/[rId]/restore/route.ts`
 *     UPDATEs `bid_responses` with the historical row's `response_text`
 *     and `response_text_advanced`. The DB trigger then snapshots the
 *     pre-update version into `bid_response_history`. This is a
 *     forward-only revert: restoring v1 over v2 produces a v3 row and
 *     preserves v2 in history.
 *   - Regenerate route at
 *     `app/api/bids/[id]/responses/[rId]/regenerate/route.ts` likewise
 *     UPDATEs the row, triggering a snapshot.
 *
 * USER FLOW:
 *   1. Pre-condition: 8.0.7 happy path has run (or is reproduced inline
 *      in `beforeEach`) — there is a `bid_responses` v1 row for
 *      `questionIds[0]` with known content. Capture v1 text as
 *      `originalText` AND v1 numeric `version` AND the response `id` via
 *      service-key query BEFORE any UI action. Direct service-key seed
 *      is preferred over re-running 8.0.7 because it removes flakiness
 *      from upstream LLM calls.
 *   2. As admin (authenticatedPage), navigate to `/bid/<bidId>/session`.
 *   3. Click the "Regenerate" / "Re-draft" control on the question card.
 *   4. Wait for the SSE stream to complete (same `waitForResponse`
 *      pattern as 8.0.7).
 *   5. Capture the new editor text as `regeneratedText`.
 *   6. Service-key query `bid_responses` and `bid_response_history`,
 *     capture the new active version and the snapshot row(s).
 *   7. Open the version history drawer / panel for that response.
 *   8. Click "Restore" on the v1 entry.
 *   9. Wait for the restore API call to complete (`waitForResponse` on
 *      `/api/bids/<id>/responses/<rId>/restore`).
 *   10. Read the editor text again as `restoredText`.
 *   11. Service-key query `bid_responses` AND `bid_response_history`
 *       again to capture the post-restore state.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - After regenerate: `regeneratedText !== originalText` (proves the
 *     regenerate actually produced new content; not a no-op caching bug).
 *   - After regenerate: a NEW row exists in `bid_response_history` with
 *     `version === 1` whose `response_text` equals `originalText` (string
 *     equality — proves history is a real snapshot of the original, not
 *     a stub).
 *   - After regenerate: `bid_responses.version` is now 2 (or whatever
 *     the next version value is per the production trigger — Phase 3
 *     pins exact equality, NOT `> 1`).
 *   - After regenerate: `bid_responses.response_text === regeneratedText`
 *     (UI and DB agree; not two divergent paths).
 *   - After restore: `restoredText === originalText` in the editor
 *     (string equality after the same normalisation as 8.0.7).
 *   - After restore: `bid_responses.response_text === originalText`
 *     in DB (proves restore wrote back to the live row, not just to
 *     client state).
 *   - After restore: `bid_responses.version` has incremented again (e.g.
 *     to v3) so that the regenerated v2 is itself preserved in history —
 *     restore is forward-only, not a destructive rollback.
 *   - After restore: `bid_response_history` contains BOTH v1 (with
 *     `originalText`) AND v2 (with `regeneratedText`). Phase 3 asserts
 *     a row count of >= 2 AND asserts the v2 row's `response_text`
 *     equals `regeneratedText` (string equality).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - Same `workerData.bidId` + `workerData.questionIds[0]` as 8.0.7.
 *   - `beforeEach`: direct service-key insert into `bid_responses`
 *     with deterministic `response_text` (the `originalText` value),
 *     `version = 1`, and the question id. NO history row needs to be
 *     manually inserted — the regenerate UPDATE will trigger the
 *     snapshot.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Regenerate overwrites the `bid_responses` row WITHOUT triggering
 *     a history snapshot (e.g. trigger disabled or bypassed) → caught
 *     by `bid_response_history` row + content equality assertions.
 *   - Regenerate is a no-op and returns the same text → caught by
 *     `regeneratedText !== originalText` assertion.
 *   - Restore button is wired to a no-op handler (UI updates client
 *     state but never PATCHes the row) → caught by DB `response_text`
 *     equality assertion after restore.
 *   - Restore wipes the regenerated v2 from history (loses work) →
 *     caught by post-restore history row count >= 2 + v2 content
 *     equality assertion.
 *   - Restore is implemented as a destructive rollback (sets version
 *     back to 1 instead of incrementing to 3) → caught by version-
 *     increment assertion.
 *   - Restore writes the WRONG history row's content (e.g. always
 *     restores the latest, not the requested version) → caught by
 *     `restoredText === originalText` assertion (which uses the v1
 *     value specifically).
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: regenerate and
 *   restore are write operations; admin is the canonical path.
 *
 * CLEANUP:
 *   afterEach: service-key delete of all `bid_responses` and
 *   `bid_response_history` rows for the targeted question id, restoring
 *   the empty state for the next test. Worker bid is preserved.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock `/api/bids/.../regenerate` or `/api/bids/.../restore`.
 *     The DB trigger behaviour is the load-bearing thing being tested.
 *   - DO NOT seed `bid_response_history` directly in `beforeEach`. The
 *     history rows MUST be produced by real UPDATEs through the route
 *     handlers — otherwise the test passes against a broken trigger.
 *   - DO NOT replace `regeneratedText !== originalText` with
 *     `regeneratedText.length > 0`. A regenerate stub that returns the
 *     same text would pass the length check.
 *   - DO NOT replace the post-restore version assertion with
 *     `version >= 1` — that masks the destructive-rollback regression.
 *   - DO NOT wrap any assertion in a conditional. Every assertion runs
 *     for every test invocation.
 *   - DO NOT skip the v2-still-in-history assertion just because it's
 *     "covered" by version increment. Both assertions are required:
 *     version-increment proves the COUNTER moved; the v2-content-in-
 *     history assertion proves the SNAPSHOT actually persisted.
 */
