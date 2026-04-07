/**
 * WP2 Phase 1 spec — 8.0.4 file upload ingestion
 *
 * VERIFIED AGAINST PRODUCTION (Phase 2 adversarial review):
 *   - Upload endpoint is `/api/upload` (verified at
 *     `app/api/upload/route.ts`). The earlier draft referenced
 *     `/api/upload-urls`, which does NOT exist.
 *   - New-item page tabs (verified at `app/item/new/new-item-tabs.tsx`):
 *       "Write content" | "Import from URL" | "Upload file"
 *   - `e2e/fixtures/files/` directory does NOT exist; Phase 3 MUST create
 *     `e2e/fixtures/files/sample.pdf` (small, < 50 KB, deterministic,
 *     containing a known sentinel string in extractable text).
 *
 * USER FLOW:
 *   1. As admin (authenticatedPage), navigate to `/item/new`.
 *   2. Click the "Upload file" tab trigger.
 *   3. Use `page.setInputFiles()` against the file input inside the upload
 *      tab to attach `e2e/fixtures/files/sample.pdf`.
 *   4. Wait for the upload + ingest API responses via `page.waitForResponse`
 *      against `/api/upload` and any subsequent ingest/extract endpoint
 *      that the upload tab triggers (NOT a fixed timeout). Phase 3 must
 *      enumerate the actual chain by inspecting `upload-tab-content.tsx`.
 *   5. Submit / save the new item if the upload tab has a separate save
 *      step (verify against the component in Phase 3).
 *   6. Wait for navigation to `/item/<id>` or `/browse`.
 *   7. Capture the new content_item id (from URL or from API response body
 *      via `waitForResponse(...).json()`).
 *   8. Navigate to `/browse` and assert the new item title is visible.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - A new `content_items` row exists with `created_by = admin.id` AND
 *     a non-empty `content` (or `extracted_text`) field. The content must
 *     contain the sentinel substring known to be in the seeded PDF — proves
 *     the extraction pipeline ran end-to-end, not just the upload step,
 *     AND that the row matches the file we uploaded (not some other row).
 *   - A corresponding `source_documents` row exists pointing at the
 *     uploaded file. Both `storage_path` (or equivalent) AND `sha256_hash`
 *     (or equivalent) must be non-null — Phase 3 verifies exact column
 *     names against `supabase/types/database.types.ts`.
 *   - The Supabase Storage bucket contains an object at the path stored
 *     in `source_documents.storage_path`. Verify by calling
 *     `supabase.storage.from(<bucket>).download(<path>)` via service key
 *     and asserting the returned blob size > 0. (NOT just "row exists";
 *     storage object must actually be present.)
 *   - On `/browse`, the new item's title is rendered in a list item
 *     visible to the admin user (asserts read-side query/index picks it up).
 *     Use `getByText(<sentinel title>)` for an exact match.
 *   - Re-uploading the same file produces a dedup outcome. Phase 3
 *     implementer must call `/api/upload` a SECOND time with the same
 *     bytes and assert one of:
 *       (a) The second response indicates "already exists" with a clear
 *           status code (409 or 200 with a `duplicate: true` payload), AND
 *       (b) The DB count of `source_documents` rows for this sha256_hash
 *           remains exactly 1.
 *     Pin which behaviour by inspecting `app/api/upload/route.ts` in
 *     Phase 3 — but the count-stays-at-1 assertion is non-negotiable.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - `e2e/fixtures/files/sample.pdf` — Phase 3 MUST create this:
 *       * Small (< 50 KB).
 *       * Deterministic content (same bytes every run).
 *       * Contains a unique extractable sentinel string (e.g.
 *         "E2E-UPLOAD-SENTINEL-8.0.4-<unique-token>").
 *       * Committed to the repo (binary).
 *     If Phase 3 cannot generate a PDF programmatically, use a tiny
 *     pre-built fixture or a `.txt`/`.md` file if the upload tab accepts
 *     non-PDF formats (verify accepted MIME types in
 *     `upload-tab-content.tsx` first).
 *   - Admin user from `authenticatedPage` fixture.
 *   - No worker-data dependencies.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - File upload silently swallowed (UI shows "saved", no DB row) →
 *     caught by `content_items` existence assertion.
 *   - `source_documents` row created but storage object missing (broken
 *     signed-URL upload) → caught by storage download assertion.
 *   - Extraction step skipped, leaving `content` empty → caught by
 *     non-empty content assertion AND sentinel substring assertion.
 *   - Item written but excluded from browse query (RLS or index drift) →
 *     caught by `/browse` visibility assertion.
 *   - Dedup logic regressed and creates duplicate `source_documents`
 *     rows on re-upload → caught by count-stays-at-1 assertion.
 *   - Upload route returns 200 but stores the wrong file (e.g. swapped
 *     buffers between concurrent requests) → caught by sha256_hash
 *     assertion (the stored hash must match the uploaded file's hash,
 *     which Phase 3 computes locally before upload).
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: admin can write
 *   content; viewer write attempts are 8.0.6 territory.
 *
 * CLEANUP:
 *   afterEach: service-key delete of the captured content_items row +
 *   its source_documents row + storage object (if it exists). Idempotent
 *   so partial-failure runs still leave a clean slate.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock `/api/upload` with `page.route()` — the test must
 *     exercise the real upload path, signed URL generation, storage
 *     write, and extraction pipeline.
 *   - DO NOT pre-seed a `content_items` row with the same title — that
 *     would make the `/browse` visibility assertion trivially true
 *     (Attack 2).
 *   - DO NOT wrap the storage-download assertion in
 *     `if (sourceDoc.storage_path) { ... }` — a missing storage_path
 *     IS the bug; the assertion must fail loudly.
 *   - DO NOT replace the sentinel substring check with a "content !== ''"
 *     check — empty-string-only is too weak; an extraction stub returning
 *     "extraction placeholder" would pass.
 */
