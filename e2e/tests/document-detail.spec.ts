import { test, expect } from '../fixtures';

/**
 * Flow: Source Document Detail (/documents/[id]) — Surface B
 *
 * S457 finding (ID-128.16 #4): Surface B (ID-135 {135.18}, shipped —
 * app/documents/[id]/page.tsx) had zero e2e coverage. Minimal spec per the
 * dispatch brief — render + notFound + one section.
 *
 * Reuses the worker-scoped `articleId` fixture (a real `source_documents`
 * row seeded by e2e/fixtures/test-data-fixture.ts — filename
 * `${prefix} IT Support Policy`) rather than seeding new data: this page's
 * own header comment notes it shares the id-111 detail-shell pattern with
 * `/provenance`'s per-item lookup, which already exercises `articleId`
 * successfully (e2e/tests/provenance-per-item.spec.ts), confirming the row
 * is readable under the admin fixture's RLS regardless of its
 * (unset/default) publication_status.
 */
test.describe('Source Document Detail (/documents/[id])', () => {
  test('renders the document detail shell with its provenance section', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const documentId = workerData.articleId;
    expect(
      documentId,
      'workerData.articleId must be seeded by test-data-fixture',
    ).toBeTruthy();

    await page.goto(`/documents/${documentId}`);

    // h1 renders sourceDocument.original_filename || filename — the seed
    // never sets original_filename, so this falls back to the worker-
    // prefixed filename (components/source-document-detail/
    // source-document-detail-client.tsx).
    await expect(
      page.getByRole('heading', { level: 1, name: /IT Support Policy/ }),
    ).toBeVisible({ timeout: 15000 });

    // The Provenance section (BI-24) renders straight off the server-read
    // row with no separate client-side fetch — the most deterministic of
    // the five composed sections for a minimal smoke assertion.
    //
    // ID-135.27 (root-caused, S457/S460 finding, re-verified under this
    // Subtask by instrumenting Node/Element mutation primitives —
    // `appendChild`/`insertBefore`/`removeChild`/`setAttribute` — to catch
    // a same-task DOM race no MutationObserver/rAF sampling could): on the
    // FIRST navigation to a fresh `/documents/[id]` URL, TWO `<section
    // aria-label="Document provenance">` DOM nodes genuinely coexist for a
    // measured ~100-300ms window (matches the original ~200-400ms
    // estimate) — one normally laid out, one zero-size and absent from the
    // accessibility tree. Root cause is NOT an application double-render:
    // `SourceDocumentProvenance` has exactly one call site
    // (`SourceDocumentDetailClient`, confirmed via `gitnexus_impact` — 1
    // direct caller, LOW risk) and no console hydration-mismatch warning is
    // ever logged. The zero-size copy sits inside a `<div hidden id="S:N">`
    // ancestor — Next.js/React's own streaming-SSR Suspense-boundary
    // "reveal" scratch node (this route has no segment-local `loading.tsx`,
    // so it inherits the ROOT `app/loading.tsx` Suspense boundary; when the
    // page's server-side auth+DB read doesn't resolve inside the initial
    // flush, the resolved content streams in separately and React mounts a
    // fresh copy via its hydration-retry path while the server-streamed
    // staging node hasn't yet been garbage-collected). It self-resolves
    // without ever painting a frame or reaching the accessibility tree —
    // exactly what the original finding observed. The duplicate is a
    // framework-internal streaming-reveal artifact of whichever Suspense
    // boundary is currently in play — here, the inherited root
    // `app/loading.tsx` boundary, since this route has no segment-local
    // `loading.tsx` of its own (~15 sibling routes do, including
    // `/documents/[id]/diff`). Adding one here is a cheaper, precedented
    // in-boundary candidate for narrowing or eliminating the race, but it
    // was NOT tested or ruled out in this Subtask — routed to the Curator
    // as a follow-up spike (add `app/documents/[id]/loading.tsx`,
    // re-instrument per the DOM-mutation-primitive method above, confirm
    // whether the race narrows/disappears). No cheaper in-boundary fix was
    // attempted here; only the e2e-assertion-level resolution below is
    // in-scope for ID-135.27.
    //
    // `getByRole('region', …)` queries the accessibility tree directly, so
    // it always resolves to the one real, visible section regardless of
    // this framework-internal timing — no `.first()` guess-which-one-is-
    // real needed, and it still fails (Playwright strict-mode violation) if
    // a GENUINE second visible section ever appears.
    const provenanceSection = page.getByRole('region', {
      name: 'Document provenance',
    });
    await expect(provenanceSection).toBeVisible({ timeout: 10000 });
    await expect(
      provenanceSection.getByRole('heading', { name: 'Provenance' }),
    ).toBeVisible();

    // BI-22: the in-page "Back to search" link is the only nav affordance.
    await expect(
      page.getByRole('link', { name: /back to search/i }),
    ).toBeVisible();
  });

  test('shows notFound for a well-formed but non-existent id', async ({
    authenticatedPage: page,
  }) => {
    // Valid UUID shape (passes the route's UUID_RE gate before any DB
    // work — BI-23) that cannot match any real source_documents row.
    await page.goto('/documents/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible({ timeout: 15000 });
  });
});
