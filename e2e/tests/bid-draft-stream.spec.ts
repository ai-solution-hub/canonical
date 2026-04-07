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

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Normalise text for cross-source equality comparisons.
 * Strips HTML tags, collapses whitespace, trims.
 * Used to compare DB-stored markdown to editor-rendered HTML innerText.
 */
function normaliseText(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SSE_URL_PATH_RE = /\/api\/bids\/[0-9a-f-]{36}\/responses\/draft-stream$/;
const RESTORE_URL_PATH_RE =
  /\/api\/bids\/[0-9a-f-]{36}\/responses\/[0-9a-f-]{36}\/restore$/;
const REGENERATE_URL_PATH_RE =
  /\/api\/bids\/[0-9a-f-]{36}\/responses\/[0-9a-f-]{36}\/regenerate$/;

// ---------------------------------------------------------------------------
// Defensive cleanup helpers (shared between 8.0.7 and 8.0.8)
// ---------------------------------------------------------------------------

async function clearResponsesForQuestion(questionId: string): Promise<void> {
  const supabase = createServiceClient();
  // Resolve any response ids first (so we can clear history rows that
  // would otherwise be orphaned by ON DELETE CASCADE — belt and braces).
  const { data: existing } = await supabase
    .from('bid_responses')
    .select('id')
    .eq('question_id', questionId);
  const ids = (existing ?? []).map((r: { id: string }) => r.id);
  if (ids.length > 0) {
    await supabase.from('bid_response_history').delete().in('response_id', ids);
    await supabase.from('bid_responses').delete().in('id', ids);
  }
}

// ---------------------------------------------------------------------------
// 8.0.7 — bid draft-stream happy path
// ---------------------------------------------------------------------------

test.describe('Bid draft-stream happy path (8.0.7)', () => {
  test.beforeEach(async ({ workerData }) => {
    // Defensive: ensure questionIds[0] starts with NO bid_responses and NO
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
    const supabase = createServiceClient();
    const questionId = workerData.questionIds[0];

    // 1. Open the bid session page (defaults to currentIndex = 0 → questionIds[0])
    await page.goto(`/bid/${workerData.bidId}/session`);

    // Wait for the response editor area to mount.
    await expect(
      page.getByRole('region', { name: 'Response editor' }).or(
        page.locator('main[aria-label="Response editor"]'),
      ),
    ).toBeVisible({ timeout: 15000 });

    // The "Regenerate" button is the entry point for both creating from
    // empty AND for re-drafting. With NO existing response, clicking it
    // calls stream.startDraft (which POSTs to draft-stream).
    const regenerateButton = page.getByRole('button', { name: /^Regenerate$/ });
    await expect(regenerateButton).toBeVisible({ timeout: 15000 });

    // 2. Attach response listener BEFORE click. We'll capture the SSE
    //    response so we can read its body (full stream) and inspect chunks.
    const ssePromise = page.waitForResponse(
      (resp) => SSE_URL_PATH_RE.test(new URL(resp.url()).pathname),
      { timeout: 120000 },
    );

    // 3. Click Regenerate to start the draft stream.
    await regenerateButton.click();

    // 4. Wait for the SSE response object — note: this resolves on headers,
    //    so we then await body() to wait for stream completion.
    const sseResponse = await ssePromise;

    // ASSERTION: SSE handler returned HTTP 200 (NOT 500 mid-stream)
    expect(
      sseResponse.status(),
      'SSE endpoint must return HTTP 200',
    ).toBe(200);

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

    // 5. Wait for the editor to render non-empty content.
    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await expect
      .poll(
        async () => ((await editor.textContent()) ?? '').trim().length,
        { timeout: 30000, message: 'editor must contain drafted content' },
      )
      .toBeGreaterThan(20);

    const editorText = (await editor.textContent()) ?? '';

    // 6. Service-key query bid_responses for question id.
    const { data: responseRows, error: respErr } = await supabase
      .from('bid_responses')
      .select('id, response_text, version')
      .eq('question_id', questionId);
    if (respErr) throw respErr;
    expect(
      responseRows && responseRows.length,
      'bid_responses row must exist for the question',
    ).toBe(1);
    const responseRow = responseRows![0];

    // ASSERTION: response_text is non-empty
    expect(
      (responseRow.response_text ?? '').length,
      'response_text must be non-empty',
    ).toBeGreaterThan(20);

    // ASSERTION: version === 1 exactly (not >= 1) — catches version-tracking
    // regressions where the trigger sets a wrong initial value.
    expect(responseRow.version).toBe(1);

    // ASSERTION: editor-rendered text equals DB-stored text after
    // normalisation (UI and DB are the same payload, not divergent paths).
    expect(normaliseText(editorText)).toBe(
      normaliseText(responseRow.response_text ?? ''),
    );

    // ASSERTION: bid_response_history has EXACTLY 0 rows for this response.
    // The trigger only snapshots on UPDATE (verified at
    // supabase/migrations/...security_performance_fixes.sql:2197 — the
    // snapshot function is wired BEFORE UPDATE only, not BEFORE INSERT).
    const { count: historyCount, error: histErr } = await supabase
      .from('bid_response_history')
      .select('*', { count: 'exact', head: true })
      .eq('response_id', responseRow.id);
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

test.describe('Bid regenerate + restore (8.0.8)', () => {
  // Deterministic original text seeded directly into bid_responses.
  // Phrased so a re-draft against matched content WILL produce a different
  // string (catches the no-op regenerate failure mode).
  const ORIGINAL_TEXT =
    '[E2E-WP2-8.0.8] Original seeded response text. This sentence is intentionally distinctive so the regenerate path produces a clearly different output.';

  test.beforeEach(async ({ workerData }) => {
    const supabase = createServiceClient();
    await clearResponsesForQuestion(workerData.questionIds[0]);
    // Seed a v1 row directly. Note: source_content_ids is left as the
    // worker bid's matched_content_ids (or empty) — regenerate route
    // re-fetches the question's matched content.
    await supabase
      .from('bid_responses')
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
    const supabase = createServiceClient();
    const questionId = workerData.questionIds[0];

    // Capture original state from DB.
    const { data: seedRows, error: seedErr } = await supabase
      .from('bid_responses')
      .select('id, response_text, version')
      .eq('question_id', questionId);
    if (seedErr) throw seedErr;
    expect(seedRows && seedRows.length, 'seed row exists').toBe(1);
    const responseId = seedRows![0].id;
    expect(seedRows![0].version).toBe(1);
    expect(seedRows![0].response_text).toBe(ORIGINAL_TEXT);
    const originalText = seedRows![0].response_text!;

    // 1. Open the session page.
    await page.goto(`/bid/${workerData.bidId}/session`);
    await expect(
      page.getByRole('region', { name: 'Response editor' }).or(
        page.locator('main[aria-label="Response editor"]'),
      ),
    ).toBeVisible({ timeout: 15000 });

    // The seeded original should appear in the editor.
    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => normaliseText((await editor.textContent()) ?? ''), {
        timeout: 30000,
        message: 'editor must reflect seeded original',
      })
      .toContain('intentionally distinctive');

    // 2. Click Regenerate. With an existing row, this routes through the
    //    /regenerate endpoint (NOT /draft-stream) because the action handler
    //    branches on response?.id existence.
    const regenerateButton = page.getByRole('button', { name: /^Regenerate$/ });
    await expect(regenerateButton).toBeVisible();

    // Click once to reveal the instructions input, then again to send.
    await regenerateButton.click();
    // The button label switches to "Send" once the input is shown.
    const sendButton = page.getByRole('button', { name: /^Send$/ });
    await expect(sendButton).toBeVisible({ timeout: 5000 });

    const regenPromise = page.waitForResponse(
      (resp) =>
        REGENERATE_URL_PATH_RE.test(new URL(resp.url()).pathname) &&
        resp.request().method() === 'POST',
      { timeout: 180000 },
    );
    await sendButton.click();
    const regenResponse = await regenPromise;
    expect(
      regenResponse.status(),
      'Regenerate endpoint must return HTTP 200',
    ).toBe(200);

    // Wait for editor text to actually change away from originalText.
    await expect
      .poll(
        async () => normaliseText((await editor.textContent()) ?? ''),
        {
          timeout: 60000,
          message: 'editor must update to regenerated text',
        },
      )
      .not.toBe(normaliseText(originalText));

    const regeneratedText = (await editor.textContent()) ?? '';

    // ASSERTION: regenerated text is different from original (catches no-op)
    expect(normaliseText(regeneratedText)).not.toBe(normaliseText(originalText));

    // Refetch DB state.
    const { data: postRegenRows, error: prErr } = await supabase
      .from('bid_responses')
      .select('id, response_text, version')
      .eq('id', responseId)
      .single();
    if (prErr) throw prErr;

    // ASSERTION: version === 2 exactly
    expect(postRegenRows.version).toBe(2);
    // ASSERTION: DB response_text matches editor (UI and DB agree)
    expect(normaliseText(postRegenRows.response_text ?? '')).toBe(
      normaliseText(regeneratedText),
    );

    // ASSERTION: history has exactly one row, version=1, content=originalText
    const { data: hist1, error: h1Err } = await supabase
      .from('bid_response_history')
      .select('version, response_text')
      .eq('response_id', responseId)
      .order('version', { ascending: true });
    if (h1Err) throw h1Err;
    expect(hist1).toHaveLength(1);
    expect(hist1![0].version).toBe(1);
    expect(hist1![0].response_text).toBe(originalText);

    // 3. Open version history and click Restore on v1.
    // The History button shows current version badge: locate by accessible
    // name "View version history".
    const historyButton = page.getByRole('button', {
      name: /View version history/,
    });
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

    // Wait for editor text to revert to original.
    await expect
      .poll(
        async () => normaliseText((await editor.textContent()) ?? ''),
        {
          timeout: 30000,
          message: 'editor must reflect restored original text',
        },
      )
      .toBe(normaliseText(originalText));

    const restoredText = (await editor.textContent()) ?? '';

    // ASSERTION: editor text equals original
    expect(normaliseText(restoredText)).toBe(normaliseText(originalText));

    // Refetch DB.
    const { data: postRestoreRow, error: prrErr } = await supabase
      .from('bid_responses')
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
      .from('bid_response_history')
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
