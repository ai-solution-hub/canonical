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
    // KNOWN APP-SIDE BUG (S457 finding, routed — not fixed here, out of
    // this e2e-only Subtask's file-ownership boundary): on the FIRST
    // navigation to a `/documents/[id]` URL in a fresh session, TWO
    // `<section aria-label="Document provenance">` DOM nodes exist
    // transiently — one normally laid out, one with a zero-size bounding
    // rect (getBoundingClientRect() all-zero) that isn't exposed in the
    // accessibility tree. Reproduced identically under a `next start`
    // PRODUCTION build (not a dev/Strict-Mode double-invoke artifact) and
    // across repeated runs; a subsequent `page.reload()` on the SAME URL
    // consistently shows only one. `.first()` here keeps this spec passing
    // and useful (it still proves the section renders with the right
    // content) without masking or asserting away the duplicate-render bug.
    const provenanceSection = page
      .locator('section[aria-label="Document provenance"]')
      .first();
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
