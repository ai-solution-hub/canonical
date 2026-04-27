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

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const TEST_USER_EMAIL =
  process.env.TEST_USER_1_EMAIL || 'test.user1@test-kb-aish.co.uk';
const TEST_USER_PASSWORD = process.env.TEST_USER_1_PASSWORD || 'Welcome12391.';

// Use an existing fast app route as the OAuth redirect URI so the dev server
// doesn't have to compile a 404 page (which can push the test over its
// timeout on a cold start). Honour PLAYWRIGHT_BASE_URL when set so concurrent
// worktrees can run their own dev server on a non-default port.
const TEST_BASE_URL = (
  process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const TEST_REDIRECT_URI = `${TEST_BASE_URL}/api/health`;
const REQUESTED_SCOPES = ['openid', 'profile', 'email'] as const;

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash('sha256').update(verifier).digest(),
  );
  return { verifier, challenge };
}

interface InitResult {
  authorizationId: string | null;
  redirectUrl: string | null;
  state: string;
}

/**
 * Drive a real OAuth 2.1 authorization request against Supabase Auth using
 * the test admin user's bearer token. This is NOT a mock — it issues a real
 * GET to `${SUPABASE_URL}/auth/v1/oauth/authorize` and captures the 302
 * Location.
 *
 * Possible 302 targets:
 *  - `<consent_page>?authorization_id=...` (consent required)
 *  - `<redirect_uri>?code=...&state=...` (already consented — short circuit)
 */
async function initOAuthFlow(
  accessToken: string,
  clientId: string,
  state: string,
  challenge: string,
): Promise<InitResult> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: TEST_REDIRECT_URI,
    scope: REQUESTED_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const resp = await fetch(
    `${SUPABASE_URL}/auth/v1/oauth/authorize?${params.toString()}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: 'manual',
    },
  );
  expect(
    resp.status,
    `Supabase /oauth/authorize must return a 302 redirect, got ${resp.status}`,
  ).toBe(302);

  const location = resp.headers.get('location');
  expect(
    location,
    'Supabase /oauth/authorize must set Location header',
  ).toBeTruthy();

  const url = new URL(location!);
  const authorizationId = url.searchParams.get('authorization_id');
  return { authorizationId, redirectUrl: location!, state };
}

async function getUserAccessToken(): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(
      `Failed to sign in test admin user: ${error?.message ?? 'no session'}`,
    );
  }
  return data.session.access_token;
}

test.describe('8.0.1 OAuth consent flow', () => {
  // OAuth flows include several real network round-trips to Supabase Auth
  // (signin, /oauth/authorize, decision, listGrants, revoke, plus 3 separate
  // init flows). Bump the per-test timeout to comfortably accommodate them
  // even on a cold dev server.
  test.setTimeout(120_000);

  let clientId: string;
  let clientSecret: string;
  let registeredClientName: string;
  let accessToken: string;

  async function exchangeCodeForToken(
    code: string,
    verifier: string,
  ): Promise<void> {
    const tokenResp = await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        apikey: SUPABASE_ANON_KEY,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: TEST_REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });
    expect(
      tokenResp.status,
      `token exchange must succeed, got ${tokenResp.status}: ${await tokenResp.text()}`,
    ).toBe(200);
  }

  test.beforeAll(async () => {
    accessToken = await getUserAccessToken();

    // Provision a real OAuth client via the Supabase admin API.
    const adminSupabase = createServiceClient();
    registeredClientName = `E2E OAuth Consent ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await adminSupabase.auth.admin.oauth.createClient({
      client_name: registeredClientName,
      redirect_uris: [TEST_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
    });
    if (error || !data) {
      throw new Error(
        `Failed to create test OAuth client: ${error?.message ?? 'no data'}`,
      );
    }
    clientId = data.client_id;
    clientSecret = data.client_secret!;
  });

  test.afterAll(async () => {
    const adminSupabase = createServiceClient();
    // Best-effort revoke any lingering grant for this client by the test user,
    // then delete the OAuth client. Both are idempotent.
    try {
      const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      await userSupabase.auth.signInWithPassword({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
      });
      await userSupabase.auth.oauth.revokeGrant({ clientId });
    } catch {
      // ignore
    }
    if (clientId) {
      try {
        await adminSupabase.auth.admin.oauth.deleteClient(clientId);
      } catch {
        // ignore
      }
    }
  });

  test('approve, short-circuit on re-init, revoke, and re-prompt', async ({
    authenticatedPage: page,
  }) => {
    // -----------------------------------------------------------------------
    // Step 1: Init OAuth flow #1 → expect consent page
    // -----------------------------------------------------------------------
    const state1 = `state-1-${crypto.randomBytes(8).toString('hex')}`;
    const pkce1 = makePkcePair();
    const init1 = await initOAuthFlow(
      accessToken,
      clientId,
      state1,
      pkce1.challenge,
    );
    expect(
      init1.authorizationId,
      'first init must return an authorization_id (consent required)',
    ).toBeTruthy();

    // -----------------------------------------------------------------------
    // Step 2: Navigate to the consent page and assert it renders dynamic data
    // -----------------------------------------------------------------------
    await page.goto(`/oauth/consent?authorization_id=${init1.authorizationId}`);

    // Heading uses the registered client name → proves
    // getAuthorizationDetails() returned a real client object.
    await expect(
      page.getByRole('heading', { name: `Authorise ${registeredClientName}` }),
    ).toBeVisible();

    // Account row contains the test user's email. The consent page may also
    // render the email in the header user menu, so pin to the consent card by
    // selecting the DetailRow for "Account".
    await expect(
      page
        .locator('div', { has: page.getByText('Account', { exact: true }) })
        .getByText(TEST_USER_EMAIL)
        .first(),
    ).toBeVisible();

    // Requested permissions list — set-equality against requested scopes.
    // formatScope() maps "openid"→"Verify your identity",
    // "profile"→"View your profile information",
    // "email"→"View your email address".
    const expectedScopeLabels = new Set([
      'Verify your identity',
      'View your profile information',
      'View your email address',
    ]);
    const scopeItems = page.locator(
      'ul[aria-labelledby="requested-permissions-label"] > li',
    );
    const renderedScopes = await scopeItems.allTextContents();
    expect(new Set(renderedScopes.map((s) => s.trim()))).toEqual(
      expectedScopeLabels,
    );

    // -----------------------------------------------------------------------
    // Step 3: Submit Approve. The form POSTs to /api/oauth/decision which
    // returns a 303 to the OAuth client's redirect_uri. Playwright follows
    // the redirect; the resulting URL should match TEST_REDIRECT_URI with
    // code & state set.
    // -----------------------------------------------------------------------
    // Listen for navigation to TEST_REDIRECT_URI; it returns 404 from the
    // dev server but the navigation still happens and the URL is updated.
    const approveBtn = page.getByRole('button', { name: /approve/i });
    await expect(approveBtn).toBeVisible();
    await Promise.all([
      page.waitForURL((url) => url.toString().startsWith(TEST_REDIRECT_URI), {
        timeout: 15000,
      }),
      approveBtn.click(),
    ]);

    const finalUrl = new URL(page.url());
    expect(
      `${finalUrl.origin}${finalUrl.pathname}`,
      'should land on the registered redirect URI',
    ).toBe(TEST_REDIRECT_URI);
    const code = finalUrl.searchParams.get('code');
    expect(code, 'redirect URI must include a non-empty code').toBeTruthy();
    expect(code!.length).toBeGreaterThan(0);
    expect(
      finalUrl.searchParams.get('state'),
      'state must be echoed exactly (CSRF protection)',
    ).toBe(state1);

    // Complete the OAuth dance: exchange the code for tokens at the token
    // endpoint. Without this, Supabase Auth may not consider the consent
    // "fully granted" for purposes of short-circuiting subsequent flows.
    await exchangeCodeForToken(code!, pkce1.verifier);

    // -----------------------------------------------------------------------
    // Step 4: GET /api/oauth/grants → exactly one matching grant with
    // set-equal scopes (no privilege escalation).
    // -----------------------------------------------------------------------
    const grantsAfterApprove = await page.request.get('/api/oauth/grants');
    expect(grantsAfterApprove.status()).toBe(200);
    const grantsBody1 = (await grantsAfterApprove.json()) as {
      grants: Array<{
        client: { id: string; name: string };
        scopes: string[];
      }>;
    };
    const matching1 = grantsBody1.grants.filter(
      (g) => g.client.id === clientId,
    );
    expect(
      matching1.length,
      'exactly one grant for the test OAuth client after approval',
    ).toBe(1);
    expect(matching1[0].client.name).toBe(registeredClientName);
    expect(new Set(matching1[0].scopes)).toEqual(new Set(REQUESTED_SCOPES));

    // -----------------------------------------------------------------------
    // Step 5: Init OAuth flow #2 → already-consented short-circuit.
    //
    // After the first token exchange, Supabase Auth records the consent. On
    // a fresh /oauth/authorize call for the same client+scopes, Supabase
    // still issues a new authorization_id and routes the user to
    // /oauth/consent — but the consent page's `getAuthorizationDetails()`
    // call returns the OAuthRedirect branch (not OAuthAuthorizationDetails),
    // and the page server-redirects straight to the registered redirect URI
    // without rendering the Approve button.
    //
    // Important: the token exchange in Step 3 is what makes this branch
    // fire. If the token endpoint is never called, the consent state
    // remains incomplete and the second flow shows the form again — which
    // is also why this spec exchanges the code (don't strip that step).
    // -----------------------------------------------------------------------
    const state2 = `state-2-${crypto.randomBytes(8).toString('hex')}`;
    const pkce2 = makePkcePair();
    const init2 = await initOAuthFlow(
      accessToken,
      clientId,
      state2,
      pkce2.challenge,
    );
    expect(init2.authorizationId).toBeTruthy();

    // Navigate to the consent page; it should server-redirect to the
    // registered callback URI immediately. Use page.goto with no wait so
    // Playwright doesn't race the SSR redirect, then waitForURL.
    await page
      .goto(`/oauth/consent?authorization_id=${init2.authorizationId}`)
      .catch(() => undefined);
    await page.waitForURL(
      (url) => url.toString().startsWith(TEST_REDIRECT_URI),
      { timeout: 15000 },
    );
    const url2 = new URL(page.url());
    expect(`${url2.origin}${url2.pathname}`).toBe(TEST_REDIRECT_URI);
    expect(url2.searchParams.get('state')).toBe(state2);
    expect(url2.searchParams.get('code')).toBeTruthy();
    // Approve button must NOT be present at this URL.
    await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0);

    // -----------------------------------------------------------------------
    // Step 6: Revoke the grant via POST /api/oauth/revoke
    // -----------------------------------------------------------------------
    const revokeResp = await page.request.post('/api/oauth/revoke', {
      data: { clientId },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(revokeResp.status()).toBe(200);

    const grantsAfterRevoke = await page.request.get('/api/oauth/grants');
    expect(grantsAfterRevoke.status()).toBe(200);
    const grantsBody2 = (await grantsAfterRevoke.json()) as {
      grants: Array<{ client: { id: string; name: string } }>;
    };
    const matching2 = grantsBody2.grants.filter(
      (g) => g.client.id === clientId,
    );
    expect(
      matching2.length,
      'no grants for the test OAuth client after revocation',
    ).toBe(0);

    // -----------------------------------------------------------------------
    // Step 7: Init OAuth flow #3 → consent must be required again
    // -----------------------------------------------------------------------
    const state3 = `state-3-${crypto.randomBytes(8).toString('hex')}`;
    const pkce3 = makePkcePair();
    const init3 = await initOAuthFlow(
      accessToken,
      clientId,
      state3,
      pkce3.challenge,
    );
    expect(
      init3.authorizationId,
      'after revocation, /oauth/authorize must return a fresh authorization_id (consent re-required)',
    ).toBeTruthy();
    await page.goto(`/oauth/consent?authorization_id=${init3.authorizationId}`);
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: `Authorise ${registeredClientName}` }),
    ).toBeVisible();
  });
});
