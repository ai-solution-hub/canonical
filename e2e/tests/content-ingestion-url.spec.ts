/**
 * WP2 Phase 1 spec — 8.0.5 URL ingestion
 *
 * USER FLOW:
 *   1. As admin (authenticatedPage), navigate to `/item/new`.
 *   2. Switch to the "URL import" / "From URL" tab (verify exact label
 *      against current `app/(authed)/item/new/page.tsx` in Phase 3).
 *   3. Paste a deterministic URL into the URL input. Preferred source is
 *      a fixture-served local file (Playwright `page.route()` to mock the
 *      ingestion fetch with a stable HTML payload containing a sentinel
 *      string), so the test does not depend on third-party uptime.
 *      If routing the ingestion fetch is impossible (because extraction
 *      runs server-side), fall back to `https://example.com` as a
 *      well-known stable canary and assert against its known title
 *      ("Example Domain").
 *   4. Click "Import" / "Save".
 *   5. Wait for the ingestion API response via `page.waitForResponse`
 *      (NOT a fixed timeout).
 *   6. Wait for navigation to `/item/<id>` or capture the inserted id
 *      from the API response body.
 *   7. Navigate to `/browse` and assert the new item is visible.
 *   8. Re-submit the same URL → assert the dedup path (either rejected
 *      with a clear UI message or returns the existing item id, NOT a
 *      duplicate row).
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - A new `content_items` row exists with `source_url` equal to the
 *     submitted URL and `created_by = admin.id`.
 *   - The row's `content` (or `extracted_text`) is non-empty AND contains
 *     the sentinel substring from the mocked HTML (or "Example Domain"
 *     if using the canary).
 *   - A `source_documents` row links to the content_items row with a
 *     stable hash / canonical URL.
 *   - On `/browse`, the new item's title is visible (read-path round-trip).
 *   - Second submission of the same URL does NOT create a second
 *     `content_items` row (count stays at 1 for the URL); the UI surfaces
 *     either an "already exists" message or transparently navigates to the
 *     existing item.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - No DB seed required.
 *   - If using `page.route()`, the mocked HTML payload is defined inline in
 *     the spec (not committed as a separate fixture file).
 *   - Admin user from `authenticatedPage` fixture.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - URL fetch handler returns 200 without inserting a row → caught by
 *     `content_items` existence assertion.
 *   - Extraction silently fails and stores empty content → caught by
 *     non-empty + sentinel substring assertion.
 *   - Dedup logic regresses and creates duplicate rows on re-submit →
 *     caught by count-stays-at-1 assertion.
 *   - Browse query excludes URL-imported items (RLS or filter drift) →
 *     caught by `/browse` visibility assertion.
 *   - `source_url` not persisted, breaking link-back UX → caught by
 *     direct DB query assertion on the source_url column.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: admin can ingest;
 *   viewer ingestion attempts are 8.0.6 territory. Editor URL ingest is
 *   functionally identical at the API layer.
 *
 * CLEANUP:
 *   afterEach: service-key delete of the captured content_items row + its
 *   source_documents row by id. Also a defensive `WHERE source_url = ...`
 *   delete to catch any leaked dedup-failure rows from previous failed
 *   runs. Idempotent.
 */
