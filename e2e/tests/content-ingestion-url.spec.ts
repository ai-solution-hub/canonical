/**
 * WP2 Phase 1 spec — 8.0.5 URL ingestion (re-pointed to the reference layer)
 *
 * ID-110 ({110.6}/{110.8}) RE-POINT:
 *   POST /api/ingest/url no longer writes `content_items`. A pasted external
 *   URL is now **evidence**, not adopted knowledge (ID-75 O4/D4): the route
 *   lands the ID-75 evidence pair — one `reference_items` row + one
 *   `source_documents` row per normalised URL — via the owner-gated
 *   `reference_ingest` SECURITY DEFINER RPC, and returns the reduced contract:
 *     { id, title, source_url, summary, primary_domain, primary_subtopic,
 *       warnings }
 *   It no longer infers layer / suggests topic / suggests guide sections /
 *   runs similarity dedup, and it writes ZERO `content_items` rows. The old
 *   assertions in this suite (content_items landing + layer/topic suggestions
 *   + /item/<id> read round-trip) asserted the now-dead content_items shape.
 *
 * id-401 (S515) AC-1/AC-3 VERDICT — OVERTURNED by the owner; corrected here
 * under id-408 (S522). Do not restore the "only the header was stale" reading.
 *   The S515 pass concluded "RETAINED UNCHANGED, NOT RETIRED" from a codebase
 *   read: every assertion binds a live table, therefore the spec matches the
 *   target model. That inference is invalid — **an assertion can bind a live
 *   table while its spec asserts a dead model** — and the S509 charter-board
 *   S8 verdict said "retire and replace, based on TARGET MODEL", which only a
 *   model-level read discharges.
 *   What the S515 pass got right, and which was never sufficient on its own:
 *   every assertion binds the LIVE reference-layer contract, zero bind retired
 *   substrate, and the `content_items` mentions in this file are all prose
 *   (grep `expect.*content_items` → no match outside this comment). The dead
 *   SKIP RATIONALE became SKIP HISTORY at S515, and the failure-mode table no
 *   longer claims a "content_items COUNT === 0" assertion the body has not
 *   carried since {131.19} M6 — both of those corrections stand.
 *   What the S515 pass did NOT check was the MODEL this spec's prose asserts.
 *   Under `corpus-reframe-review.html` R1 + DR-025 a pasted URL is an evidence
 *   stream bound to the platform, not content admitted to a canonical content
 *   store — the re-point note above already says exactly that, and the
 *   `test.describe` name was re-framed to match under id-408.
 *
 * D4 LANE BOUNDARY (id-396 `[D4 RATIFIED S511 (amended)]`, restated by
 * id-401 S515 — do not re-import corpus→rows proof into this file):
 *   This spec proves APP BEHAVIOUR around a programmatically-manufactured
 *   state. Proving corpus→rows — that ingesting the corpus produces the right
 *   rows — belongs to the INGESTION lane and its harness, never here. If you
 *   find yourself reaching for corpus files or lane-harness assertions in this
 *   spec, you are in the wrong lane.
 *
 * SKIP HISTORY (bl-119 — DISCHARGED, this suite RUNS):
 *   This suite was formerly `describe.skip`-ed pending a reference READ
 *   surface: at {110.8} no user-facing route rendered a `reference_items` row,
 *   so the create → read round-trip the WP2 spec mandates could not be
 *   exercised. That blocker is gone — {111.7} shipped `/reference/[id]`,
 *   {111.8} the success-card "View reference" link, and {111.10} the
 *   `/reference` browse — and the suite was UN-SKIPPED at {111.11} (S382,
 *   commit `86611487`) with the round-trip restored at step 5b below.
 *   Retained only so the bl-119 trail stays readable; there is no live skip.
 *
 * USER FLOW:
 *   1. As admin (authenticatedPage), navigate to `/item/new`.
 *   2. Click the "Import from URL" tab.
 *   3. Fill the URL input with the canary URL `https://example.com` (stable
 *      IANA test domain; returns title "Example Domain" and content
 *      containing "documentation examples"). DO NOT use `page.route()` — the
 *      fetch is server-side and Playwright cannot intercept it.
 *   4. Click "Import" and wait for the `/api/ingest/url` POST response.
 *   5. Assert the reduced reference contract on the response body.
 *   6. DB-side: a `reference_items` row exists for the normalised URL with the
 *      extracted body, and a `source_documents` row links to it (the atomic
 *      evidence pair from `reference_ingest`).
 *   7. Follow the success card's "View reference" link to `/reference/<id>`
 *      and assert the landed reference renders verbatim (title + body).
 *   8. Re-submit the same URL → `{ url_already_exists: true, existing_item }`
 *      and exactly ONE `reference_items` row (no duplicate).
 *
 * EXPECTED FAILURE MODES (each maps to >= 1 assertion below):
 *   - Route returns 200 without inserting a reference row → caught by the
 *     `reference_items` existence assertion.
 *   - Route regresses toward the retired content_items-era contract (infers a
 *     layer / suggests a topic / reports a dedup verdict) → caught by the four
 *     `not.toHaveProperty` guards on the response body. KEEP THESE: they are a
 *     LIVE regression fence on the reduced reference contract, not
 *     content_items-era debris to be cleaned up. There is deliberately NO
 *     "content_items COUNT === 0" assertion — {131.19} M6 DROPPED the table,
 *     so the schema itself now enforces that invariant and a query against it
 *     would error on a nonexistent relation (see step 5 in the body).
 *   - Extraction silently fails / stores empty body → caught by the non-empty
 *     + sentinel substring assertion on `reference_items.body`.
 *   - The evidence pair is not written atomically (reference lands without its
 *     document) → caught by the `source_document_id` + `source_documents`
 *     lookup assertions.
 *   - The landed reference is not readable (broken read surface) → caught by
 *     the `/reference/<id>` round-trip assertions on the h1 + body sentinel.
 *   - Dedup regresses and creates duplicate references on re-submit → caught
 *     by the `reference_items` count === 1 assertion.
 *   - `source_url` not persisted (link-back UX) → caught by the source_url
 *     equality assertion (post-normalisation form).
 *
 * ROLE SCOPING: `authenticatedPage` (admin). Reason: admin can ingest;
 *   viewer ingestion attempts are 8.0.6 territory.
 */

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';

const TARGET_URL = 'https://example.com';
const SENTINEL = 'documentation examples';
const EXPECTED_TITLE = 'Example Domain';

/**
 * Tear down any reference rows (and their linked source_documents) for this
 * URL. Defensive so the create assertion tests only what THIS run did, and
 * idempotent so leaked rows from prior failed runs do not poison the count.
 *
 * NOTE: `reference_items.source_url` stores the NORMALISED url. The canary
 * `https://example.com` normalises to a stable form; we match on both the
 * literal and any row whose source_url contains the host so cleanup is robust
 * to the exact normalisation rule the route applies.
 */
async function deleteReferenceByUrl(url: string): Promise<void> {
  const svc = createServiceClient();
  const { data: refs } = await svc
    .from('reference_items')
    .select('id, source_document_id')
    .eq('source_url', url);
  for (const ref of refs ?? []) {
    if ((ref as { source_document_id?: string }).source_document_id) {
      await svc
        .from('source_documents')
        .delete()
        .eq('id', (ref as { source_document_id: string }).source_document_id);
    }
    await svc
      .from('reference_items')
      .delete()
      .eq('id', (ref as { id: string }).id);
  }
}

// bl-119: full reference-contract E2E suite — UN-SKIPPED (ID-111.11).
// The reference-item READ surface now ships (ID-111.7 /reference/[id] detail +
// ID-111.8 success-card "View reference" link + ID-111.10 /reference browse),
// so the create → read round-trip the SKIP RATIONALE blocked on is exercised
// below (step 5b). Discharges bl-119.
test.describe('Source binding -- 8.0.5 URL ingestion (reference layer)', () => {
  test.beforeEach(async () => {
    await deleteReferenceByUrl(TARGET_URL);
  });

  test.afterEach(async () => {
    await deleteReferenceByUrl(TARGET_URL);
  });

  test('imports a URL onto the reference layer, extracts the canary sentinel, dedups on re-submit', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(180_000);

    // 1. Navigate and switch to the URL tab.
    await page.goto('/item/new');
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: /Import from URL/i }).click();
    await expect(
      page.locator('section[aria-label="Import content from URL"]'),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Fill the URL and submit.
    await page.getByLabel(/Web page URL/i).fill(TARGET_URL);

    const ingestResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/url') &&
        resp.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByRole('button', { name: /^Import$/ }).click();

    const ingestResponse = await ingestResponsePromise;
    expect(ingestResponse.status()).toBe(200);
    const ingestBody = await ingestResponse.json();

    // First submission must NOT be a dedup hit (cleaned up in beforeEach).
    // Reduced reference contract (TECH §3.1–§3.3): no content_type /
    // suggested_layer / topic_suggestion / guide_section_suggestions /
    // duplicate_matches.
    expect(ingestBody.url_already_exists).toBeFalsy();
    expect(ingestBody.id).toBeTruthy();
    expect(ingestBody.source_url).toBeTruthy();
    // The reference path runs NO dedup — no (misleading) dedup_status (bl-314).
    //
    // id-401 (S515) AC-3 adjudication — KEEP ALL FOUR. These name
    // content_items-era fields, but they are NOT dead prose: they are the live
    // regression fence proving the reduced reference contract has not regrown
    // the retired shape. Deleting them as "content_items cleanup" would remove
    // the only assertions covering that failure mode.
    expect(ingestBody).not.toHaveProperty('dedup_status');
    expect(ingestBody).not.toHaveProperty('suggested_layer');
    expect(ingestBody).not.toHaveProperty('content_type');
    expect(ingestBody).not.toHaveProperty('topic_suggestion');

    const referenceId: string = ingestBody.id;
    const normalisedUrl: string = ingestBody.source_url;

    // 3. DB-side: the reference row exists with the extracted body + canary
    //    sentinel; created against the normalised source_url.
    const svc = createServiceClient();
    const { data: refRow, error: refErr } = await svc
      .from('reference_items')
      .select('id, body, source_url, title, source_document_id')
      .eq('id', referenceId)
      .single();
    expect(refErr).toBeNull();
    expect(refRow).not.toBeNull();
    expect(refRow!.source_url).toBe(normalisedUrl);
    expect(refRow!.title).toBe(EXPECTED_TITLE);
    expect(refRow!.body).toBeTruthy();
    expect((refRow!.body as string).length).toBeGreaterThan(0);
    expect(refRow!.body as string).toContain(SENTINEL);

    // 4. The atomic evidence pair: a source_documents row links to the
    //    reference (reference_ingest writes sd + ri together).
    expect(refRow!.source_document_id).toBeTruthy();
    const { data: sdRow, error: sdErr } = await svc
      .from('source_documents')
      .select('id')
      .eq('id', refRow!.source_document_id as string)
      .single();
    expect(sdErr).toBeNull();
    expect(sdRow).not.toBeNull();

    // 5. ID-131.19 M6 retirement: `content_items` was DROPPED at M6 — the
    //    "NO content_items row was written" assertion (ID-110 core
    //    invariant) is now enforced by the schema itself (there is no
    //    table left to accidentally write to), so the query is removed
    //    rather than left to error against a nonexistent relation.

    // 5b. Create → read round-trip (bl-119 / ID-111.11). The success card
    //     surfaces a "View reference" link to the landed reference's own detail
    //     page; following it must render the verbatim reference — title (h1) and
    //     extracted body (canary sentinel via the shared ContentRenderer). This
    //     is the read-side assertion the SKIP RATIONALE blocked on.
    const viewReferenceLink = page.getByRole('link', {
      name: /View reference/i,
    });
    await expect(viewReferenceLink).toBeVisible({ timeout: 15_000 });
    await viewReferenceLink.click();
    await expect(page).toHaveURL(new RegExp(`/reference/${referenceId}$`), {
      timeout: 15_000,
    });
    await expect(
      page.getByRole('heading', { level: 1, name: EXPECTED_TITLE }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(SENTINEL, { exact: false }).first(),
    ).toBeVisible();

    // 6. Re-submit the same URL via the API (preserves session cookies).
    //    Dedup contract: `{ url_already_exists: true, existing_item }` and no
    //    second reference row.
    const reResp = await page.request.post('/api/ingest/url', {
      data: { url: TARGET_URL },
    });
    expect(reResp.ok()).toBe(true);
    const reBody = await reResp.json();
    expect(reBody.url_already_exists).toBe(true);
    expect(reBody.existing_item?.id).toBe(referenceId);

    // 7. Hard count: exactly one reference_items row exists for this URL.
    const { count, error: countErr } = await svc
      .from('reference_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_url', normalisedUrl);
    expect(countErr).toBeNull();
    expect(count).toBe(1);
  });
});
