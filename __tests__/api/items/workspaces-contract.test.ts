/**
 * {69.5} — Characterisation test for the canonical-association junction-write
 * CONTRACT exercised by the existing `POST /api/items/[id]/workspaces` route.
 *
 * This test is deliberately NOT a re-test of the route's per-status surface
 * (that lives in `__tests__/api/items-subroutes.test.ts`). It pins the
 * driver-agnostic BI-3 composite-key contract so the deferred v1.1 ingest-side
 * writer can later be held to the SAME assertions unchanged (PRODUCT BI-4):
 *
 *   linkContentItemToWorkspace(contentItemId, workspaceId) — an idempotent
 *   upsert against `content_item_workspaces` keyed on the composite PK
 *   `(content_item_id, workspace_id)`; insert the pair, treat Postgres `23505`
 *   unique-violation as benign success (the pair already exists or a concurrent
 *   writer won the race); never raise on a pre-existing pair, never create a
 *   duplicate row; write ONLY `content_item_workspaces`.
 *
 * Assertions are phrased against the CONTRACT (composite key, idempotency, the
 * admin/editor auth boundary), not the route's incidental shape — the handler
 * is reached through `createTestRequest()` + its exported POST/GET so the test
 * survives a future `defineRoute` wrap (ID-50).
 *
 * Spec: PRODUCT/TECH BI-3 (idempotent upsert), BI-4 (driver-agnostic),
 * BI-5 (many workspaces per record), BI-11 (dedup-agnostic, additive only),
 * BI-12 (admin/editor-gated). Verifies real behaviour per
 * docs/reference/test-philosophy.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — the seam at which the route meets the database.
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

// The route logs the benign-409 / failure branches via the structured logger;
// silence the expected error lines so the suite output stays clean.
vi.spyOn(console, 'error').mockImplementation(() => {});

// Import the handlers AFTER the mocks are registered. Destructured exports are
// resilient to a future `defineRoute(...)` wrap — the test only ever invokes
// the public POST/GET, never a route internal.
const { POST, GET } = await import('@/app/api/items/[id]/workspaces/route');

// ---------------------------------------------------------------------------
// Contract fixtures — v4 UUIDs (Zod strict RFC 4122 in the request body).
// ---------------------------------------------------------------------------

const CONTENT_ITEM_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const WORKSPACE_A = 'b2c3d4e5-f6a7-4901-bcde-f12345678901';
const WORKSPACE_B = 'c3d4e5f6-a7b8-4012-9def-123456789012';

/** Build the canonical `assign` request for one composite pair. */
function associateRequest(workspaceId: string) {
  return createTestRequest(`/api/items/${CONTENT_ITEM_ID}/workspaces`, {
    method: 'POST',
    body: { workspace_id: workspaceId, action: 'assign' },
  });
}

const params = createTestParams({ id: CONTENT_ITEM_ID });

/**
 * In-memory stand-in for the `content_item_workspaces` table that enforces the
 * composite-PK contract: an insert of a pair already present surfaces a
 * Postgres `23505` unique-violation (exactly as the real composite PK would),
 * and a fresh pair is recorded. The route's `.insert()` resolves against this,
 * so the test exercises the route's real idempotency handling rather than a
 * hard-coded per-call error stub.
 */
function installJunctionTable() {
  const rows = new Set<string>();
  const key = (item: string, ws: string) => `${item}::${ws}`;

  mockSupabase.from.mockImplementation((table: string) => {
    if (table !== 'content_item_workspaces') return mockSupabase._chain;

    const insertChain = {
      ...mockSupabase._chain,
      // `.insert(row)` is awaited directly by the route (no terminator), so the
      // composite-PK behaviour is expressed on the returned thenable.
      insert: vi.fn(
        (row: { content_item_id: string; workspace_id: string }) => {
          const composite = key(row.content_item_id, row.workspace_id);
          if (rows.has(composite)) {
            return {
              then: (resolve: (v: unknown) => void) =>
                resolve({
                  data: null,
                  error: { message: 'duplicate key value', code: '23505' },
                }),
            };
          }
          rows.add(composite);
          return {
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: null, error: null }),
          };
        },
      ),
    };
    return insertChain;
  });

  return {
    /** Number of distinct junction rows for a content item — the M2M cardinality. */
    rowCount: (item: string) =>
      [...rows].filter((k) => k.startsWith(`${item}::`)).length,
    has: (item: string, ws: string) => rows.has(key(item, ws)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
});

// ===========================================================================
// BI-3 / BI-11 — idempotent, additive composite-key upsert
// ===========================================================================

describe('canonical association contract — idempotency (BI-3, BI-11)', () => {
  it('associating the same (content_item, workspace) pair twice yields exactly one junction row', async () => {
    configureRole(mockSupabase, 'editor');
    const junction = installJunctionTable();

    const first = await POST(associateRequest(WORKSPACE_A), { params });
    expect(first.status).toBe(200);
    expect((await first.json()).success).toBe(true);

    // Re-associate the identical pair — the contract treats this as benign.
    configureRole(mockSupabase, 'editor');
    const second = await POST(associateRequest(WORKSPACE_A), { params });

    expect(second.status).toBe(409);
    // The duplicate is reported, not thrown; no second row is created.
    const body = await second.json();
    expect(body.error).toMatch(/already assigned/i);
    expect(junction.rowCount(CONTENT_ITEM_ID)).toBe(1);
    expect(junction.has(CONTENT_ITEM_ID, WORKSPACE_A)).toBe(true);
  });

  it('a benign duplicate never surfaces as an unhandled 500', async () => {
    configureRole(mockSupabase, 'editor');
    installJunctionTable();

    await POST(associateRequest(WORKSPACE_A), { params });
    configureRole(mockSupabase, 'editor');
    const repeat = await POST(associateRequest(WORKSPACE_A), { params });

    // The contract distinguishes "pair already present" (benign 409) from a
    // real write failure (500). The repeat must not be a 500.
    expect(repeat.status).not.toBe(500);
  });
});

// ===========================================================================
// BI-5 — a canonical record can be associated to MANY workspaces
// ===========================================================================

describe('canonical association contract — many workspaces per record (BI-5)', () => {
  it('two associations to distinct workspaces keep both junction rows, first intact', async () => {
    const junction = installJunctionTable();

    configureRole(mockSupabase, 'editor');
    const a = await POST(associateRequest(WORKSPACE_A), { params });
    expect(a.status).toBe(200);

    configureRole(mockSupabase, 'editor');
    const b = await POST(associateRequest(WORKSPACE_B), { params });
    expect(b.status).toBe(200);

    // Both pairs persist; adding the second leaves the first untouched.
    expect(junction.rowCount(CONTENT_ITEM_ID)).toBe(2);
    expect(junction.has(CONTENT_ITEM_ID, WORKSPACE_A)).toBe(true);
    expect(junction.has(CONTENT_ITEM_ID, WORKSPACE_B)).toBe(true);
  });

  it('GET lists every workspace a record is associated with', async () => {
    // GET reads the M2M via the get_item_workspaces RPC; the contract is that
    // it returns ALL associated workspaces, regardless of insertion order.
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        { id: WORKSPACE_A, name: 'Workspace A' },
        { id: WORKSPACE_B, name: 'Workspace B' },
      ],
      error: null,
    });

    const res = await GET(
      createTestRequest(`/api/items/${CONTENT_ITEM_ID}/workspaces`),
      { params },
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    const ids = body.map((w: { id: string }) => w.id);
    expect(ids).toContain(WORKSPACE_A);
    expect(ids).toContain(WORKSPACE_B);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_item_workspaces', {
      p_item_id: CONTENT_ITEM_ID,
    });
  });
});

// ===========================================================================
// BI-12 — operator-side association is admin/editor-gated (RLS-coupled)
// ===========================================================================

describe('canonical association contract — auth boundary (BI-12)', () => {
  it('admin can associate a workspace', async () => {
    configureRole(mockSupabase, 'admin');
    installJunctionTable();

    const res = await POST(associateRequest(WORKSPACE_A), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('editor can associate a workspace', async () => {
    configureRole(mockSupabase, 'editor');
    installJunctionTable();

    const res = await POST(associateRequest(WORKSPACE_A), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('viewer is rejected at the auth boundary with 403', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await POST(associateRequest(WORKSPACE_A), { params });
    expect(res.status).toBe(403);
  });

  it('a reviewer-equivalent (no admin/editor role) is rejected with 403', async () => {
    // The route checks `auth.success` against getAuthorisedClient(['admin',
    // 'editor']); any role outside that set falls through to a 403. A user
    // with no explicit role row defaults to 'viewer' and is likewise rejected.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116' },
    });

    const res = await POST(associateRequest(WORKSPACE_A), { params });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller is rejected with 401, never silently associated', async () => {
    configureUnauthenticated(mockSupabase);
    const junction = installJunctionTable();

    const res = await POST(associateRequest(WORKSPACE_A), { params });
    expect(res.status).toBe(401);
    // No write rides an unauthenticated request.
    expect(junction.rowCount(CONTENT_ITEM_ID)).toBe(0);
  });
});
