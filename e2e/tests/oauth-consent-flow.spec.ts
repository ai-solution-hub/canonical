/**
 * WP2 Phase 1 spec — 8.0.1 OAuth consent flow
 *
 * USER FLOW:
 *   1. Pre-seed a test `mcp_oauth_clients` row via the service-role client
 *      (client_id, client_secret hash, redirect_uris including an
 *      out-of-band test callback, allowed scopes e.g. ["kb.read","kb.write"]).
 *   2. As admin (authenticatedPage fixture), navigate to
 *      `/oauth/authorize?client_id=<id>&redirect_uri=<uri>&response_type=code&scope=kb.read+kb.write&state=<nonce>`.
 *   3. Assert the consent page renders with client name, requested scopes,
 *      and an "Approve" / "Deny" control.
 *   4. Click "Approve".
 *   5. Capture the redirect target (Playwright `waitForURL` on the
 *      configured redirect_uri).
 *   6. Revisit the same `/oauth/authorize?...` URL with identical params.
 *      Assert the consent page is skipped (pre-approved grant reused).
 *   7. Revoke the grant (DELETE via `/api/oauth/grants/<id>` or service-key
 *      direct delete, depending on admin revocation flow).
 *   8. Revisit `/oauth/authorize?...` a third time. Assert the consent page
 *      renders again (grant was genuinely removed).
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - After step 4, exactly one row exists in `mcp_oauth_grants` where
 *     `user_id = admin.id` AND `client_id = <seeded id>` AND the stored
 *     `scopes` array equals the requested scopes (set equality, not
 *     substring). Verified via service-key query.
 *   - The redirect URL after approval has query params `code=<non-empty>`
 *     and `state=<nonce>` (state echoed back exactly — CSRF correctness).
 *   - The `code` value decodes/looks up to an `mcp_oauth_codes` row (or
 *     whatever the grant-code table is) tied to the same user_id +
 *     client_id. (Confirms we're issuing a real, redeemable code — not a
 *     placeholder.)
 *   - Second visit to `/oauth/authorize` does NOT show the Approve button;
 *     instead it redirects directly with a fresh code (asserts pre-approved
 *     grant short-circuit works).
 *   - After revocation, the `mcp_oauth_grants` row is gone from DB AND the
 *     third visit re-renders the consent page (asserts revocation wasn't
 *     a no-op).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - `mcp_oauth_clients` test row — seeded in this file's beforeAll via
 *     service-key insert (client name, hashed secret, redirect_uris,
 *     allowed_scopes). Not added to worker-scoped fixture because only
 *     this spec needs it.
 *   - Admin user: from existing `authenticatedPage` fixture (TEST_USER_1).
 *   - No seeded grants — the test must create and remove them itself.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Consent POST returns 200 without inserting a grant row → caught by
 *     the `mcp_oauth_grants` row existence assertion.
 *   - Authorization code issued is a static placeholder / empty string →
 *     caught by the non-empty code + code-lookup assertions.
 *   - `state` param dropped or replaced on redirect (CSRF regression) →
 *     caught by exact state echo assertion.
 *   - Scope list silently widened beyond requested scopes (privilege
 *     escalation) → caught by set-equality scopes assertion.
 *   - Pre-approved grant path broken (re-prompts every time, breaking
 *     Claude Desktop reconnect UX) → caught by step 6 assertion.
 *   - Revocation endpoint returns 200 but leaves the grant row → caught by
 *     post-revoke DB check + step 8 consent re-render.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: the consent flow is a
 *   user-authenticated browser action and must run under a real logged-in
 *   user; admin is sufficient — viewer-scope consent is out of scope for
 *   this spec (covered by 8.0.6 role-write-enforcement at the API layer).
 *
 * CLEANUP:
 *   afterAll: service-key delete of the seeded `mcp_oauth_clients` row and
 *   any lingering `mcp_oauth_grants`, `mcp_oauth_codes`, and
 *   `mcp_oauth_access_tokens` rows tied to the seeded client_id.
 *   afterEach is not needed because each test owns end-to-end grant
 *   lifecycle (create + revoke) inside a single test function.
 */
