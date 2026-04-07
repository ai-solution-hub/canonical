/**
 * WP2 Phase 1 spec — 8.0.2 MCP tool invocation
 *
 * IMPORTANT — corrected after Phase 2 adversarial review:
 *   - The real MCP tool name is `search_knowledge_base` (verified against
 *     `docs/generated/mcp-inventory.md`, tool #1). NOT `search_kb`.
 *   - The transport endpoint is `/api/mcp/[transport]` (verified at
 *     `app/api/mcp/[transport]/route.ts`).
 *   - OAuth tokens are managed by Supabase Auth, NOT custom
 *     `mcp_oauth_access_tokens` tables. Phase 3 implementer cannot directly
 *     "service-key insert a token" — the bearer must be issued by completing
 *     a real OAuth flow (or by reusing a token from a fixture-provisioned
 *     grant).
 *
 * USER FLOW:
 *   1. Pre-seed a deterministic `content_items` row whose title contains a
 *      unique sentinel string (e.g. `[E2E-MCP-<workerPrefix>] Sentinel
 *      Pricing Policy <ts>`) via `createTestItem()` from `data-factory.ts`.
 *      The row MUST be embedded so `search_knowledge_base` can find it
 *      semantically — Phase 3 implementer must either (a) populate the
 *      `embedding` column directly via service key with a deterministic
 *      vector that aligns with the sentinel query, OR (b) call the
 *      ingestion embed step. Option (a) is preferred for determinism;
 *      use the existing `e2e/fixtures/embeddings.json` pattern if a fixture
 *      vector already exists, otherwise generate one in `beforeAll`.
 *   2. Obtain a valid bearer token for the admin test user. Phase 3 options:
 *        (a) Drive the OAuth flow end-to-end (as in 8.0.1) and exchange
 *            the issued code for an access token via the token endpoint.
 *        (b) Reuse an OAuth client provisioned in `beforeAll` and
 *            programmatically retrieve a token via Supabase Auth admin API.
 *      Phase 3 must NOT fabricate a JWT manually — that would not exercise
 *      the real auth path. Capture the bearer plaintext for the request.
 *   3. POST to `/api/mcp/[transport]` (verify the exact transport segment
 *      against current implementation; common values are `http` or `sse`)
 *      via `page.request.post()` with:
 *        - Header: `Authorization: Bearer <token>`
 *        - Header: `Content-Type: application/json`
 *        - Header: `Accept: application/json, text/event-stream`
 *        - Body: JSON-RPC 2.0 envelope:
 *          `{ jsonrpc: "2.0", id: 1, method: "tools/call",
 *             params: { name: "search_knowledge_base",
 *                       arguments: { query: "<sentinel substring>",
 *                                    limit: 5 } } }`
 *   4. Parse the response. If the transport returns an SSE-style payload,
 *      Phase 3 must parse the `data:` lines into a JSON-RPC envelope before
 *      asserting.
 *   5. Repeat with NO Authorization header → expect 401.
 *   6. Repeat with a deliberately invalid bearer (`Bearer not-a-token`) →
 *      expect 401.
 *   7. Repeat with a valid bearer but a `tools/call` for a non-existent
 *      tool name (e.g. `does_not_exist_tool`) → expect a JSON-RPC error
 *      envelope (NOT a 200 with empty content; NOT a 500 stack trace).
 *
 * ASSERTIONS (each must be verifiable from response state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure mode;
 * NO conditional skips):
 *   - Authenticated POST returns HTTP 200.
 *   - Response body parses as a JSON-RPC envelope with `jsonrpc === "2.0"`,
 *     `id === 1`, and a top-level `result` (NOT a top-level `error`).
 *   - `result.content` is a non-empty array (per MCP `tools/call` schema),
 *     AND the JSON-stringified payload of the WHOLE response contains the
 *     sentinel substring (proves the tool actually queried the live DB and
 *     returned the seeded row, not a cached/empty fixture).
 *   - Parse the `result.content[0].text` (or whichever entry is the
 *     structured payload — Phase 3 must verify against the
 *     `search_knowledge_base` tool's documented output schema in
 *     `lib/mcp/tools/search/`) and assert the seeded `content_items.id`
 *     appears in an `items[].id`-style field. (Substring presence in the
 *     JSON blob is necessary; structured ID match is sufficient.)
 *   - Unauthenticated POST returns HTTP 401 AND the body parses as JSON
 *     with an explicit error key (NOT 200, NOT 302/303 redirect, NOT
 *     HTML error page).
 *   - Invalid-bearer POST returns HTTP 401 (NOT 500, NOT 200 with empty
 *     `result.content`).
 *   - Unknown-tool-name POST returns either (i) HTTP 200 with a JSON-RPC
 *     `error` object whose `code` is the MCP "method not found" or
 *     "tool not found" sentinel, OR (ii) HTTP 4xx with a JSON error body.
 *     Phase 3 implementer must pin the actual production behaviour. NOT
 *     200 with `result.content === []` (that would mask a real bug where
 *     valid tool names also return empty).
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - Sentinel `content_items` row + embedding — seeded via service-key
 *     insert in this file's `beforeAll`. Use a worker-prefixed title to
 *     remain isolated and cleanable.
 *   - OAuth client + active grant + access token — see step 2 above.
 *     Phase 3 implementer documents the chosen approach in the test file.
 *   - Existing worker-scoped fixture data is NOT relied on (this spec must
 *     run independently of `workerData`).
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - MCP transport regresses to mcp-handler on Vercel and hangs / 500s →
 *     caught by HTTP 200 + JSON-RPC envelope assertion.
 *   - Bearer token validation accepts any non-empty string → caught by
 *     the invalid-bearer 401 assertion.
 *   - Auth middleware lets unauthenticated requests through → caught by
 *     no-Authorization 401 assertion.
 *   - Tool dispatcher returns an empty `result.content` array regardless
 *     of arguments (silent failure) → caught by sentinel substring +
 *     content_items.id presence assertions.
 *   - JSON-RPC `id` echoed incorrectly → caught by `id === 1` assertion.
 *   - Unknown tool names silently return empty results instead of an
 *     error envelope (which would mask real bugs in valid-tool dispatch)
 *     → caught by the unknown-tool-name assertion.
 *   - `search_knowledge_base` is registered but the underlying handler
 *     returns rows from the wrong RLS context (e.g. service-role bypass
 *     leak) → partially caught by the seeded-row presence (production
 *     row should be returned for admin); a stricter follow-up test belongs
 *     in 8.0.6.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture for browser context, but the
 *   actual MCP call is via `page.request.post()` with a bearer token, so
 *   role scoping is enforced by the token grant (admin user). Reason:
 *   admin is the broadest scope and proves the happy path.
 *
 * CLEANUP:
 *   afterAll: service-key delete of seeded `content_items` row (and its
 *   embedding row). Revoke the test OAuth grant via `/api/oauth/revoke`.
 *   No afterEach — the spec is a single happy path + three negative cases
 *   that share the same seeded fixture state.
 *
 * EXPLICIT FORBIDDEN PATTERNS (Phase 3 implementer must NOT do these):
 *   - DO NOT mock the MCP handler or any layer of the MCP server. The
 *     test must POST against the real running Next.js dev server route.
 *   - DO NOT manually craft a JWT or sign a fake bearer — the bearer
 *     MUST come from a real OAuth flow / Supabase Auth issuance.
 *   - DO NOT wrap any assertion in `if (status === 200)` or similar.
 *     Every assertion must run unconditionally, including the negative
 *     cases.
 *   - DO NOT replace the sentinel-substring assertion with a "result.content
 *     is non-empty" assertion alone — non-emptiness is satisfiable by any
 *     stub that returns `[{ text: "anything" }]`.
 */
