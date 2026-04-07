/**
 * WP2 Phase 1 spec — 8.0.7 bid draft-stream happy path
 *
 * USER FLOW:
 *   1. Use the worker-seeded bid (`workerData.bidId`) and one of its
 *      questions (`workerData.questionIds[0]`). The worker fixture
 *      already advances the bid to the `drafting` state, so the editor
 *      view is reachable.
 *   2. Ensure the targeted question has NO existing response (delete any
 *      seeded `bid_responses` rows for it via service key in beforeEach,
 *      so the test starts from a known empty state).
 *   3. As admin (authenticatedPage), navigate to `/bid/<bidId>/session`
 *      (verify exact session route in Phase 3 against the bid editor).
 *   4. Locate the question card for `questionIds[0]`.
 *   5. Attach a `page.on('response', ...)` listener BEFORE clicking, to
 *      capture the SSE endpoint response object so we can later assert at
 *      least one streaming chunk was received.
 *   6. Click the "Draft with AI" / "Draft response" button.
 *   7. Use `page.waitForResponse(<sse url predicate>)` to wait for the
 *      stream endpoint to FINISH (not just open). NOT a fixed timeout.
 *   8. Wait for the editor textarea / rich text region for that question
 *      to contain non-empty content (Playwright `expect(...).not.toHaveText('')`).
 *   9. Service-key query `bid_responses` for the question id and assert
 *      `response_text` (or `content`) is non-empty.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - The SSE endpoint emitted at least one non-empty data chunk during
 *     the stream (tracked via the response listener — assert chunk count
 *     >= 1 AND total streamed bytes > 0).
 *   - The SSE response completed with a 200 status (NOT 500 mid-stream).
 *   - `bid_responses` row exists for the question with non-empty
 *     `response_text` AND `version === 1`.
 *   - The drafted text rendered in the UI matches (or contains a long
 *     prefix of) the DB-stored text — proves the stream output and the
 *     persisted content are the same payload, not two divergent paths.
 *   - A row exists in `bid_response_history` (or whatever the history
 *     table is — Phase 3 implementer to confirm exact name) for this
 *     response, capturing v1 of the drafted content.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - `workerData.bidId` (advanced to drafting) and `workerData.questionIds`
 *     from `test-data-fixture.ts`.
 *   - `beforeEach`: defensive service-key delete of any pre-existing
 *     `bid_responses` and `bid_response_history` rows for the chosen
 *     question id, so each test starts from "no draft yet".
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - SSE handler opens a stream and emits zero chunks (silent failure
 *     in `use-draft-stream.ts` or upstream Anthropic call) → caught by
 *     chunk-count >= 1 assertion.
 *   - SSE handler 500s mid-stream but UI shows "saved" → caught by
 *     status === 200 + non-empty DB assertion.
 *   - Stream output rendered in UI but never persisted → caught by
 *     DB `response_text` non-empty assertion.
 *   - DB persisted but UI shows empty editor (state-sync regression) →
 *     caught by editor non-empty assertion.
 *   - History row never written, breaking 8.0.8's restore path → caught
 *     by `bid_response_history` row assertion.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: drafting is a
 *   write operation; admin is the canonical happy path. Editor draft is
 *   functionally identical at the API layer.
 *
 * CLEANUP:
 *   afterEach: service-key delete of any `bid_responses` and
 *   `bid_response_history` rows for the targeted question id. The
 *   worker bid itself is owned by the worker fixture and not deleted
 *   here.
 */

/**
 * WP2 Phase 1 spec — 8.0.8 bid regenerate + restore
 *
 * USER FLOW:
 *   1. Pre-condition: 8.0.7 happy path has run (or is reproduced inline
 *      in `beforeEach` for this test) — there is a `bid_responses` v1 row
 *      for `questionIds[0]` with known content. Capture the v1 text as
 *      `originalText` via service-key query before any UI action.
 *   2. As admin (authenticatedPage), navigate to `/bid/<bidId>/session`.
 *   3. Click the "Regenerate" / "Re-draft" control on the question card.
 *   4. Wait for the SSE stream to complete (same `waitForResponse`
 *      pattern as 8.0.7).
 *   5. Capture the new editor text as `regeneratedText`.
 *   6. Open the version history drawer / panel for that response.
 *   7. Click "Restore" on the v1 entry.
 *   8. Wait for the restore API call to complete (`waitForResponse` on
 *      the restore endpoint).
 *   9. Read the editor text again as `restoredText`.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - After regenerate: `regeneratedText !== originalText` (proves the
 *     regenerate actually produced new content; not a no-op caching bug).
 *   - After regenerate: a NEW row exists in `bid_response_history` with
 *     `version === 1` capturing the original text, AND the active
 *     `bid_responses.version` is now 2 with the regenerated content.
 *   - After regenerate: the OLD content is preserved in
 *     `bid_response_history` exactly equal to `originalText` (string
 *     equality — proves history is a real snapshot, not a stub).
 *   - After restore: `restoredText === originalText` in the editor.
 *   - After restore: `bid_responses.response_text` in DB equals
 *     `originalText` (proves restore wrote back to the live row, not
 *     just to client state).
 *   - After restore: `bid_responses.version` is incremented again (e.g.
 *     to v3) so that the regenerated v2 is itself preserved in history —
 *     restore is a forward-only revert, not a destructive rollback.
 *     (If the production code instead implements destructive rollback,
 *     Phase 3 must update this assertion to match — flag in verification.)
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - Same `workerData.bidId` + `workerData.questionIds[0]` as 8.0.7.
 *   - `beforeEach` produces the v1 draft (either by re-running 8.0.7's
 *     flow or by direct service-key insert into `bid_responses` +
 *     `bid_response_history` with deterministic content). Direct seeding
 *     is preferred because it removes flakiness from upstream LLM calls.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Regenerate overwrites the `bid_responses` row WITHOUT writing a
 *     history snapshot → caught by `bid_response_history` row + content
 *     equality assertion.
 *   - Regenerate is a no-op and returns the same text → caught by
 *     `regeneratedText !== originalText` assertion.
 *   - Restore button is wired to a no-op handler (UI updates client
 *     state but never PATCHes the row) → caught by DB `response_text`
 *     equality assertion after restore.
 *   - Restore wipes the regenerated v2 from history (loses work) →
 *     caught by version-increment + history-row-count assertions.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: regenerate and
 *   restore are write operations; admin is the canonical path.
 *
 * CLEANUP:
 *   afterEach: service-key delete of all `bid_responses` and
 *   `bid_response_history` rows for the targeted question id, restoring
 *   the empty state for the next test. Worker bid is preserved.
 */
