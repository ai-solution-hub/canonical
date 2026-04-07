/**
 * WP2 Phase 1 spec — 8.0.4 file upload ingestion
 *
 * USER FLOW:
 *   1. As admin (authenticatedPage), navigate to `/item/new`.
 *   2. Switch to the "Upload file" tab (verify exact tab label against
 *      current `app/(authed)/item/new/page.tsx` in Phase 3).
 *   3. Use `page.setInputFiles()` against the hidden `<input type="file">`
 *      to attach `e2e/fixtures/files/sample.pdf` (Phase 3 must create this
 *      < 50 KB fixture; if Phase 1 implementer cannot create binaries,
 *      flag a fixture-creation TODO in the implementation prompt).
 *   4. Wait for upload progress to complete (use `page.waitForResponse`
 *      against the `/api/upload-urls` and the subsequent ingest endpoint —
 *      NOT a fixed timeout).
 *   5. Submit / save the new item.
 *   6. Wait for navigation to `/item/<id>` or to `/browse`.
 *   7. Capture the new content_item id and assert via service-key DB query.
 *   8. Navigate to `/browse` and assert the new item title is visible in
 *      the list (proves it's queryable through the read path, not just
 *      written to DB).
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - A new `content_items` row exists with `created_by = admin.id` and
 *     a non-empty `content` (or `extracted_text`) field — confirms the
 *     extraction pipeline ran end-to-end, not just the upload step.
 *   - A corresponding `source_documents` row exists pointing at the
 *     uploaded file (storage path or sha256 hash present and non-null).
 *   - The Supabase Storage bucket contains an object at the path stored
 *     in `source_documents.storage_path` (HEAD request via service-key
 *     storage client returns 200).
 *   - On `/browse`, the new item's title is rendered (asserts read-side
 *     query/index picks it up).
 *   - Re-uploading the same file produces a dedup outcome — either a
 *     409 / "Already exists" UI state OR the same content_items.id is
 *     returned. Spec must pin which behaviour the production code does
 *     in Phase 3 verification.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - `e2e/fixtures/files/sample.pdf` — small (< 50 KB) deterministic PDF
 *     with known extractable text containing a sentinel string. Created
 *     once and committed; not seeded per-test.
 *   - Admin user from `authenticatedPage` fixture.
 *   - No worker-data dependencies.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - File upload silently swallowed (UI shows "saved", no DB row) →
 *     caught by `content_items` existence assertion.
 *   - `source_documents` row created but storage object missing (broken
 *     signed-URL upload) → caught by storage HEAD assertion.
 *   - Extraction step skipped, leaving `content` empty → caught by
 *     non-empty content assertion.
 *   - Item written but excluded from browse query (RLS or index drift) →
 *     caught by `/browse` visibility assertion.
 *   - Dedup logic regressed and creates duplicate rows on re-upload →
 *     caught by re-upload assertion.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: admin can write
 *   content; viewer write attempts are 8.0.6 territory. Editor upload is
 *   functionally identical at the API layer and not separately covered.
 *
 * CLEANUP:
 *   afterEach: service-key delete of the captured content_items row +
 *   its source_documents row + storage object (if it exists). Idempotent
 *   so partial-failure runs still leave a clean slate.
 */
