/**
 * WP2 Phase 1 spec — 8.0.1 OAuth consent flow
 *
 * IMPORTANT — corrected after Phase 2 adversarial review:
 *   Knowledge Hub does NOT have custom `mcp_oauth_*` tables. OAuth is fully
 *   delegated to Supabase Auth's built-in OAuth (`supabase.auth.oauth.*`).
 *   The consent route is `/oauth/consent?authorization_id=<id>` (NOT
 *   `/oauth/authorize?...`). Authorization, grant, code, and token state
 *   live in the Supabase `auth` schema and are NOT directly readable from
 *   service-key queries against the public schema. The `/api/oauth/decision`
 *   handler calls `supabase.auth.oauth.approveAuthorization()` /
 *   `denyAuthorization()`. Active grants are listed via
 *   `supabase.auth.oauth.listGrants()` (consumed by `/api/oauth/grants` GET)
 *   and revoked via `/api/oauth/revoke`.
 *
 * USER FLOW:
 *   1. The OAuth flow MUST be initiated end-to-end by an MCP client (Supabase
 *      Auth issues the `authorization_id` — there is no service-key shortcut
 *      to fabricate one). Phase 3 implementer options:
 *        (a) Drive a real OAuth start request against the configured Supabase
 *            project's OAuth endpoint (the URL/method used by Claude Desktop)
 *            with a registered test OAuth client + redirect URI, capture the
 *            redirect to `/oauth/consent?authorization_id=<id>`, and continue.
 *        (b) If a registered OAuth client is not available in the test env,
 *            use the Supabase admin API to register a temporary OAuth client
 *            in `beforeAll` (admin REST `/auth/v1/admin/oauth/clients` or
 *            equivalent — Phase 3 must verify the exact API against the
 *            current `@supabase/supabase-js` version).
 *      Phase 3 must NOT skip this step by mocking Supabase Auth — that would
 *      satisfy Attack 1 (mocking the SUT). The whole point of this test is
 *      to prove the real Supabase Auth call returns a usable
 *      `authorization_id` and the consent page renders against it.
 *   2. As admin (authenticatedPage fixture), navigate to the captured
 *      `/oauth/consent?authorization_id=<id>` URL.
 *   3. Assert the consent page renders the client name, requested scopes,
 *      AND the user's account email (proves
 *      `supabase.auth.oauth.getAuthorizationDetails()` succeeded with the
 *      issued id — not a static placeholder page).
 *   4. Submit the form by clicking the "Approve" button (the form POSTs to
 *      `/api/oauth/decision` with `decision=approve` and the
 *      `authorization_id` hidden field).
 *   5. Capture the 303 redirect. The decision route returns
 *      `NextResponse.redirect(data.redirect_url, 303)`; Playwright will
 *      follow it. Use `page.waitForURL` against the registered redirect URI
 *      pattern.
 *   6. Without re-running the full OAuth init, assert via the Connected Apps
 *      API (`GET /api/oauth/grants`) that exactly one grant now exists for
 *      the test client (matched by client name or client id from
 *      `listGrants()` output).
 *   7. Initiate a SECOND OAuth flow against the same client (repeat the
 *      step 1 init). Navigate to the new `/oauth/consent?authorization_id=`
 *      URL. Assert that `getAuthorizationDetails()` returned a `redirect_url`
 *      branch (the consent page source contains the early `redirect()`
 *      path) — i.e. the user is redirected straight back without seeing the
 *      Approve button. In practice, assert that `page.url()` after the
 *      navigation is the redirect URI, NOT the consent page URL, AND that
 *      the Approve button is NOT visible.
 *   8. Revoke the grant via `POST /api/oauth/revoke` (or whatever verb the
 *      route exposes — Phase 3 implementer to verify against
 *      `app/api/oauth/revoke/route.ts`). Re-query `/api/oauth/grants` and
 *      assert the revoked grant is gone.
 *   9. Initiate a THIRD OAuth flow. Navigate to the new consent URL. Assert
 *      the Approve button IS visible (revocation forced re-consent — proves
 *      revocation wasn't a no-op).
 *
 * ASSERTIONS (each must be verifiable from browser state OR API state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips or `if (await x.isVisible())` gates):
 *   - The consent page renders the client name string from the registered
 *     OAuth client (set-equality against the Phase 3 fixture client name —
 *     not just "an h2 exists"). This proves `getAuthorizationDetails()`
 *     returned a real client object, not an error.
 *   - The consent page renders ALL requested scopes as `<li>` items inside
 *     the `requested-permissions-label` ul (set-equality against the
 *     requested scope list — not substring; not "at least one li").
 *   - After Approve click, `page.url()` matches the registered redirect URI
 *     pattern AND the URL query string contains a non-empty `code=` AND
 *     `state=` parameter equal to the `state` value passed in the OAuth init.
 *     (Exact-equality on `state` catches CSRF regressions.)
 *   - `GET /api/oauth/grants` after approval returns a `grants` array
 *     containing exactly one entry whose client name matches the registered
 *     test client. The grant's recorded scopes are set-equal to the
 *     requested scopes (NOT a superset — proves no privilege escalation).
 *   - On the second OAuth init, `page.url()` after navigating to the
 *     `/oauth/consent?...` URL is the redirect URI, NOT the consent URL,
 *     AND `page.getByRole('button', { name: /approve/i })` is NOT visible.
 *     (The consent page source uses `redirect(authDetails.redirect_url)`
 *     when the user has already consented — proves the short-circuit works.)
 *   - After revocation, `GET /api/oauth/grants` returns a list NOT
 *     containing the revoked client (count of matching grants === 0).
 *   - On the third OAuth init, the Approve button IS visible again
 *     (proves revocation actually invalidated the grant).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - A registered OAuth client in the Supabase Auth instance for the test
 *     project. Phase 3 implementer must either (a) provision one in
 *     `beforeAll` via the Supabase admin OAuth API and tear down in
 *     `afterAll`, or (b) document that an existing test client must be
 *     present in `.env` (e.g. `TEST_OAUTH_CLIENT_ID`, `TEST_OAUTH_CLIENT_SECRET`,
 *     `TEST_OAUTH_REDIRECT_URI`). Option (a) is preferred for self-contained
 *     test runs.
 *   - Admin user: from existing `authenticatedPage` fixture (TEST_USER_1).
 *   - No worker-data dependencies.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - `/api/oauth/decision` returns 200/303 without actually calling
 *     `supabase.auth.oauth.approveAuthorization()` (e.g. handler refactored
 *     to a stub) → caught by the `GET /api/oauth/grants` post-approval
 *     assertion (no grant would be created).
 *   - `state` param dropped or replaced on the redirect (CSRF regression
 *     in Supabase Auth or in the Next.js redirect handling) → caught by
 *     exact-equality `state` assertion on the captured redirect URL.
 *   - Scope list silently widened beyond requested scopes (privilege
 *     escalation) → caught by set-equality scopes assertion against the
 *     listed grant scopes.
 *   - Pre-approved grant short-circuit broken (consent page re-renders
 *     even when the user already approved) → caught by step 7 "Approve
 *     button not visible" assertion.
 *   - `/api/oauth/revoke` returns success but Supabase Auth still lists
 *     the grant (no-op revoke) → caught by post-revoke `listGrants()`
 *     count assertion AND the step 9 "Approve button visible again"
 *     assertion. (Both must hold; one alone is satisfiable by a stub
 *     that flips local state.)
 *   - Consent page renders a hard-coded "Authorise Application" heading
 *     even when `getAuthorizationDetails()` errors → caught by the
 *     "client name === fixture name" assertion (a hard-coded heading
 *     would not match the dynamic test client name).
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: the consent flow is
 *   a user-authenticated browser action and must run under a real logged-in
 *   user; admin is sufficient — viewer-scope consent is out of scope (the
 *   API-layer enforcement is covered by 8.0.6).
 *
 * CLEANUP:
 *   afterAll: revoke any grants left for the test OAuth client via
 *   `/api/oauth/revoke`, then (if Phase 3 chose option (a)) delete the
 *   provisioned OAuth client via the Supabase admin API. Idempotent.
 *   afterEach is not needed because each test owns end-to-end grant
 *   lifecycle (create + revoke) inside a single test function.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these — any
 * of them defeats the spec's purpose):
 *   - DO NOT mock `/api/oauth/decision`, `/api/oauth/grants`, or
 *     `/api/oauth/revoke` with `page.route()`. The whole point is to
 *     exercise the real handlers + real Supabase Auth.
 *   - DO NOT wrap any assertion in `if (await x.isVisible()) { ... }` or
 *     similar conditional. Every assertion must run unconditionally.
 *   - DO NOT short-circuit the test if a sub-step fails — let it throw so
 *     the failure is loud.
 *   - DO NOT assert solely on element presence (e.g. "consent card
 *     exists"). The card is hard-coded HTML; presence proves nothing about
 *     the OAuth machinery. Always pair element presence with a dynamic
 *     value sourced from the issued authorization (client name, scopes,
 *     redirect URI, code, state).
 */
