/**
 * WP2 Phase 1 spec — 8.0.5 URL ingestion
 *
 * VERIFIED AGAINST PRODUCTION (Phase 2 adversarial review):
 *   - URL ingestion endpoint is `/api/ingest/url` (verified at
 *     `app/api/ingest/url/route.ts` and the form's fetch call in
 *     `components/create-content/url-ingest-form.tsx:137`).
 *   - The fetch happens SERVER-SIDE inside the route handler. Playwright
 *     `page.route()` only intercepts browser-originated requests, so the
 *     mock-the-target-URL approach DOES NOT WORK for this path. The spec
 *     therefore mandates the canary URL approach (or, optionally, a tiny
 *     local HTTP server fixture started in `beforeAll`).
 *   - New-item page tab label: "Import from URL" (verified at
 *     `app/item/new/new-item-tabs.tsx`).
 *
 * USER FLOW:
 *   1. As admin (authenticatedPage), navigate to `/item/new`.
 *   2. Click the "Import from URL" tab.
 *   3. Fill the URL input with a deterministic external URL. Phase 3
 *      options:
 *        (a) Use `https://example.com` (the canonical IANA test domain;
 *            stable, returns "Example Domain" in the page title and
 *            "Example Domain" in an `<h1>`). This is the default
 *            recommendation.
 *        (b) Start a tiny local HTTP server in `beforeAll` (Node `http`
 *            module, listening on a random port) that returns a fixed
 *            HTML payload with a unique sentinel string. Use this if
 *            external network access is restricted in CI.
 *      DO NOT use `page.route()` to mock the URL — the production code
 *      fetches the URL server-side and Playwright cannot intercept it.
 *   4. Click the "Import" / "Save" button.
 *   5. Wait for the ingestion API response via
 *      `page.waitForResponse('**\/api/ingest/url')` (NOT a fixed timeout).
 *   6. Capture the inserted content_items id from the API response body
 *      OR from the post-submit navigation URL.
 *   7. Navigate to `/browse` and assert the new item is visible by title.
 *   8. Re-submit the same URL → assert the dedup path returns the same
 *      content_items id (or a clear "already exists" error) and DOES NOT
 *      create a second row.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - A new `content_items` row exists with `source_url` equal to the
 *     submitted URL (exact equality after URL normalisation that the
 *     production code applies — Phase 3 verifies the normalisation rules)
 *     AND `created_by = admin.id`.
 *   - The row's `content` (or `extracted_text`) is non-empty AND contains
 *     the canary sentinel substring ("Example Domain" for option (a), or
 *     the local-server payload's sentinel for option (b)).
 *   - A `source_documents` row links to the content_items row with a
 *     non-null hash / canonical URL.
 *   - On `/browse`, the new item's title is visible (read-path round-trip).
 *     Use exact text match against the title that was extracted.
 *   - Second submission of the same URL: a service-key COUNT query on
 *     `content_items WHERE source_url = <url>` returns exactly 1 (NOT 2).
 *     The UI surfaces either an "already exists" error message or
 *     transparently navigates to the existing item — Phase 3 pins the
 *     actual behaviour by inspecting `app/api/ingest/url/route.ts`.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - No DB seed required.
 *   - Phase 3 chooses option (a) canary URL or option (b) local fixture
 *     server. Option (b) requires `beforeAll`/`afterAll` server lifecycle.
 *   - Admin user from `authenticatedPage` fixture.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - URL fetch handler returns 200 without inserting a row → caught by
 *     `content_items` existence assertion.
 *   - Extraction silently fails and stores empty content → caught by
 *     non-empty + sentinel substring assertion.
 *   - Dedup logic regresses and creates duplicate rows on re-submit →
 *     caught by count === 1 assertion.
 *   - Browse query excludes URL-imported items (RLS or filter drift) →
 *     caught by `/browse` visibility assertion.
 *   - `source_url` not persisted, breaking link-back UX → caught by
 *     direct DB query on the source_url column.
 *   - URL normalisation regression (e.g. trailing slash stripped on
 *     write but not on read) → caught by exact-equality `source_url`
 *     assertion. If Phase 3 finds the production code intentionally
 *     normalises (e.g. lowercases the host), the assertion must compare
 *     against the post-normalisation form, not the literal submitted URL.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: admin can ingest;
 *   viewer ingestion attempts are 8.0.6 territory.
 *
 * CLEANUP:
 *   afterEach: service-key delete of the captured content_items row + its
 *   source_documents row by id. Defensive `WHERE source_url = <url>`
 *   delete to catch any leaked dedup-failure rows from previous failed
 *   runs. Idempotent.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT use `page.route()` to mock the target URL. The fetch is
 *     server-side; this approach is silently ineffective and would
 *     produce a false-positive test.
 *   - DO NOT mock `/api/ingest/url` itself — the entire purpose is to
 *     exercise the real ingestion + extraction + dedup chain.
 *   - DO NOT pre-seed a `content_items` row with the same source_url
 *     before the test — that defeats the create assertion (Attack 2).
 *   - DO NOT wrap the dedup count assertion in a conditional. The
 *     assertion must run unconditionally on the second submission.
 *   - DO NOT replace the sentinel substring check with `content.length > 0`.
 *     A whitespace string passes that check; only the substring proves
 *     extraction worked against the right URL.
 */
