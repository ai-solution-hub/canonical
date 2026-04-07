/**
 * WP2 Phase 1 spec — 8.0.2 MCP tool invocation
 *
 * USER FLOW:
 *   1. Pre-seed an `mcp_oauth_clients` row + an active `mcp_oauth_grants`
 *      row + a valid `mcp_oauth_access_tokens` row for the admin test user
 *      (all via service-role client). Capture the bearer token plaintext.
 *   2. Pre-seed a deterministic `content_items` row whose title contains a
 *      unique sentinel string (e.g. `[E2E-MCP-<workerPrefix>] Sentinel
 *      Pricing Policy`) and whose `content` field contains an unambiguous
 *      phrase. Embed via existing `embeddings.json` fixture or skip
 *      embedding and rely on keyword search if the chosen tool supports it.
 *   3. POST to the MCP HTTP transport endpoint
 *      (`/api/mcp/[transport]` — verify exact path against current
 *      implementation in Phase 3) with:
 *        - Header: `Authorization: Bearer <token>`
 *        - Header: `Content-Type: application/json`
 *        - Body: a JSON-RPC 2.0 envelope `{ jsonrpc: "2.0", id: 1,
 *          method: "tools/call", params: { name: "search_kb",
 *          arguments: { query: "<sentinel substring>" } } }` (replace
 *          tool name with the actual tool resolved from
 *          `docs/generated/mcp-inventory.md`).
 *   4. Parse the response. Use `page.request.post()` so Playwright tracks
 *      the call as part of the test.
 *   5. Repeat with NO Authorization header → expect 401.
 *   6. Repeat with a deliberately invalid bearer (`Bearer not-a-token`) →
 *      expect 401.
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode):
 *   - Authenticated POST returns HTTP 200.
 *   - Response body is valid JSON, has `jsonrpc === "2.0"`, `id === 1`, and
 *     a top-level `result` object (NOT an `error` object).
 *   - `result.content` is an array (per MCP tool/call spec) with at least
 *     one entry; the JSON-stringified payload contains the sentinel
 *     substring from the seeded item (proves the tool actually queried the
 *     live DB and returned the seeded row, not a cached/empty fixture).
 *   - The seeded `content_items.id` appears somewhere in the structured
 *     response (parsed via the tool's documented output schema, e.g. an
 *     `items[].id` field).
 *   - Unauthenticated POST returns 401 with a JSON-RPC `error` envelope
 *     (NOT 200, NOT a redirect to /login).
 *   - Invalid-bearer POST returns 401 (NOT 500, NOT 200 with empty body).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - OAuth client + grant + access_token rows — seeded in this file's
 *     beforeAll via service-key inserts. Bearer token is generated from
 *     whatever signing/storage scheme `mcp_oauth_access_tokens` uses;
 *     Phase 3 implementer must follow the same path used by
 *     `lib/mcp/oauth/*` token issuance.
 *   - Sentinel `content_items` row — seeded via service-key insert with a
 *     worker-prefixed title to remain isolated and cleanable.
 *   - Existing worker-scoped fixture data is NOT relied on (this spec must
 *     run independently of `workerData`).
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - MCP transport regresses to mcp-handler on Vercel and hangs / 500s →
 *     caught by HTTP 200 + JSON-RPC envelope assertion.
 *   - Bearer token validation accepts any non-empty string → caught by the
 *     invalid-bearer 401 assertion.
 *   - Auth middleware lets unauthenticated requests through → caught by
 *     no-Authorization 401 assertion.
 *   - Tool dispatcher returns an empty `result.content` array regardless
 *     of arguments (silent failure) → caught by sentinel substring +
 *     content_items.id presence assertions.
 *   - JSON-RPC `id` echoed incorrectly → caught by `id === 1` assertion.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture for browser context, but the
 *   actual MCP call is via `page.request.post()` with a bearer token, so
 *   role scoping is enforced by the token grant (admin user). Reason:
 *   admin is the broadest scope and proves the happy path; viewer-scope
 *   negative cases are 8.0.6 territory.
 *
 * CLEANUP:
 *   afterAll: service-key delete of seeded `mcp_oauth_access_tokens`,
 *   `mcp_oauth_grants`, `mcp_oauth_clients`, and `content_items` rows by
 *   their captured ids. No afterEach — the spec is a single happy path +
 *   two negative cases that share the same seeded fixture state.
 */
