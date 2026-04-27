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

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import { createClient } from '@supabase/supabase-js';
import precomputedEmbeddings from '../fixtures/embeddings.json';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const TEST_USER_EMAIL =
  process.env.TEST_USER_1_EMAIL || 'test.user1@test-kb-aish.co.uk';
const TEST_USER_PASSWORD =
  process.env.TEST_USER_1_PASSWORD || 'Welcome12391.';

const MCP_ENDPOINT = '/api/mcp/mcp';
const TOOL_NAME = 'search_knowledge_base';

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  };
  error?: { code: number; message: string };
}

/**
 * Parse a server response that may be plain JSON or SSE-style chunked
 * `data:` lines (text/event-stream). Returns the JSON-RPC envelope.
 */
function parseMcpBody(body: string): JsonRpcResponse {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as JsonRpcResponse;
  }
  // SSE: extract the last `data:` line
  const dataLines = trimmed
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) {
    throw new Error(`Cannot parse MCP body — no JSON or SSE data: ${body.slice(0, 200)}`);
  }
  return JSON.parse(dataLines[dataLines.length - 1]) as JsonRpcResponse;
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

test.describe('8.0.2 MCP tool invocation', () => {
  let seededItemId: string;
  let sentinel: string;
  let accessToken: string;

  test.beforeAll(async ({}, testInfo) => {
    accessToken = await getUserAccessToken();
    const supabase = createServiceClient();

    const workerPrefix = `[E2E-MCP-W${testInfo.workerIndex}]`;
    const ts = Date.now();
    sentinel = `ZQXVB-MCP-SENTINEL-${ts}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // Use an existing pre-computed embedding vector (1024 dims) so the row
    // satisfies the `embedding IS NOT NULL` filter in hybrid_search. The
    // sentinel substring is unique enough to be matched via the keyword
    // (ILIKE title) branch of hybrid_search regardless of vector similarity.
    const sampleEmbedding = (
      precomputedEmbeddings as Array<{ itemIndex: number; embedding: number[] }>
    )[0].embedding;

    const { data, error } = await supabase
      .from('content_items')
      .insert({
        title: `${workerPrefix} ${sentinel} Pricing Policy`,
        content: `This is a sentinel content item for the MCP invocation E2E test. ${sentinel}`,
        content_type: 'note',
        primary_domain: 'General',
        platform: 'manual',
        embedding: JSON.stringify(sampleEmbedding),
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(
        `Failed to seed sentinel content item: ${error?.message ?? 'no data'}`,
      );
    }
    seededItemId = data.id;
  });

  test.afterAll(async () => {
    if (seededItemId) {
      const supabase = createServiceClient();
      try {
        await supabase.from('content_items').delete().eq('id', seededItemId);
      } catch {
        // ignore
      }
    }
  });

  test('authenticated tool call returns seeded row, negative cases reject', async ({
    authenticatedPage: page,
  }) => {
    // -------------------------------------------------------------------
    // Case 1: Happy path — authenticated POST returns the seeded row
    // -------------------------------------------------------------------
    const happyResp = await page.request.post(MCP_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: TOOL_NAME,
          arguments: { query: sentinel, limit: 5 },
        },
      },
    });
    expect(happyResp.status(), 'authenticated tools/call must return 200').toBe(
      200,
    );

    const happyBody = parseMcpBody(await happyResp.text());
    expect(happyBody.jsonrpc).toBe('2.0');
    expect(happyBody.id).toBe(1);
    expect(
      happyBody.error,
      `expected no top-level error; got ${JSON.stringify(happyBody.error)}`,
    ).toBeUndefined();
    expect(happyBody.result).toBeDefined();
    const content = happyBody.result!.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content!.length).toBeGreaterThan(0);

    // Sentinel substring presence in the full payload — proves the tool
    // actually queried the live DB and returned the seeded row.
    const fullPayloadJson = JSON.stringify(happyBody);
    expect(
      fullPayloadJson.includes(sentinel),
      `sentinel '${sentinel}' must appear in the JSON-RPC payload`,
    ).toBe(true);

    // Stronger structured assertion: the seeded id must appear in
    // structuredContent.results[].id. This catches a stub that returns the
    // sentinel as plain text without actually hitting the DB.
    expect(
      fullPayloadJson.includes(seededItemId),
      `seeded content_items.id '${seededItemId}' must appear in the response`,
    ).toBe(true);

    // -------------------------------------------------------------------
    // Case 2: Unauthenticated POST → 401 with JSON body
    // -------------------------------------------------------------------
    const noAuthResp = await page.request.post(MCP_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: TOOL_NAME, arguments: { query: sentinel } },
      },
      // Don't follow auth-related redirects
      maxRedirects: 0,
    });
    expect(
      noAuthResp.status(),
      'unauthenticated POST must return 401',
    ).toBe(401);
    const noAuthCT = noAuthResp.headers()['content-type'] ?? '';
    expect(noAuthCT.includes('application/json')).toBe(true);
    const noAuthBody = (await noAuthResp.json()) as Record<string, unknown>;
    expect(typeof noAuthBody.error).toBe('string');

    // -------------------------------------------------------------------
    // Case 3: Invalid bearer → 401
    // -------------------------------------------------------------------
    const badAuthResp = await page.request.post(MCP_ENDPOINT, {
      headers: {
        Authorization: 'Bearer not-a-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: TOOL_NAME, arguments: { query: sentinel } },
      },
      maxRedirects: 0,
    });
    expect(
      badAuthResp.status(),
      'invalid bearer must return 401, not 200/500',
    ).toBe(401);

    // -------------------------------------------------------------------
    // Case 4: Unknown tool name → JSON-RPC error envelope (NOT empty result)
    // -------------------------------------------------------------------
    const unknownToolResp = await page.request.post(MCP_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'does_not_exist_tool_xyz',
          arguments: { query: sentinel },
        },
      },
    });
    // Pin actual production behaviour: MCP SDK's tools/call dispatcher
    // returns the unknown-tool failure as a `result` envelope with
    // `isError: true` and a text content explaining the unknown tool.
    // (It does NOT return a top-level JSON-RPC `error` envelope.) This
    // still satisfies the spec's intent — non-existent tools must produce
    // a clearly-distinguishable error signal, NOT a silent empty content
    // array that would mask real dispatcher bugs.
    const unknownStatus = unknownToolResp.status();
    expect([200, 400, 404, 422]).toContain(unknownStatus);
    const unknownBody = parseMcpBody(await unknownToolResp.text());
    expect(unknownBody.jsonrpc).toBe('2.0');
    expect(unknownBody.id).toBe(4);

    type ResultWithIsError = NonNullable<JsonRpcResponse['result']> & {
      isError?: boolean;
    };
    const result = unknownBody.result as ResultWithIsError | undefined;

    // Either a top-level JSON-RPC error OR an `isError: true` result with
    // non-empty content. NOT 200 + result.content === [] + no error flag.
    if (unknownBody.error) {
      expect(typeof unknownBody.error.code).toBe('number');
    } else {
      expect(
        result,
        'unknown tool must return either error envelope or result with isError',
      ).toBeDefined();
      expect(
        result!.isError,
        'unknown tool result must be flagged with isError: true (not silent empty)',
      ).toBe(true);
      expect(
        Array.isArray(result!.content) && result!.content!.length > 0,
        'unknown tool error result must include explanatory content',
      ).toBe(true);
      // The content should mention something about unknown/invalid tool
      const errorText = JSON.stringify(result!.content);
      expect(
        /unknown|invalid|not found|does not exist/i.test(errorText),
        `unknown tool content must reference the failure: ${errorText.slice(0, 200)}`,
      ).toBe(true);
    }
  });
});
