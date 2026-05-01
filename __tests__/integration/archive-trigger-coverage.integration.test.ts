/**
 * §5.2 Phase 3 pre-flight check (S209 WP2 A1, S216 W1) —
 * archived_at trigger-coverage integration test.
 *
 * Goal: verify the §6.6 BIDIRECTIONAL trigger
 * `enforce_archive_state_consistency` fires on every CURRENT direct
 * `archived_at` writer in the codebase. After each write, the post-write
 * row MUST satisfy
 *   `publication_status='archived' ↔ archived_at IS NOT NULL`
 * (the load-bearing direction here is Direction 3 — see spec §6.6).
 *
 * Why this gate matters (spec §10.3 verbatim, lines 1751-1770):
 *
 *   "The Phase 3 RPC simplification (`archived_at IS NULL` →
 *    `publication_status='published'`, per §5.3 RPC body update pattern)
 *    only holds if the §6.6 BIDIRECTIONAL trigger
 *    `enforce_archive_state_consistency` fires on **every** legacy
 *    `archived_at` write path. Direction 3 (the trigger fires on direct
 *    `archived_at` writes) is the load-bearing direction here. Run an
 *    integration test against staging that round-trips through every
 *    known direct `archived_at` writer and asserts that the post-write
 *    row has `publication_status='archived'`:
 *      - app/api/items/[id]/archive/route.ts:53-62 (direct `archived_at`
 *        write via PATCH `/api/items/[id]/archive`).
 *      - MCP `delete_content_item` tool handler (writes `archived_at`
 *        per audit §2.4).
 *      - Supersession path via `lib/supersession/set.ts` (sets
 *        `archived_at` on the OLD row).
 *
 *    If any path bypasses the trigger (e.g. `INSERT ... ON CONFLICT
 *    DO UPDATE` would skip BEFORE UPDATE on the inserted row; bulk
 *    operations may need explicit trigger invocation), Phase 3 cannot
 *    ship the simplified `WHERE` clause without falling back to the
 *    dual filter `(publication_status='published' OR
 *    archived_at IS NULL)`."
 *
 * V_W1 HIGH fix (S216 W2): The spec was authored before S211B shipped
 * the §1.7 admin dedup review surface, so §10.3 above only enumerates
 * two direct `archived_at` writers. A third now exists in production:
 *      - app/api/admin/content-dedup/[id]/confirm-duplicate/route.ts:88-98
 *        (admin confirms a suspected-duplicate as an actual duplicate;
 *        UPDATE writes `archived_at`/`archived_by`/`archive_reason` and
 *        `dedup_status='confirmed_duplicate'` — no `publication_status`
 *        in the SET clause, so Direction 3 must flip it to 'archived').
 *   Without the W1 pre-flight covering this writer, the gate verdict
 *   was a false-positive PASS. Writer-3 block below closes the gap.
 *   Backlog item: spec §6.1 / §10.3 cross-reference updates queued
 *   for the W1→W3 handoff to align spec text with the test.
 *
 * Spec drift NOTE (S216 W1 brief observation):
 *   Spec §10.3 line 1761 describes the route as "PATCH /api/items/[id]/
 *   archive" but the actual handler in `app/api/items/[id]/archive/
 *   route.ts:22` is `POST`. The test invokes the production POST handler
 *   directly. A spec edit is queued for the W1 handoff.
 *
 * §6.6 trigger Direction 3 — the production-bridge predicate (verbatim
 * from `supabase/migrations/20260427141627_publication_status_indexes_and_trigger.sql`,
 * lines 93-102):
 *
 *   IF NEW.archived_at IS NOT NULL
 *      AND (OLD.archived_at IS NULL OR OLD.archived_at IS DISTINCT FROM NEW.archived_at)
 *      AND NEW.publication_status != 'archived'
 *   THEN
 *     NEW.publication_status := 'archived';
 *   END IF;
 *
 * Acceptance criteria covered:
 *   - AC1.10 (Direction 1 control case — proves trigger as a whole is firing).
 *   - AC1.11 (Direction 3 — load-bearing for Phase 3 simplification).
 *
 * S217 W1A drift backfill — writer 4 (supersession) now covered:
 *   `lib/supersession/set.ts:226-244` writes `publication_status='archived'`,
 *   `archived_at`, `archived_by`, `archive_reason` on the OLD row (Phase 5
 *   §6.5, shipped S216 W6). The §6.6 trigger Directions 1 + 3 are BOTH
 *   no-op pass-throughs on this writer because the UPDATE payload supplies
 *   `publication_status='archived'` AND `archived_at` simultaneously —
 *   the writer upholds the invariant on its own. Coverage is in the
 *   "writer 4" describe block at the end of this file; assertions target
 *   the post-write invariant per spec §10.3 / AC1.11, not trigger
 *   fire-mechanism. Spec §10.3 enumeration of the three writers is now
 *   stale by one entry — backlog item queued for the W1A handoff.
 *
 * Spec sections: §6.6 (trigger), §10.3 (pre-flight check), AC1.10/1.11.
 *
 * Prereqs:
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL,
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *     TEST_USER_1_PASSWORD, TEST_USER_2_PASSWORD.
 *   - Migration `20260427141627_publication_status_indexes_and_trigger.sql`
 *     applied on the target DB (verified live on `rovrymhhffssilaftdwd`
 *     and on the staging branch `turayklvaunphgbgscat`).
 *   - `bun run seed:e2e-users` has been run against the target DB.
 *
 * Runs via: `bun run test:integration -- archive-trigger-coverage`
 *   (NOT picked up by `bun run test`; integration runner only — see
 *   feedback_test_runners_split + feedback_integration_test_location.)
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars.
import { serviceClient } from './helpers/service-client';
import {
  cacheAllTestUserSessions,
  restoreSession,
  getTestUserId,
  type AuthCookieStore,
  type AuthCookieEntry,
  type CachedSessions,
} from './helpers/auth-session';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Mock next/headers at file scope so the hoisted authCookies is shared with
// the production createClient() code path used by the POST archive route.
// Same pattern as items-patch-publication-status.integration.test.ts.
// ---------------------------------------------------------------------------

const { authCookies, cachedSessions } = vi.hoisted(() => ({
  authCookies: new Map<
    string,
    { name: string; value: string }
  >() as AuthCookieStore,
  cachedSessions: {
    admin: new Map(),
    editor: new Map(),
    viewer: new Map(),
  } as unknown as CachedSessions,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      Array.from(authCookies.values()).map(
        ({ name, value }): AuthCookieEntry => ({ name, value }),
      ),
    get: (name: string) => authCookies.get(name),
    set: (name: string, value: string) => {
      authCookies.set(name, { name, value });
    },
  }),
}));

// Imports AFTER the mock is registered.
const { POST: archivePost } = await import(
  '@/app/api/items/[id]/archive/route'
);
const { POST: confirmDuplicatePost } = await import(
  '@/app/api/admin/content-dedup/[id]/confirm-duplicate/route'
);
const { registerGovernanceTools } = await import('@/lib/mcp/tools/governance');
const { setSupersession } = await import('@/lib/supersession/set');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[ARCHIVE-TRIG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededIds: string[] = [];
let TEST_USER_ADMIN_ID = '';
let TEST_USER_EDITOR_ID = '';

// MCP bearer tokens harvested in beforeAll via supabase-js signInWithPassword
// (the SSR cookie store does not expose the access_token, so we resolve it
// once per file via a parallel sign-in for the MCP-tool test cases).
let mcpAdminToken = '';
let mcpEditorToken = '';

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.TEST_USER_1_PASSWORD &&
    process.env.TEST_USER_2_PASSWORD,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Direct service-role insert. We deliberately bypass the production
 * archive code path here — we want a clean baseline at the requested
 * `publication_status` so each test can immediately exercise the
 * archive transition.
 *
 * `content_text_hash` is GENERATED ALWAYS so it MUST be omitted
 * (CLAUDE.md gotcha: `feedback_content_text_hash_generated_always`).
 *
 * INSERT does NOT fire the BEFORE UPDATE trigger so seeding with
 * `publication_status='archived'` requires explicit `archived_at` to
 * uphold the spec invariant on the seed row.
 */
async function seedItem(
  initialStatus: 'draft' | 'in_review' | 'published' | 'archived',
  label: string,
  ownerId: string,
): Promise<string> {
  const archiveMetadata =
    initialStatus === 'archived'
      ? {
          archived_at: new Date().toISOString(),
          archived_by: ownerId,
          archive_reason: 'Seed-time archive metadata for fixture',
        }
      : {};

  const { data, error } = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} ${label}`,
      content: `Archive trigger coverage fixture: ${label}. Disposable.`,
      content_type: 'article',
      publication_status: initialStatus,
      created_by: ownerId,
      ...archiveMetadata,
    })
    .select('id, publication_status, archived_at')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  if (data.publication_status !== initialStatus) {
    throw new Error(
      `Seed item "${label}" baseline drift: requested ${initialStatus}, got ${data.publication_status}`,
    );
  }

  seededIds.push(data.id);
  return data.id;
}

async function readRow(itemId: string) {
  const { data, error } = await serviceClient
    .from('content_items')
    .select(
      'publication_status, archived_at, archived_by, archive_reason, dedup_status, superseded_by',
    )
    .eq('id', itemId)
    .single();
  if (error || !data) {
    throw new Error(
      `readRow(${itemId}) failed: ${error?.message ?? 'no data'}`,
    );
  }
  return data;
}

/**
 * Invoke the production POST archive route handler.
 * NOTE: spec §10.3 line 1761 says "PATCH" — actual route is POST. See
 * file-header drift note.
 */
async function postArchive(
  itemId: string,
  body: { reason: string },
): Promise<Response> {
  const req = new NextRequest(
    `http://localhost/api/items/${itemId}/archive`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
  return archivePost(req, { params: Promise.resolve({ id: itemId }) });
}

/**
 * Invoke the production POST confirm-duplicate route handler.
 * Writer 3 — shipped via S211B (admin dedup review surface) after the
 * §5.2 Phase 3 spec was authored. Direction 3 of the §6.6 trigger MUST
 * fire on this path too.
 */
async function postConfirmDuplicate(
  itemId: string,
  body: { note?: string },
): Promise<Response> {
  const req = new NextRequest(
    `http://localhost/api/admin/content-dedup/${itemId}/confirm-duplicate`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
  return confirmDuplicatePost(req, {
    params: Promise.resolve({ id: itemId }),
  });
}

/**
 * Set `dedup_status` on a seeded row via service-role UPDATE.
 * The `seedItem()` helper INSERTs with the column defaulted to `'clean'`,
 * so the dedup-flow tests must flip it to `'suspected_duplicate'` (or
 * `'confirmed_duplicate'` for the idempotency case) before invoking the
 * production handler.
 *
 * INSERT does not fire BEFORE UPDATE on the inserted row, but a plain
 * UPDATE that sets only `dedup_status` does — predicate Direction 3
 * does NOT match (we are not writing `archived_at`), so this update
 * leaves `publication_status`/`archived_at` untouched. Verified safe.
 */
async function setDedupStatus(
  itemId: string,
  status: 'suspected_duplicate' | 'confirmed_duplicate',
): Promise<void> {
  const { error } = await serviceClient
    .from('content_items')
    .update({ dedup_status: status })
    .eq('id', itemId);
  if (error) {
    throw new Error(
      `setDedupStatus(${itemId}, ${status}) failed: ${error.message}`,
    );
  }
}

interface CapturedTool {
  name: string;
  config: Record<string, unknown>;
  callback: (...args: unknown[]) => unknown;
}

/**
 * Register the MCP governance tools against an in-memory mock
 * `McpServer` and return the captured `delete_content_item` tool.
 * This is the same pattern used by the unit-test files in
 * `__tests__/mcp/`, lifted into the integration suite so we can invoke
 * the real handler against the real DB through a real authInfo bearer
 * token (no mocked auth helpers, no mocked supabase).
 */
async function registerAndCapture(): Promise<{
  deleteContentItem: CapturedTool;
}> {
  const tools: CapturedTool[] = [];
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        config: Record<string, unknown>,
        cb: (...args: unknown[]) => unknown,
      ) => {
        tools.push({ name, config, callback: cb });
        return { enabled: true } as unknown as RegisteredTool;
      },
    ),
  } as unknown as McpServer;

  await registerGovernanceTools(server);
  const deleteContentItem = tools.find((t) => t.name === 'delete_content_item');
  if (!deleteContentItem) {
    throw new Error('delete_content_item tool not registered');
  }
  return { deleteContentItem };
}

/**
 * Build an `AuthInfo` shaped exactly like `verifyToken()` produces in
 * `app/api/mcp/[transport]/route.ts:71-76`. We feed in a real bearer
 * token (so `createMcpClient` returns a real RLS-scoped client) plus
 * the cached userId + role.
 */
function buildAuthInfo(
  token: string,
  userId: string,
  role: 'admin' | 'editor',
): AuthInfo {
  return {
    token,
    clientId: 'integration-test',
    scopes: [],
    extra: { userId, role },
  };
}

interface McpToolResult {
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function callDeleteContentItemArchive(
  tool: CapturedTool,
  itemId: string,
  reason: string,
  authInfo: AuthInfo,
): Promise<McpToolResult> {
  const extra = {
    authInfo,
    signal: new AbortController().signal,
    sendNotification: () => Promise.resolve(),
    sendRequest: () => Promise.resolve({}),
    requestId: `archive-trig-${Date.now()}`,
    sendElicitationRequest: () => Promise.resolve({}),
    _meta: undefined,
  };
  return (await tool.callback(
    { id: itemId, mode: 'archive', reason },
    extra,
  )) as McpToolResult;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  TEST_USER_ADMIN_ID = await getTestUserId('admin');
  TEST_USER_EDITOR_ID = await getTestUserId('editor');
  await cacheAllTestUserSessions(cachedSessions);

  // Harvest MCP bearer tokens via supabase-js (parallel to the SSR
  // sessions used by the route handler). Each MCP test calls the tool
  // handler directly with the AuthInfo we construct from these tokens.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  const adminClient = createSupabaseClient(url, anonKey);
  const adminSignIn = await adminClient.auth.signInWithPassword({
    email: 'test.user1@test-kb-aish.co.uk',
    password: process.env.TEST_USER_1_PASSWORD!,
  });
  if (adminSignIn.error || !adminSignIn.data.session) {
    throw new Error(
      `MCP admin sign-in failed: ${adminSignIn.error?.message ?? 'no session'}`,
    );
  }
  mcpAdminToken = adminSignIn.data.session.access_token;

  const editorClient = createSupabaseClient(url, anonKey);
  const editorSignIn = await editorClient.auth.signInWithPassword({
    email: 'test.user2@test-kb-aish.co.uk',
    password: process.env.TEST_USER_2_PASSWORD!,
  });
  if (editorSignIn.error || !editorSignIn.data.session) {
    throw new Error(
      `MCP editor sign-in failed: ${editorSignIn.error?.message ?? 'no session'}`,
    );
  }
  mcpEditorToken = editorSignIn.data.session.access_token;
}, 30_000);

beforeEach(() => {
  if (!HAS_REQUIRED_ENV) return;
  // POST /api/items/[id]/archive accepts admin + editor; default the
  // SSR cookie store to admin and switch per-test if needed.
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  if (seededIds.length === 0) return;
  // content_history rows are emitted by the auto_version AFTER INSERT
  // trigger plus by the MCP `delete_content_item` archive branch.
  // Delete history first so the FK to content_items does not block.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);
  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 30_000);

// ===========================================================================
// Tests
// ===========================================================================

describeIfEnv(
  'Archive trigger coverage — POST /api/items/[id]/archive (writer 1)',
  () => {
    it(
      'Case A — happy path: published row → POST archive → trigger Direction 3 fires',
      async () => {
        // Spec §10.3 pre-flight requirement: round-trip the writer and
        // assert post-write row has publication_status='archived'.
        const itemId = await seedItem(
          'published',
          'route-A-happy-path',
          TEST_USER_ADMIN_ID,
        );

        // Sanity baseline: archived_at IS NULL, publication_status='published'.
        const pre = await readRow(itemId);
        expect(pre.publication_status).toBe('published');
        expect(pre.archived_at).toBeNull();

        const reason = 'Pre-flight A1: route happy-path';
        const beforeMs = Date.now();
        const res = await postArchive(itemId, { reason });

        expect(
          res.status,
          `archive POST failed: ${await res.clone().text()}`,
        ).toBe(200);

        const post = await readRow(itemId);
        // CORE PRE-FLIGHT ASSERTION (spec §10.3 + AC1.11).
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        const archivedTs = new Date(post.archived_at as string).getTime();
        expect(archivedTs).toBeGreaterThanOrEqual(beforeMs - 5_000);
        expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
        expect(post.archived_by).toBe(TEST_USER_ADMIN_ID);
        expect(post.archive_reason).toBe(reason);
      },
      60_000,
    );

    it(
      'Case B — already-archived idempotency: route allows re-archive (overwrites archived_at)',
      async () => {
        // Behaviour-check per W1 brief: route SHOULD allow re-archive
        // and overwrite archived_at to a fresh timestamp; trigger
        // Direction 3 still fires (predicate matches because
        // OLD.archived_at IS DISTINCT FROM NEW.archived_at), keeping
        // publication_status='archived'.
        const itemId = await seedItem(
          'archived',
          'route-B-idempotent',
          TEST_USER_ADMIN_ID,
        );

        const pre = await readRow(itemId);
        const preTs = pre.archived_at as string;
        expect(pre.publication_status).toBe('archived');
        expect(preTs).not.toBeNull();

        // Wait a small interval so the new timestamp is strictly later.
        await new Promise((r) => setTimeout(r, 50));

        const reason = 'Pre-flight A1: route idempotency check';
        const res = await postArchive(itemId, { reason });
        expect(res.status, await res.clone().text()).toBe(200);

        const post = await readRow(itemId);
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        // Route writes a fresh timestamp; assert it is strictly later
        // than the seed-time stamp (no row state corruption).
        expect(
          new Date(post.archived_at as string).getTime(),
        ).toBeGreaterThan(new Date(preTs).getTime());
        expect(post.archived_by).toBe(TEST_USER_ADMIN_ID);
        expect(post.archive_reason).toBe(reason);
      },
      60_000,
    );
  },
);

describeIfEnv(
  'Archive trigger coverage — MCP delete_content_item archive mode (writer 2)',
  () => {
    it(
      'Case A — happy path: editor archives published row → trigger Direction 3 fires',
      async () => {
        const itemId = await seedItem(
          'published',
          'mcp-A-happy-path',
          TEST_USER_EDITOR_ID,
        );

        const pre = await readRow(itemId);
        expect(pre.publication_status).toBe('published');
        expect(pre.archived_at).toBeNull();

        const { deleteContentItem } = await registerAndCapture();
        const authInfo = buildAuthInfo(
          mcpEditorToken,
          TEST_USER_EDITOR_ID,
          'editor',
        );

        const reason = 'Pre-flight A1: MCP happy-path';
        const beforeMs = Date.now();
        const result = await callDeleteContentItemArchive(
          deleteContentItem,
          itemId,
          reason,
          authInfo,
        );

        expect(
          result.isError,
          `MCP archive returned isError=true: ${JSON.stringify(result)}`,
        ).not.toBe(true);

        const post = await readRow(itemId);
        // CORE PRE-FLIGHT ASSERTION (spec §10.3 + AC1.11).
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        const archivedTs = new Date(post.archived_at as string).getTime();
        expect(archivedTs).toBeGreaterThanOrEqual(beforeMs - 5_000);
        expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
        expect(post.archived_by).toBe(TEST_USER_EDITOR_ID);
        expect(post.archive_reason).toBe(reason);
      },
      60_000,
    );

    it(
      'Case B — already-archived: MCP returns "already archived" message and does NOT write to DB',
      async () => {
        // Per `lib/mcp/tools/governance.ts:142-152`, the MCP archive
        // branch short-circuits with a non-error message when the row
        // is already archived. Assert: archived_at timestamp unchanged
        // from seed (no DB write occurred).
        const itemId = await seedItem(
          'archived',
          'mcp-B-already-archived',
          TEST_USER_ADMIN_ID,
        );

        const pre = await readRow(itemId);
        const preTs = pre.archived_at as string;
        expect(pre.publication_status).toBe('archived');

        const { deleteContentItem } = await registerAndCapture();
        const authInfo = buildAuthInfo(
          mcpAdminToken,
          TEST_USER_ADMIN_ID,
          'admin',
        );

        const result = await callDeleteContentItemArchive(
          deleteContentItem,
          itemId,
          'Pre-flight A1: MCP already-archived check',
          authInfo,
        );

        // The handler returns a normal-shaped response (no isError) with
        // the "already archived" guidance text. Assert text contains the
        // canonical phrase and DB state is unchanged.
        expect(result.isError).not.toBe(true);
        const firstChunk = result.content?.[0]?.text ?? '';
        expect(firstChunk).toContain('is already archived');

        const post = await readRow(itemId);
        expect(post.publication_status).toBe('archived');
        // archived_at MUST equal pre-seed value (no DB UPDATE occurred).
        expect(post.archived_at).toBe(preTs);
      },
      60_000,
    );
  },
);

describeIfEnv(
  'Archive trigger coverage — POST /api/admin/content-dedup/[id]/confirm-duplicate (writer 3)',
  () => {
    it(
      'Case A — happy path: suspected_duplicate row → POST confirm-duplicate → trigger Direction 3 fires',
      async () => {
        // Writer 3 — shipped via S211B (admin dedup review surface)
        // after the §5.2 Phase 3 spec was authored. Phase 3's
        // simplified WHERE clause (`archived_at IS NULL` →
        // `publication_status='published'`) only holds if Direction 3
        // fires on this writer too. Spec drift queued: §6.1 / §10.3
        // cross-reference for backlog.
        //
        // Route: app/api/admin/content-dedup/[id]/confirm-duplicate/
        //   route.ts:88-98 — UPDATE writes `archived_at`, `archived_by`,
        //   `archive_reason='dedup_admin_confirmed_duplicate'`,
        //   `dedup_status='confirmed_duplicate'` — NO publication_status
        //   in the SET clause. Direction 3 must flip it to 'archived'.
        const itemId = await seedItem(
          'published',
          'dedup-A-happy-path',
          TEST_USER_ADMIN_ID,
        );
        await setDedupStatus(itemId, 'suspected_duplicate');

        const pre = await readRow(itemId);
        expect(pre.publication_status).toBe('published');
        expect(pre.archived_at).toBeNull();
        expect(pre.dedup_status).toBe('suspected_duplicate');

        // Admin session restored in beforeEach; route enforces ['admin']
        // and authFailureResponse() routes other roles to 403/401.
        const beforeMs = Date.now();
        const res = await postConfirmDuplicate(itemId, {
          note: 'V_W1 fix coverage',
        });

        expect(
          res.status,
          `confirm-duplicate POST failed: ${await res.clone().text()}`,
        ).toBe(200);

        const post = await readRow(itemId);
        // CORE PRE-FLIGHT ASSERTION (spec §10.3 + AC1.11) — Direction 3
        // fires on the dedup writer.
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        const archivedTs = new Date(post.archived_at as string).getTime();
        expect(archivedTs).toBeGreaterThanOrEqual(beforeMs - 5_000);
        expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
        expect(post.archived_by).toBe(TEST_USER_ADMIN_ID);
        expect(post.archive_reason).toBe('dedup_admin_confirmed_duplicate');
        expect(post.dedup_status).toBe('confirmed_duplicate');

        // content_history audit row — route inserts with
        // change_type='archive' + change_reason='dedup_admin_review_
        // confirmed_duplicate'. Mirror W1's existing history-style
        // assertion: assert at least one row of that exact shape exists.
        const { data: historyRows, error: historyErr } = await serviceClient
          .from('content_history')
          .select('change_type, change_reason')
          .eq('content_item_id', itemId)
          .eq('change_type', 'archive')
          .eq('change_reason', 'dedup_admin_review_confirmed_duplicate');
        expect(historyErr).toBeNull();
        expect(historyRows).not.toBeNull();
        expect((historyRows ?? []).length).toBeGreaterThanOrEqual(1);
      },
      60_000,
    );

    it(
      'Case B — idempotency 409: already-resolved row is rejected and DB state unchanged',
      async () => {
        // Per route.ts:76-84, the handler rejects with HTTP 409 when
        // dedup_status is no longer 'suspected_duplicate'. Pre-flight
        // contract: the rejected request MUST NOT mutate
        // publication_status or archived_at (Direction 3 contract relies
        // on the writer being the ONLY mutator of archived_at on this
        // path; an idempotency leak would corrupt §5.2 Phase 3 reasoning).
        const itemId = await seedItem(
          'published',
          'dedup-B-idempotent',
          TEST_USER_ADMIN_ID,
        );
        await setDedupStatus(itemId, 'confirmed_duplicate');

        // Stamp a fixed prior archived_at via service-role UPDATE so we
        // can assert epoch-equal preservation post-409. We deliberately
        // set both archived_at and publication_status='archived' here
        // so the §6.6 trigger Direction 3 predicate is satisfied on
        // this seed UPDATE (NEW.publication_status IS already archived
        // → no-op), leaving a coherent post-seed state to compare
        // against. NOTE: PostgreSQL serialises timestamps with offset
        // notation (`+00:00`) rather than the input `Z` suffix, so all
        // archived_at comparisons normalise via Date.parse() / .getTime()
        // for instant equality rather than byte equality.
        const priorTimestampInput = '2026-01-15T10:30:00.000Z';
        const priorEpochMs = Date.parse(priorTimestampInput);
        const { error: stampErr } = await serviceClient
          .from('content_items')
          .update({
            archived_at: priorTimestampInput,
            publication_status: 'archived',
            archived_by: TEST_USER_ADMIN_ID,
            archive_reason: 'prior-archive-for-idempotency-fixture',
          })
          .eq('id', itemId);
        expect(stampErr).toBeNull();

        const pre = await readRow(itemId);
        expect(pre.publication_status).toBe('archived');
        expect(pre.archived_at).not.toBeNull();
        expect(new Date(pre.archived_at as string).getTime()).toBe(
          priorEpochMs,
        );
        expect(pre.dedup_status).toBe('confirmed_duplicate');

        const res = await postConfirmDuplicate(itemId, {
          note: 'V_W1 fix coverage — idempotency check',
        });

        expect(res.status).toBe(409);
        const body = (await res.json()) as {
          error: string;
          current_status?: string;
        };
        expect(body.error).toBe('row already resolved');
        expect(body.current_status).toBe('confirmed_duplicate');

        // DB state UNCHANGED — the 409 short-circuit must not write.
        // archived_at must round-trip to the same instant we stamped.
        const post = await readRow(itemId);
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        expect(new Date(post.archived_at as string).getTime()).toBe(
          priorEpochMs,
        );
        expect(post.archived_by).toBe(TEST_USER_ADMIN_ID);
        expect(post.archive_reason).toBe(
          'prior-archive-for-idempotency-fixture',
        );
        expect(post.dedup_status).toBe('confirmed_duplicate');
      },
      60_000,
    );
  },
);

describeIfEnv(
  'Archive trigger coverage — Direction 1 control case (no regression)',
  () => {
    it(
      'service-role UPDATE setting publication_status=archived (without archived_at) fires Direction 1',
      async () => {
        // Inverse direction proves the trigger as a whole is firing,
        // not just Direction 3. Per spec §6.6 lines 84-86:
        //
        //   IF NEW.publication_status = 'archived' AND NEW.archived_at IS NULL THEN
        //     NEW.archived_at := NOW();
        //   END IF;
        //
        // This is AC1.10: covered by the existing
        // `publication-status-trigger.integration.test.ts` but re-asserted
        // here as the control case for the W1 pre-flight contract — if
        // Direction 1 stops firing, the same migration regression would
        // also disable Direction 3 (both directions live in the same
        // function), so this test is the canary.
        const itemId = await seedItem(
          'published',
          'direction-1-control',
          TEST_USER_ADMIN_ID,
        );

        const pre = await readRow(itemId);
        expect(pre.publication_status).toBe('published');
        expect(pre.archived_at).toBeNull();

        const beforeMs = Date.now();
        const { error } = await serviceClient
          .from('content_items')
          .update({ publication_status: 'archived' })
          .eq('id', itemId);
        expect(error).toBeNull();

        const post = await readRow(itemId);
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        const archivedTs = new Date(post.archived_at as string).getTime();
        expect(archivedTs).toBeGreaterThanOrEqual(beforeMs - 5_000);
        expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
      },
      60_000,
    );
  },
);

describeIfEnv(
  'Archive trigger coverage — lib/supersession/set.ts (writer 4)',
  () => {
    // Writer 4 — supersession. Trigger §6.6 Directions 1 + 3 are both
    // NO-OP pass-throughs on this writer because the UPDATE payload
    // supplies BOTH `publication_status='archived'` AND `archived_at`
    // simultaneously; the writer upholds the invariant on its own.
    // Test asserts post-write invariant per spec §10.3 / AC1.11, not
    // trigger fire-mechanism. See `lib/supersession/set.ts:132-136` +
    // `:222-225` for the helper-side commentary.
    it(
      'Case A — happy path: setSupersession archives OLD row + writes archive_reason override',
      async () => {
        const oldId = await seedItem(
          'published',
          'supersession-A-old',
          TEST_USER_ADMIN_ID,
        );
        const newId = await seedItem(
          'published',
          'supersession-A-new',
          TEST_USER_ADMIN_ID,
        );

        // Sanity baseline: OLD row published + archived_at NULL +
        // dedup_status 'clean' + superseded_by NULL.
        const pre = await readRow(oldId);
        expect(pre.publication_status).toBe('published');
        expect(pre.archived_at).toBeNull();
        expect(pre.superseded_by).toBeNull();

        const reason = 'Pre-flight A1: supersession happy-path';
        const beforeMs = Date.now();
        await setSupersession(
          {
            oldId,
            newId,
            actorUserId: TEST_USER_ADMIN_ID,
            archiveReason: reason,
          },
          serviceClient,
        );

        const post = await readRow(oldId);
        // CORE PRE-FLIGHT INVARIANT (spec §10.3 + AC1.11) — writer
        // upholds publication_status='archived' ↔ archived_at IS NOT NULL
        // without requiring trigger Direction 1 or 3 to fire.
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        const archivedTs = new Date(post.archived_at as string).getTime();
        expect(archivedTs).toBeGreaterThanOrEqual(beforeMs - 5_000);
        expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
        expect(post.archived_by).toBe(TEST_USER_ADMIN_ID);
        expect(post.archive_reason).toBe(reason);
        expect(post.superseded_by).toBe(newId);
        // Per `lib/supersession/set.ts:233`, dedup_status is also flipped
        // to 'superseded' on the OLD row.
        expect(post.dedup_status).toBe('superseded');
      },
      60_000,
    );

    it(
      'Case B — default archiveReason fallback: omitted param yields canonical "Superseded by item ${newId}"',
      async () => {
        // Per `lib/supersession/set.ts:227`, archiveReason defaults to
        // `Superseded by item ${newId}` when the caller omits it.
        // Existing callers (PATCH /api/items/:id, MCP supersede_content_
        // item, admin dedup supersede + near-dup merge) all rely on this
        // default — assert it directly.
        const oldId = await seedItem(
          'published',
          'supersession-B-old',
          TEST_USER_ADMIN_ID,
        );
        const newId = await seedItem(
          'published',
          'supersession-B-new',
          TEST_USER_ADMIN_ID,
        );

        const pre = await readRow(oldId);
        expect(pre.publication_status).toBe('published');
        expect(pre.archived_at).toBeNull();

        const beforeMs = Date.now();
        await setSupersession(
          {
            oldId,
            newId,
            actorUserId: TEST_USER_ADMIN_ID,
            // archiveReason intentionally omitted.
          },
          serviceClient,
        );

        const post = await readRow(oldId);
        expect(post.publication_status).toBe('archived');
        expect(post.archived_at).not.toBeNull();
        const archivedTs = new Date(post.archived_at as string).getTime();
        expect(archivedTs).toBeGreaterThanOrEqual(beforeMs - 5_000);
        expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
        expect(post.archived_by).toBe(TEST_USER_ADMIN_ID);
        expect(post.archive_reason).toBe(`Superseded by item ${newId}`);
        expect(post.superseded_by).toBe(newId);
        expect(post.dedup_status).toBe('superseded');
      },
      60_000,
    );
  },
);
