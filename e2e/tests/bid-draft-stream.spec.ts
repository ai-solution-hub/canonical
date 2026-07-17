/**
 * WP2 Phase 1 spec — 8.0.7 bid draft-stream happy path
 *
 * VERIFIED AGAINST PRODUCTION (Phase 2 adversarial review; table names
 * corrected {128.12} — the pre-rename bid-prefixed response/response-history
 * tables were renamed to `form_responses`/`form_response_history` under
 * migration 20260609185728, squashed into 20260617130000_squash_baseline.sql):
 *   - `form_response_history` table EXISTS with `response_text`,
 *     `response_text_advanced`, and `version` columns (verified against
 *     the `form_response_history` Row type in
 *     `supabase/types/database.types.ts`). Spec table name is correct
 *     (post-rename).
 *   - The bid session route `/procurement/[id]/session` exists at
 *     `app/procurement/[id]/session/page.tsx`.
 *   - Draft-stream endpoint exists at
 *     `app/api/procurement/[id]/responses/draft-stream/route.ts`. It 400s
 *     ("must be drafting or later") unless the item's workflow_state is
 *     drafting/in_review/ready_for_export — the beforeEach state guard
 *     below keeps the worker bid in a draftable state.
 *   - Restore endpoint exists at
 *     `app/api/procurement/[id]/responses/[rId]/restore/route.ts` and updates
 *     `form_responses` (a DB trigger snapshots the previous version into
 *     `form_response_history` with the next version number — confirmed
 *     forward-only revert).
 *
 * USER FLOW:
 *   1. Use the worker-seeded bid (`workerData.procurementId`) and one of its
 *      questions (`workerData.questionIds[0]`). The worker fixture
 *      already advances the bid to the `drafting` state, so the editor
 *      view is reachable.
 *   2. `beforeEach`: defensive service-key delete of any pre-existing
 *      `form_responses` AND `form_response_history` rows for the chosen
 *      question id, so each test starts from a known empty state.
 *   3. As admin (authenticatedPage), navigate to `/procurement/<procurementId>/session`.
 *   4. Locate the question card for `questionIds[0]`.
 *   5. Attach a `page.on('response', ...)` listener BEFORE clicking, to
 *      capture the SSE endpoint response object so we can later assert at
 *      least one streaming chunk was received and the final status code.
 *   6. Click the "Draft with AI" / "Draft response" button.
 *   7. Use `page.waitForResponse(<sse url predicate>)` to wait for the
 *      stream endpoint to FINISH. NOT a fixed timeout.
 *   8. Wait for the editor textarea / rich text region for that question
 *      to contain non-empty content.
 *   9. Service-key query `form_responses` for the question id and capture
 *      `response_text`, `version`, and `id`. Then service-key query
 *      `form_response_history` for the same `response_id`.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - The SSE endpoint emitted at least one non-empty data chunk during
 *     the stream (chunk count >= 1 AND total streamed bytes > 0). Phase 3
 *     implementer accumulates chunks via the `response` listener.
 *   - The SSE response completed with HTTP status 200 (NOT 500 mid-stream).
 *   - `form_responses` row exists for the question id with non-empty
 *     `response_text` AND `version === 1` (or whatever the production
 *     code's initial version value is — Phase 3 verifies; the assertion
 *     must be exact equality, NOT `version >= 1`, so a regression that
 *     skips version-tracking is caught).
 *   - The drafted text rendered in the UI EQUALS the DB-stored
 *     `response_text` (string equality, not just substring; if the UI
 *     applies trimming/normalisation, Phase 3 normalises both sides
 *     before comparing). Proves the stream output and the persisted
 *     content are the same payload, not two divergent paths.
 *   - The `form_response_history` query for this `response_id` returns
 *     either zero rows (if the trigger only snapshots on UPDATE, not
 *     INSERT) OR one row with `version === 1`. Phase 3 must inspect the
 *     trigger definition in `supabase/migrations/` and pin the expected
 *     count BEFORE writing the assertion — the assertion must be exact
 *     count equality, not `>= 0`. The spec passes either way, but the
 *     EXACT count is what catches regressions in 8.0.8.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - `workerData.procurementId` (advanced to drafting) and
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
 *   afterEach: service-key delete of any `form_responses` and
 *   `form_response_history` rows for the targeted question id. The
 *   worker bid itself is owned by the worker fixture and not deleted
 *   here.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock the SSE endpoint or the Anthropic streaming client.
 *     The whole point is to exercise the real stream + real persistence.
 *   - DO NOT pre-seed a `form_responses` row in `beforeEach` — that
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
 *   - Restore route at
 *     `app/api/procurement/[id]/responses/[rId]/restore/route.ts`
 *     UPDATEs `form_responses` with the historical row's `response_text`
 *     and `response_text_advanced`. The DB trigger then snapshots the
 *     pre-update version into `form_response_history`. This is a
 *     forward-only revert: restoring v1 over v2 produces a v3 row and
 *     preserves v2 in history.
 *   - Regenerate route at
 *     `app/api/procurement/[id]/responses/[rId]/regenerate/route.ts` likewise
 *     UPDATEs the row, triggering a snapshot.
 *
 * USER FLOW:
 *   1. Pre-condition: 8.0.7 happy path has run (or is reproduced inline
 *      in `beforeEach`) — there is a `form_responses` v1 row for
 *      `questionIds[0]` with known content. Capture v1 text as
 *      `originalText` AND v1 numeric `version` AND the response `id` via
 *      service-key query BEFORE any UI action. Direct service-key seed
 *      is preferred over re-running 8.0.7 because it removes flakiness
 *      from upstream LLM calls.
 *   2. As admin (authenticatedPage), navigate to `/procurement/<procurementId>/session`.
 *   3. Click the "Regenerate" / "Re-draft" control on the question card.
 *   4. Wait for the SSE stream to complete (same `waitForResponse`
 *      pattern as 8.0.7).
 *   5. Capture the new editor text as `regeneratedText`.
 *   6. Service-key query `form_responses` and `form_response_history`,
 *     capture the new active version and the snapshot row(s).
 *   7. Open the version history drawer / panel for that response.
 *   8. Click "Restore" on the v1 entry.
 *   9. Wait for the restore API call to complete (`waitForResponse` on
 *      `/api/procurement/<id>/responses/<rId>/restore`).
 *   10. Read the editor text again as `restoredText`.
 *   11. Service-key query `form_responses` AND `form_response_history`
 *       again to capture the post-restore state.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - After regenerate: `regeneratedText !== originalText` (proves the
 *     regenerate actually produced new content; not a no-op caching bug).
 *   - After regenerate: a NEW row exists in `form_response_history` with
 *     `version === 1` whose `response_text` equals `originalText` (string
 *     equality — proves history is a real snapshot of the original, not
 *     a stub).
 *   - After regenerate: `form_responses.version` is now 2 (or whatever
 *     the next version value is per the production trigger — Phase 3
 *     pins exact equality, NOT `> 1`).
 *   - After regenerate: `form_responses.response_text === regeneratedText`
 *     (UI and DB agree; not two divergent paths).
 *   - After restore: `restoredText === originalText` in the editor
 *     (string equality after the same normalisation as 8.0.7).
 *   - After restore: `form_responses.response_text === originalText`
 *     in DB (proves restore wrote back to the live row, not just to
 *     client state).
 *   - After restore: `form_responses.version` has incremented again (e.g.
 *     to v3) so that the regenerated v2 is itself preserved in history —
 *     restore is forward-only, not a destructive rollback.
 *   - After restore: `form_response_history` contains BOTH v1 (with
 *     `originalText`) AND v2 (with `regeneratedText`). Phase 3 asserts
 *     a row count of >= 2 AND asserts the v2 row's `response_text`
 *     equals `regeneratedText` (string equality).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - Same `workerData.procurementId` + `workerData.questionIds[0]` as 8.0.7.
 *   - `beforeEach`: direct service-key insert into `form_responses`
 *     with deterministic `response_text` (the `originalText` value),
 *     `version = 1`, and the question id. NO history row needs to be
 *     manually inserted — the regenerate UPDATE will trigger the
 *     snapshot.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Regenerate overwrites the `form_responses` row WITHOUT triggering
 *     a history snapshot (e.g. trigger disabled or bypassed) → caught
 *     by `form_response_history` row + content equality assertions.
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
 *   afterEach: service-key delete of all `form_responses` and
 *   `form_response_history` rows for the targeted question id, restoring
 *   the empty state for the next test. Worker bid is preserved.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock `/api/procurement/.../regenerate` or `/api/procurement/.../restore`.
 *     The DB trigger behaviour is the load-bearing thing being tested.
 *   - DO NOT seed `form_response_history` directly in `beforeEach`. The
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

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import { advanceBidState } from '../helpers/data-factory';

/**
 * Normalise text for cross-source equality comparisons.
 * Strips HTML tags AND markdown syntax, collapses whitespace, trims.
 * Used to compare DB-stored markdown to editor-rendered HTML innerText —
 * ProseMirror renders markdown as HTML, so the editor's textContent loses
 * `#`, `**`, `*`, backticks, etc. We strip the same on the DB side before
 * comparing so the equality assertion tests PAYLOAD identity, not rendering
 * choices.
 */
function normaliseText(input: string): string {
  // Lowercase alphanumeric-only fingerprint. Eliminates markdown syntax,
  // HTML tag artefacts, whitespace variance, curly-quote substitution, list
  // bullets, and punctuation — but still proves the actual content bytes
  // (letters + digits, in order) are identical across DB and editor. A
  // regenerate stub returning an empty string or different text will change
  // the fingerprint; cosmetic rendering differences will not.
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Route paths live under /api/procurement (ID-145 {145.21} re-key; the
// pre-rename /api/bids/* paths no longer exist — a predicate keyed on them
// never matches and starves waitForResponse to its full timeout).
const SSE_URL_PATH_RE =
  /\/api\/procurement\/[0-9a-f-]{36}\/responses\/draft-stream$/;
const RESTORE_URL_PATH_RE =
  /\/api\/procurement\/[0-9a-f-]{36}\/responses\/[0-9a-f-]{36}\/restore$/;
const REGENERATE_URL_PATH_RE =
  /\/api\/procurement\/[0-9a-f-]{36}\/responses\/[0-9a-f-]{36}\/regenerate$/;

// ---------------------------------------------------------------------------
// Defensive cleanup helpers (shared between 8.0.7 and 8.0.8)
// ---------------------------------------------------------------------------

async function clearResponsesForQuestion(questionId: string): Promise<void> {
  const supabase = createServiceClient();
  // Resolve any response ids first (so we can clear history rows that
  // would otherwise be orphaned by ON DELETE CASCADE — belt and braces).
  const { data: existing } = await supabase
    .from('form_responses')
    .select('id')
    .eq('question_id', questionId);
  const ids = (existing ?? []).map((r: { id: string }) => r.id);
  if (ids.length > 0) {
    await supabase
      .from('form_response_history')
      .delete()
      .in('response_id', ids);
    await supabase.from('form_responses').delete().in('id', ids);
  }
}

// ---------------------------------------------------------------------------
// 8.0.7 — bid draft-stream happy path
// ---------------------------------------------------------------------------

test.describe('Procurement draft-stream happy path (8.0.7)', () => {
  test.beforeEach(async ({ workerData }) => {
    // State guard: draft-stream 400s ("must be drafting or later") unless
    // workflow_state is drafting/in_review/ready_for_export. The worker
    // fixture already advances the bid to 'drafting'; this is a no-op when
    // already at/past drafting and protects against seed drift so a state
    // regression fails fast at the 200 assertion instead of starving.
    await advanceBidState(workerData.procurementId, 'drafting');
    // Defensive: ensure questionIds[0] starts with NO form_responses and NO
    // history rows. The worker fixture seeds responses for questions[0..1];
    // we delete them here so the test exercises the create-from-empty path
    // through draft-stream.
    await clearResponsesForQuestion(workerData.questionIds[0]);
  });

  test.afterEach(async ({ workerData }) => {
    try {
      await clearResponsesForQuestion(workerData.questionIds[0]);
    } catch (err) {
      console.error('8.0.7 cleanup failed:', err);
    }
  });

  test('Regenerate streams a new draft, persists to DB, renders in editor', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Pass 1 + Pass 2 (streamed) + Pass 3 against the live Anthropic API
    // routinely take 60-120s (route maxDuration = 120). The default 30s
    // test timeout fires before the SSE stream completes, masking the
    // assertions. Budget: 60s header wait + up-to-120s streaming body +
    // DB polls, with headroom.
    test.setTimeout(240000);
    const supabase = createServiceClient();
    const questionId = workerData.questionIds[0];

    // 1. Open the bid session page (defaults to currentIndex = 0 → questionIds[0])
    await page.goto(`/procurement/${workerData.procurementId}/session`);

    // Wait for the response editor area to mount.
    await expect(
      page
        .getByRole('region', { name: 'Response editor' })
        .or(page.locator('main[aria-label="Response editor"]')),
    ).toBeVisible({ timeout: 15000 });

    // The "Redraft" button is the entry point for both creating from
    // empty AND for re-drafting. Clicking it reveals a "Redraft
    // instructions" textbox and swaps the button label to "Send"; only the
    // Send click dispatches the draft-stream POST. Confirmed at
    // components/bid/response-editor-toolbar.tsx (two-phase action).
    // (Internal action name is still 'regenerate'; user-facing label was
    // renamed in P1-12.)
    const regenerateButton = page.getByRole('button', { name: /^Redraft$/ });
    await expect(regenerateButton).toBeVisible({ timeout: 15000 });
    await regenerateButton.click();

    const sendButton = page.getByRole('button', { name: /^Send$/ });
    await expect(sendButton).toBeVisible({ timeout: 5000 });

    // 2. Attach response listener BEFORE the Send click. We'll capture the
    //    SSE response so we can read its body (full stream) and inspect
    //    chunks. The predicate matches on URL only (any status) — a 400
    //    from the workflow-state gate resolves the wait immediately and
    //    fails the status assertion below with the response body, rather
    //    than starving the wait. waitForResponse resolves on HEADERS,
    //    which the SSE route sends as soon as the stream opens, so 60s is
    //    a generous bound (the up-to-120s streaming body is awaited
    //    separately via body()).
    const ssePromise = page.waitForResponse(
      (resp) => SSE_URL_PATH_RE.test(new URL(resp.url()).pathname),
      { timeout: 60000 },
    );

    // 3. Click Send to actually start the draft stream.
    await sendButton.click();

    // 4. Wait for the SSE response object — note: this resolves on headers,
    //    so we then await body() to wait for stream completion.
    const sseResponse = await ssePromise;

    // ASSERTION: SSE handler returned HTTP 200 (NOT 500, and NOT the 400
    // workflow-state refusal). Surface the response body on failure so the
    // CI log carries the server's reason verbatim.
    if (sseResponse.status() !== 200) {
      const errBody = await sseResponse.text().catch(() => '<unreadable>');
      throw new Error(
        `draft-stream returned HTTP ${sseResponse.status()}: ${errBody}`,
      );
    }

    // body() blocks until the SSE stream finishes.
    const bodyBuf = await sseResponse.body();
    const bodyText = bodyBuf.toString('utf-8');

    // ASSERTION: at least one non-empty data chunk was emitted (real
    // streaming, not a zero-chunk silent failure).
    const tokenEventCount = (bodyText.match(/^event: token$/gm) ?? []).length;
    expect(
      tokenEventCount,
      'SSE stream must emit at least one token event',
    ).toBeGreaterThanOrEqual(1);
    expect(
      bodyBuf.length,
      'SSE stream body must contain bytes',
    ).toBeGreaterThan(0);

    // 5. Wait for the editor to render non-empty content. Use the main
    //    Response editor region to scope to the single bid-response editor
    //    (there are other ProseMirror instances elsewhere on the page).
    const editor = page
      .locator('main[aria-label="Response editor"] .ProseMirror')
      .first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    // 6. Poll form_responses until a row exists AND has a done-state
    //    response_text (the stream writes via upsert on `done`). The SSE
    //    body() resolved above, so this should be immediate — but poll
    //    defensively for up to 10s in case of DB lag.
    let responseRow: {
      id: string;
      response_text: string | null;
      version: number | null;
    } | null = null;
    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('form_responses')
            .select('id, response_text, version')
            .eq('question_id', questionId);
          if (
            data &&
            data.length === 1 &&
            (data[0].response_text ?? '').length > 20
          ) {
            responseRow = data[0];
            return 'ready';
          }
          return 'waiting';
        },
        { timeout: 15000, message: 'form_responses row must be written' },
      )
      .toBe('ready');
    expect(responseRow, 'responseRow set by poll').not.toBeNull();
    const row = responseRow!;

    // ASSERTION: response_text is non-empty
    expect(
      (row.response_text ?? '').length,
      'response_text must be non-empty',
    ).toBeGreaterThan(20);

    // ASSERTION: version === 1 exactly (not >= 1) — catches version-tracking
    // regressions where the trigger sets a wrong initial value.
    expect(row.version).toBe(1);

    // 7. Poll editor text until it exactly matches the DB response_text
    //    (under alphanumeric normalisation).
    //
    //    S152B WP14 #16 removed `CharacterCount.limit` from the Tiptap
    //    config in `components/bid/response-editor.tsx`, which eliminated
    //    the silent front-truncation path. The editor now renders the full
    //    streamed text verbatim, so this assertion can require strict
    //    equality rather than a "non-trivial suffix" match. The tightened
    //    assertion catches regressions of the #16 fix as well as any new
    //    DB/editor divergence.
    const expectedNormalised = normaliseText(row.response_text ?? '');
    let lastActual = '';
    await expect
      .poll(
        async () => {
          lastActual = normaliseText((await editor.textContent()) ?? '');
          if (lastActual.length < 500) return 'short';
          if (lastActual !== expectedNormalised) return 'mismatch';
          return 'ok';
        },
        {
          timeout: 30000,
          message: 'editor text must exactly match DB response_text',
        },
      )
      .toBe('ok');

    // ASSERTION: form_response_history has EXACTLY 0 rows for this response.
    // The trigger only snapshots on UPDATE (verified at
    // supabase/migrations/...security_performance_fixes.sql:2197 — the
    // snapshot function is wired BEFORE UPDATE only, not BEFORE INSERT).
    const { count: historyCount, error: histErr } = await supabase
      .from('form_response_history')
      .select('*', { count: 'exact', head: true })
      .eq('response_id', row.id);
    if (histErr) throw histErr;
    expect(
      historyCount,
      'history table must have 0 rows for a freshly-inserted response',
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8.0.8 — bid regenerate + restore
// ---------------------------------------------------------------------------

test.describe('Procurement regenerate + restore (8.0.8)', () => {
  // Deterministic original text seeded directly into form_responses.
  // Phrased so a re-draft against matched content WILL produce a different
  // string (catches the no-op regenerate failure mode).
  const ORIGINAL_TEXT =
    '[E2E-WP2-8.0.8] Original seeded response text. This sentence is intentionally distinctive so the regenerate path produces a clearly different output.';

  test.beforeEach(async ({ workerData }) => {
    const supabase = createServiceClient();
    // State guard — same rationale as 8.0.7: regenerate requires a
    // draftable workflow_state; no-op when the fixture already advanced
    // the bid to 'drafting'.
    await advanceBidState(workerData.procurementId, 'drafting');
    await clearResponsesForQuestion(workerData.questionIds[0]);
    // Seed a v1 row directly. Note: source_content_ids is left as the
    // worker bid's matched_content_ids (or empty) — regenerate route
    // re-fetches the question's matched content.
    await supabase
      .from('form_responses')
      .insert({
        question_id: workerData.questionIds[0],
        response_text: ORIGINAL_TEXT,
        review_status: 'draft',
        // version is set by the BEFORE INSERT trigger to 1 regardless.
      })
      .throwOnError();
  });

  test.afterEach(async ({ workerData }) => {
    try {
      await clearResponsesForQuestion(workerData.questionIds[0]);
    } catch (err) {
      console.error('8.0.8 cleanup failed:', err);
    }
  });

  test('Regenerate creates a v2 snapshot, then restore brings v1 forward as v3', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Regenerate exercises the live Anthropic API (120s inner
    // waitForResponse, matching the route's maxDuration). The default 30s
    // test timeout fires long before completion. Bump above the inner
    // timeout to give the regen + restore + DB polls headroom.
    test.setTimeout(300000);
    const supabase = createServiceClient();
    const questionId = workerData.questionIds[0];

    // Capture original state from DB.
    const { data: seedRows, error: seedErr } = await supabase
      .from('form_responses')
      .select('id, response_text, version')
      .eq('question_id', questionId);
    if (seedErr) throw seedErr;
    expect(seedRows && seedRows.length, 'seed row exists').toBe(1);
    const responseId = seedRows![0].id;
    expect(seedRows![0].version).toBe(1);
    expect(seedRows![0].response_text).toBe(ORIGINAL_TEXT);
    const originalText = seedRows![0].response_text!;

    // 1. Open the session page.
    await page.goto(`/procurement/${workerData.procurementId}/session`);
    await expect(
      page
        .getByRole('region', { name: 'Response editor' })
        .or(page.locator('main[aria-label="Response editor"]')),
    ).toBeVisible({ timeout: 15000 });

    // The seeded original should appear in the editor.
    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => normaliseText((await editor.textContent()) ?? ''), {
        timeout: 30000,
        message: 'editor must reflect seeded original',
      })
      .toContain(normaliseText('intentionally distinctive'));

    // 2. Click Redraft. With an existing row, this routes through the
    //    /regenerate endpoint (NOT /draft-stream) because the action handler
    //    branches on response?.id existence. (Internal action name is still
    //    'regenerate'; user-facing label was renamed in P1-12.)
    const regenerateButton = page.getByRole('button', { name: /^Redraft$/ });
    await expect(regenerateButton).toBeVisible();

    // Click once to reveal the instructions input, then again to send.
    await regenerateButton.click();
    // The button label switches to "Send" once the input is shown.
    const sendButton = page.getByRole('button', { name: /^Send$/ });
    await expect(sendButton).toBeVisible({ timeout: 5000 });

    // Unlike the SSE route, regenerate is a plain JSON POST whose response
    // only arrives after the full multi-pass LLM work — legitimately up to
    // the route's maxDuration (120s). Bound the wait at exactly that (down
    // from the old 180s starvation window): an error status resolves the
    // predicate immediately (URL+method match, any status), so a genuine
    // failure still fails fast at the status assertion below.
    const regenPromise = page.waitForResponse(
      (resp) =>
        REGENERATE_URL_PATH_RE.test(new URL(resp.url()).pathname) &&
        resp.request().method() === 'POST',
      { timeout: 120000 },
    );
    await sendButton.click();
    const regenResponse = await regenPromise;
    if (regenResponse.status() !== 200) {
      const errBody = await regenResponse.text().catch(() => '<unreadable>');
      throw new Error(
        `regenerate returned HTTP ${regenResponse.status()}: ${errBody}`,
      );
    }

    // Wait for DB to reflect v2 — the regenerate POST returned 200, but
    // the client-side mutation return and the DB commit can race.
    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from('form_responses')
            .select('version')
            .eq('id', responseId)
            .single();
          return data?.version ?? null;
        },
        { timeout: 10000, message: 'DB must reach version 2 after regen' },
      )
      .toBe(2);

    // Poll the editor until it reflects the regenerated content. The
    // S152B WP14 #17/#18 fix (normalised-HTML comparison in
    // `use-stream-coordination.ts`) now propagates server-side updates
    // into the editor without requiring a reload or navigate-away dance.
    // The previous version of this test reloaded the page and navigated
    // away-and-back to work around the sync-guard bug; that workaround
    // has been removed now that the fix is in place.
    await expect
      .poll(
        async () => {
          const text = normaliseText((await editor.textContent()) ?? '');
          if (text.length < 100) return 'empty';
          if (text === normaliseText(originalText)) return 'original';
          return 'regenerated';
        },
        {
          timeout: 30000,
          message:
            'editor must reflect regenerated text within 30s of POST 200',
        },
      )
      .toBe('regenerated');

    const regeneratedText = (await editor.textContent()) ?? '';

    // ASSERTION: regenerated text is different from original (catches no-op)
    expect(normaliseText(regeneratedText)).not.toBe(
      normaliseText(originalText),
    );

    // Refetch DB state.
    const { data: postRegenRows, error: prErr } = await supabase
      .from('form_responses')
      .select('id, response_text, version')
      .eq('id', responseId)
      .single();
    if (prErr) throw prErr;

    // ASSERTION: version === 2 exactly
    expect(postRegenRows.version).toBe(2);
    // ASSERTION: editor text fully matches DB content.
    // The S152B WP14 #16 fix (removed `CharacterCount.limit`) eliminated
    // the Tiptap front-truncation path, so the editor now renders the full
    // `response_text` verbatim. Previously this asserted only that the
    // editor was a non-trivial suffix of the DB text (to tolerate the
    // front-truncation); the tightened equality assertion catches any
    // regression of that fix as well as any new DB/editor divergence.
    const regeneratedNorm = normaliseText(regeneratedText);
    const postRegenDbNorm = normaliseText(postRegenRows.response_text ?? '');
    expect(regeneratedNorm.length).toBeGreaterThan(500);
    expect(regeneratedNorm).toBe(postRegenDbNorm);

    // ASSERTION: history has exactly one row, version=1, content=originalText
    const { data: hist1, error: h1Err } = await supabase
      .from('form_response_history')
      .select('version, response_text')
      .eq('response_id', responseId)
      .order('version', { ascending: true });
    if (h1Err) throw h1Err;
    expect(hist1).toHaveLength(1);
    expect(hist1![0].version).toBe(1);
    expect(hist1![0].response_text).toBe(originalText);

    // 3. Open version history and click Restore on v1.
    // The button shows "History v{version}" as text content, with a
    // `title="View version history"` for tooltip — so the accessible
    // name is the text content ("History v2"), NOT the title. Locate
    // via `getByTitle` (reliable against the stable title attribute)
    // rather than `getByRole` + name regex, which would need to match
    // the dynamic version number in the text content.
    const historyButton = page.getByTitle('View version history');
    await expect(historyButton).toBeVisible();
    await historyButton.click();

    // Wait for the version history sheet/list.
    const historyList = page.getByRole('list', { name: 'Version history' });
    await expect(historyList).toBeVisible({ timeout: 10000 });

    // Click "Restore version 1" button.
    const restoreV1Button = page.getByRole('button', {
      name: 'Restore version 1',
    });
    await expect(restoreV1Button).toBeVisible({ timeout: 10000 });
    await restoreV1Button.click();

    // Confirm in the AlertDialog.
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    const restorePromise = page.waitForResponse(
      (resp) =>
        RESTORE_URL_PATH_RE.test(new URL(resp.url()).pathname) &&
        resp.request().method() === 'POST',
      { timeout: 30000 },
    );
    await confirmDialog.getByRole('button', { name: /^Restore$/ }).click();
    const restoreResponse = await restorePromise;
    expect(
      restoreResponse.status(),
      'Restore endpoint must return HTTP 200',
    ).toBe(200);

    // Poll the editor until it reflects the restored original text.
    // Same as the regenerate block above, the S152B WP14 #17/#18 fix
    // means no reload is needed — the server-side update propagates
    // through the sync effect automatically.
    await expect(editor).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => normaliseText((await editor.textContent()) ?? ''), {
        timeout: 30000,
        message: 'editor must reflect restored original text within 30s',
      })
      .toBe(normaliseText(originalText));

    const restoredText = (await editor.textContent()) ?? '';

    // ASSERTION: editor text equals original
    expect(normaliseText(restoredText)).toBe(normaliseText(originalText));

    // Refetch DB.
    const { data: postRestoreRow, error: prrErr } = await supabase
      .from('form_responses')
      .select('id, response_text, version')
      .eq('id', responseId)
      .single();
    if (prrErr) throw prrErr;

    // ASSERTION: DB response_text equals original
    expect(postRestoreRow.response_text).toBe(originalText);

    // ASSERTION: version === 3 exactly (forward-only, NOT a destructive
    // rollback to 1). The restore UPDATE incremented v2 → v3 and snapshotted
    // v2 into history.
    expect(postRestoreRow.version).toBe(3);

    // ASSERTION: history now contains BOTH v1 AND v2, with the v2 row
    // carrying the regenerated text (proves the snapshot of the
    // pre-restore state actually persisted — work was preserved).
    const { data: hist2, error: h2Err } = await supabase
      .from('form_response_history')
      .select('version, response_text')
      .eq('response_id', responseId)
      .order('version', { ascending: true });
    if (h2Err) throw h2Err;
    expect(hist2 && hist2.length).toBeGreaterThanOrEqual(2);
    const v1Row = hist2!.find((r: { version: number }) => r.version === 1);
    const v2Row = hist2!.find((r: { version: number }) => r.version === 2);
    expect(v1Row, 'v1 row in history').toBeTruthy();
    expect(v2Row, 'v2 row in history').toBeTruthy();
    expect(v1Row!.response_text).toBe(originalText);
    expect(normaliseText(v2Row!.response_text ?? '')).toBe(
      normaliseText(regeneratedText),
    );
  });
});
