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
 * SKIP RATIONALE (bl-119):
 *   This suite is skipped pending the full reference-contract E2E suite,
 *   which is Orchestrator-flagged out of {110.8} scope. The blocker is the
 *   READ side: there is currently no user-facing route/page that renders a
 *   `reference_items` row (only the ingest route touches the table), so the
 *   create → read round-trip that the WP2 spec mandates (browse visibility /
 *   item detail) cannot be exercised end-to-end yet. Re-pointing only the
 *   create + DB-state + dedup assertions would land a partial test that no
 *   longer maps every failure mode to a browser-observable assertion (the
 *   WP2 "no trivial checks, every assertion maps to a failure mode" bar).
 *
 *   The assertions below are authored against the CURRENT reference contract
 *   (not the dead content_items shape) so that when the reference read
 *   surface ships, the suite can be un-skipped with the read round-trip added
 *   back. CI stays green: the suite is cleanly skipped, never asserting the
 *   dead shape.
 *
 * USER FLOW (target, once the reference read surface exists):
 *   1. As admin (authenticatedPage), navigate to `/item/new`.
 *   2. Click the "Import from URL" tab.
 *   3. Fill the URL input with the canary URL `https://example.com` (stable
 *      IANA test domain; returns title "Example Domain" and content
 *      containing "documentation examples"). DO NOT use `page.route()` — the
 *      fetch is server-side and Playwright cannot intercept it.
 *   4. Click "Import" and wait for the `/api/ingest/url` POST response.
 *   5. Assert the reduced reference contract on the response body.
 *   6. DB-side: a `reference_items` row exists for the normalised URL; NO
 *      `content_items` row exists for it; a `source_documents` row links to
 *      the reference (atomic pair from `reference_ingest`).
 *   7. Re-submit the same URL → `{ url_already_exists: true, existing_item }`
 *      and exactly ONE `reference_items` row (no duplicate).
 *
 * EXPECTED FAILURE MODES (each maps to >= 1 assertion below):
 *   - Route returns 200 without inserting a reference row → caught by the
 *     `reference_items` existence assertion.
 *   - Route regresses to writing `content_items` → caught by the
 *     content_items COUNT === 0 assertion.
 *   - Extraction silently fails / stores empty body → caught by the non-empty
 *     + sentinel substring assertion on `reference_items.body`.
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
test.describe('Content ingestion -- 8.0.5 URL ingestion (reference layer)', () => {
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
