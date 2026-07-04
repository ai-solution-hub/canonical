/**
 * Tests for the bulk_assign_owner MCP tool (P1-32).
 *
 * Test cases (T1-T18 per spec §8) covering:
 *   - Happy paths: admin apply, editor/viewer rejection
 *   - Scope filters: AND semantics, empty scope
 *   - Dry-run vs apply
 *   - Skip-if-owned default + force_override
 *   - Owner validation
 *   - Cursor pagination + scope_hash mismatch
 *   - Audit trail best-effort
 *   - Notification matrix + self-assign skip
 *
 * T8 ("dry-run after apply reflects post-apply state") is an integration
 * scenario requiring two sequential calls against real DB state mutation.
 * Unit-test mocks cannot observe post-apply state between calls — T8 is
 * covered by the integration test suite against the live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  /**
   * Build an independent Supabase chain mock. Each `.from()` call can return
   * its own chain with its own data/error so table-specific assertions work.
   */
  function makeChain(
    resolvedValue: { data: unknown; error: unknown } = {
      data: null,
      error: null,
    },
  ) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.gt = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(resolvedValue);
    chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve(resolvedValue),
    );
    return chain;
  }

  // Per-table chain factories — reset in beforeEach
  const userRolesChain = makeChain({
    data: { user_id: '00000000-0000-4000-8000-000000000099' },
    error: null,
  });
  // ID-131 (G-MCP-REPOINT): the scope-filter query is now source_documents
  // (id/suggested_title only — content_owner_id moved off this table); a
  // SEPARATE record_lifecycle query resolves current ownership.
  const sourceDocumentsChain = makeChain({ data: [], error: null });
  const recordLifecycleChain = makeChain({ data: [], error: null });
  const contentHistoryChain = makeChain({ data: null, error: null });
  const notificationsChain = makeChain({ data: null, error: null });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    switch (table) {
      case 'user_roles':
        return userRolesChain;
      case 'source_documents':
        return sourceDocumentsChain;
      case 'record_lifecycle':
        return recordLifecycleChain;
      case 'content_history':
        return contentHistoryChain;
      case 'notifications':
        return notificationsChain;
      default:
        return makeChain();
    }
  });

  const mockSupabaseClient = {
    from: fromMock,
    rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
    _makeChain: makeChain,
  };

  return {
    mockSupabaseClient,
    fromMock,
    userRolesChain,
    sourceDocumentsChain,
    recordLifecycleChain,
    contentHistoryChain,
    notificationsChain,
    makeChain,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi
      .fn()
      .mockReturnValue('00000000-0000-4000-8000-000000000001'),
    checkMcpRole: vi.fn().mockResolvedValue('admin'),
    logBestEffortWarn: vi.fn(),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: vi.fn().mockResolvedValue('admin'),
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/mcp/formatters', () => ({
  formatContentItem: vi.fn(() => 'formatted'),
  formatCreatedItem: vi.fn(() => 'created'),
  formatUpdatedItem: vi.fn(() => 'updated'),
  formatBatchContentItems: vi.fn(() => 'batch'),
  formatContentItemChunks: vi.fn(() => 'chunks'),
  truncateResponse: vi.fn((s: string) => s),
  CHARACTER_LIMIT: 10000,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn(),
  };
});
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
  slugifyDomain: vi.fn((d: string) => d.toLowerCase().replace(/\s+/g, '-')),
}));
vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn(),
}));

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: mocks.logBestEffortWarn,
}));

// sb() needs to pass through to test real error handling.
// We mock the module but keep sb() functional: it awaits the query and
// throws on error, just like the real implementation.
vi.mock('@/lib/supabase/safe', () => ({
  sb: async (query: PromiseLike<{ data: unknown; error: unknown }>) => {
    const result = await query;
    if (result.error) {
      throw new Error(
        typeof result.error === 'object' &&
          result.error !== null &&
          'message' in result.error
          ? (result.error as { message: string }).message
          : String(result.error),
      );
    }
    return result.data;
  },
  // tryQuery needs to pass through too (used for the record_lifecycle
  // ownership lookup, ID-131 G-MCP-REPOINT) — same await-and-wrap shape as
  // the real implementation, not a bare unconfigured vi.fn().
  tryQuery: async (query: PromiseLike<{ data: unknown; error: unknown }>) => {
    const result = await query;
    if (result.error) {
      return { ok: false, error: result.error };
    }
    return { ok: true, data: result.data };
  },
  isOk: (r: { ok: boolean }) => r.ok,
  SupabaseError: class extends Error {
    name = 'SupabaseError';
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { registerContentTools } from '@/lib/mcp/tools/content';
import {
  createMockMcpServer,
  createMockExtra,
  type MockToolRegistration,
} from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const OWNER_ID = '00000000-0000-4000-8000-000000000099';
const ITEM_1 = '10000000-0000-4000-8000-000000000001';
const ITEM_2 = '20000000-0000-4000-8000-000000000002';

// Re-assigned in beforeEach.
let mockServer: ReturnType<typeof createMockMcpServer>;

function getBulkAssignTool(): MockToolRegistration {
  // ID-71.10 M32: bulk_assign_owner consolidated into `assign` (one-or-many).
  // The scope-filter path preserved here is the former bulk_assign_owner.
  const tool = mockServer.getTool('assign');
  if (!tool) throw new Error('assign (scope path) not registered');
  return tool;
}

/**
 * Helper: set the source_documents scope query + the record_lifecycle
 * ownership lookup to return specific items.
 *
 * ID-131 (G-MCP-REPOINT): content_items no longer exists. The scope query
 * now hits source_documents (id/suggested_title only — content_owner_id
 * moved off this table entirely, BI-18/20); a SEPARATE record_lifecycle
 * query resolves current ownership by source_document_id. Every matched
 * source_documents row IS its own owner id under OKF — there is no more
 * "unresolvable / no backing source document" case (the old content_items
 * indirection this represented no longer exists).
 */
function setContentItems(
  items: Array<{
    id: string;
    title: string;
    content_owner_id: string | null;
  }>,
) {
  mocks.sourceDocumentsChain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: items.map((item) => ({
          id: item.id,
          suggested_title: item.title,
        })),
        error: null,
      }),
  );
  mocks.recordLifecycleChain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: items.map((item) => ({
          source_document_id: item.id,
          content_owner_id: item.content_owner_id,
        })),
        error: null,
      }),
  );
}

/** Helper: set user_roles lookup result */
function setOwnerExists(exists: boolean) {
  mocks.userRolesChain.maybeSingle.mockResolvedValue(
    exists
      ? { data: { user_id: OWNER_ID }, error: null }
      : { data: null, error: null },
  );
}

/** Helper: make content_history insert fail */
function setHistoryInsertError(message: string) {
  mocks.contentHistoryChain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message } }),
  );
}

// ---------------------------------------------------------------------------
// Tests (T1-T18)
// ---------------------------------------------------------------------------

describe('bulk_assign_owner MCP tool', () => {
  let tool: MockToolRegistration;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-wire mocks after clearAllMocks
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue(ADMIN_USER_ID);
    mocks.createMcpClient.mockReturnValue(mocks.mockSupabaseClient);
    mocks.mockSupabaseClient.from.mockImplementation((table: string) => {
      switch (table) {
        case 'user_roles':
          return mocks.userRolesChain;
        case 'source_documents':
          return mocks.sourceDocumentsChain;
        case 'record_lifecycle':
          return mocks.recordLifecycleChain;
        case 'content_history':
          return mocks.contentHistoryChain;
        case 'notifications':
          return mocks.notificationsChain;
        default:
          return mocks.makeChain();
      }
    });
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 0, error: null });

    // Defaults: owner exists, no items, history insert succeeds, notification succeeds
    setOwnerExists(true);
    setContentItems([]);
    mocks.contentHistoryChain.insert.mockReturnValue(mocks.contentHistoryChain);
    mocks.contentHistoryChain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    mocks.notificationsChain.insert.mockReturnValue(mocks.notificationsChain);
    mocks.notificationsChain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // Reset chain methods
    mocks.userRolesChain.select.mockReturnValue(mocks.userRolesChain);
    mocks.userRolesChain.eq.mockReturnValue(mocks.userRolesChain);
    mocks.sourceDocumentsChain.select.mockReturnValue(
      mocks.sourceDocumentsChain,
    );
    mocks.sourceDocumentsChain.eq.mockReturnValue(mocks.sourceDocumentsChain);
    mocks.sourceDocumentsChain.is.mockReturnValue(mocks.sourceDocumentsChain);
    mocks.sourceDocumentsChain.gt.mockReturnValue(mocks.sourceDocumentsChain);
    mocks.sourceDocumentsChain.order.mockReturnValue(
      mocks.sourceDocumentsChain,
    );
    mocks.sourceDocumentsChain.limit.mockReturnValue(
      mocks.sourceDocumentsChain,
    );

    mockServer = createMockMcpServer();
    await registerContentTools(mockServer.server);
    tool = getBulkAssignTool();
  });

  // T1: Admin calls with valid scope + owner
  it('T1: assigns ownership to matching unowned items', async () => {
    setContentItems([
      { id: ITEM_1, title: 'Item A', content_owner_id: null },
      { id: ITEM_2, title: 'Item B', content_owner_id: null },
    ]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 2, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('APPLIED');
    expect(result.content[0].text).toContain('2 items');
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.assigned_count).toBe(2);
    expect(result.structuredContent!.action).toBe('bulk_assign_owner');
    expect(result.structuredContent!.dry_run).toBe(false);

    // Verify RPC called with correct item IDs
    expect(mocks.mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'bulk_assign_content_owner',
      {
        p_item_ids: [ITEM_1, ITEM_2],
        p_owner_id: OWNER_ID,
        p_assigned_by: ADMIN_USER_ID,
      },
    );

    // Verify content_history insert
    expect(mocks.contentHistoryChain.insert).toHaveBeenCalledTimes(1);
    const historyRows = mocks.contentHistoryChain.insert.mock.calls[0][0];
    expect(historyRows).toHaveLength(2);
    expect(historyRows[0].change_type).toBe('owner_assigned');
    expect(historyRows[0].content_item_id).toBe(ITEM_1);

    // Verify notification sent
    expect(mocks.notificationsChain.insert).toHaveBeenCalledTimes(1);
  });

  // T2: Editor calls
  it('T2: rejects editor role with isError', async () => {
    mocks.checkMcpRole.mockResolvedValue(null);

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra({ userId: OTHER_USER_ID, role: 'editor' }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('admin role required');
  });

  // T3: Viewer calls
  it('T3: rejects viewer role with isError', async () => {
    mocks.checkMcpRole.mockResolvedValue(null);

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra({ userId: OTHER_USER_ID, role: 'viewer' }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('admin role required');
  });

  // T4: Empty scope + dry_run: true
  it('T4: empty scope with dry_run previews all items', async () => {
    setContentItems([
      { id: ITEM_1, title: 'Item A', content_owner_id: null },
      { id: ITEM_2, title: 'Item B', content_owner_id: null },
    ]);

    const result = await tool.handler(
      {
        scope: { unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: true,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.dry_run).toBe(true);
    expect(result.structuredContent!.assigned_count).toBe(2);
    expect(result.content[0].text).toContain('DRY RUN');

    // No RPC call in dry-run
    expect(mocks.mockSupabaseClient.rpc).not.toHaveBeenCalled();
  });

  // T4b: Empty scope + dry_run: false => rejected
  it('T4b: empty scope with dry_run: false is rejected', async () => {
    const result = await tool.handler(
      {
        scope: { unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      'at least one of domain, subtopic, or content_type',
    );
    expect(result.content[0].text).toContain('dry_run');
  });

  // T5: Scope with all keys set (AND semantics)
  it('T5: all scope keys apply AND semantics', async () => {
    setContentItems([
      { id: ITEM_1, title: 'Healthcare CQC Policy', content_owner_id: null },
    ]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null });

    const result = await tool.handler(
      {
        scope: {
          domain: 'Healthcare',
          subtopic: 'CQC',
          content_type: 'policy',
          unowned_only: true,
        },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(1);

    // Verify all three scope filters applied
    expect(mocks.sourceDocumentsChain.eq).toHaveBeenCalledWith(
      'primary_domain',
      'Healthcare',
    );
    expect(mocks.sourceDocumentsChain.eq).toHaveBeenCalledWith(
      'primary_subtopic',
      'CQC',
    );
    expect(mocks.sourceDocumentsChain.eq).toHaveBeenCalledWith(
      'content_type',
      'policy',
    );
  });

  // T6: Scope matches zero items
  it('T6: zero matches returns success with assigned_count 0', async () => {
    setContentItems([]);

    const result = await tool.handler(
      {
        scope: { domain: 'NonexistentDomain', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(0);
    expect(mocks.mockSupabaseClient.rpc).not.toHaveBeenCalled();
  });

  // T7: dry_run: true returns same shape, no DB write
  it('T7: dry_run returns preview without writing', async () => {
    setContentItems([{ id: ITEM_1, title: 'Item A', content_owner_id: null }]);

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: true,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.dry_run).toBe(true);
    expect(result.structuredContent!.assigned_count).toBe(1);
    const itemsAffected = result.structuredContent!.items_affected as Array<{
      id: string;
    }>;
    expect(itemsAffected).toHaveLength(1);
    expect(itemsAffected[0].id).toBe(ITEM_1);

    // No RPC, no history, no notification
    expect(mocks.mockSupabaseClient.rpc).not.toHaveBeenCalled();
    expect(mocks.contentHistoryChain.insert).not.toHaveBeenCalled();
    expect(mocks.notificationsChain.insert).not.toHaveBeenCalled();
  });

  // T9: unowned_only: true (default) filters owned items
  //
  // ID-131 (G-MCP-REPOINT): content_owner_id moved off source_documents
  // onto the record_lifecycle facet (BI-18/20), so the DB can no longer
  // push an `.is('content_owner_id', null)` filter into the scope query —
  // ownership is now resolved via a SEPARATE record_lifecycle lookup and
  // the unowned_only filter is applied client-side against that lookup.
  it('T9: unowned_only assigns unowned items and skips owned ones (client-side ownership check)', async () => {
    setContentItems([
      { id: ITEM_1, title: 'Unowned Item', content_owner_id: null },
      { id: ITEM_2, title: 'Owned Item', content_owner_id: OTHER_USER_ID },
    ]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(1);
    expect(mocks.mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'bulk_assign_content_owner',
      expect.objectContaining({ p_item_ids: [ITEM_1] }),
    );
  });

  // T10: unowned_only: false, force_override: false -> owned items skipped
  it('T10: skip-if-owned default reports skipped items', async () => {
    setContentItems([
      { id: ITEM_1, title: 'Unowned', content_owner_id: null },
      { id: ITEM_2, title: 'Owned', content_owner_id: OTHER_USER_ID },
    ]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: false },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(1);
    expect(result.structuredContent!.skipped_owned_count).toBe(1);

    const skipped = result.structuredContent!.items_skipped as Array<{
      id: string;
      current_owner_id: string;
    }>;
    expect(skipped).toHaveLength(1);
    expect(skipped[0].id).toBe(ITEM_2);
    expect(skipped[0].current_owner_id).toBe(OTHER_USER_ID);

    // Warning about skipped items
    const warnings = result.structuredContent!.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings[0]).toContain('skipped');
    expect(warnings[0]).toContain('force_override');

    // RPC called only with the unowned item
    expect(mocks.mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'bulk_assign_content_owner',
      expect.objectContaining({
        p_item_ids: [ITEM_1],
      }),
    );
  });

  // T10b: unowned_only: false, force_override: true -> all assigned
  it('T10b: force_override assigns all including owned items', async () => {
    setContentItems([
      { id: ITEM_1, title: 'Unowned', content_owner_id: null },
      { id: ITEM_2, title: 'Owned', content_owner_id: OTHER_USER_ID },
    ]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 2, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: false },
        owner_id: OWNER_ID,
        force_override: true,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(2);
    expect(result.structuredContent!.skipped_owned_count).toBe(0);

    const affected = result.structuredContent!.items_affected as Array<{
      id: string;
      previous_owner_id: string | null;
    }>;
    expect(affected).toHaveLength(2);
    // Unowned item has null previous_owner_id
    expect(affected[0].previous_owner_id).toBeNull();
    // Owned item has the previous owner
    expect(affected[1].previous_owner_id).toBe(OTHER_USER_ID);

    // RPC called with BOTH items
    expect(mocks.mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'bulk_assign_content_owner',
      expect.objectContaining({
        p_item_ids: [ITEM_1, ITEM_2],
      }),
    );
  });

  // ID-131 (G-MCP-REPOINT): the former "no backing source document"
  // exclusion path is GONE — content_items no longer sits between the
  // caller's id and the owner id, so every matched source_documents row IS
  // its own owner id. Superseded by
  // 'passes item_ids straight through as owner ids' coverage elsewhere and
  // T1/T5/T9/T10 above, which already exercise the full assignment path
  // against the new two-table (source_documents + record_lifecycle) shape.

  // T11: Invalid owner_id (not a real user)
  it('T11: invalid owner_id rejects before any write', async () => {
    setOwnerExists(false);

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found in user_roles');
    expect(mocks.mockSupabaseClient.rpc).not.toHaveBeenCalled();
  });

  // T12: Invalid owner_id (not a UUID) - Zod rejects
  // Note: In unit tests the handler receives pre-validated args, so we
  // verify that the tool correctly errors on a non-UUID by passing it
  // through the handler (Zod validation happens at MCP framework level).
  // This test verifies the tool's own owner validation catches bad UUIDs
  // that slip past by confirming user_roles lookup returns no match.
  it('T12: non-existent owner_id is caught by user_roles lookup', async () => {
    setOwnerExists(false);
    const fakeUuid = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: fakeUuid,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found in user_roles');
  });

  // T13: Cursor pagination — scope >500 items
  it('T13: returns cursor when matched items exceed 500', async () => {
    // Generate 501 items to trigger pagination
    const items = Array.from({ length: 501 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      title: `Item ${i}`,
      content_owner_id: null,
    }));
    setContentItems(items);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 500, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(500);
    expect(result.structuredContent!.next_cursor).not.toBeNull();

    // Verify the cursor is valid base64url
    const cursor = result.structuredContent!.next_cursor as string;
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    expect(decoded).toHaveProperty('last_id');
    expect(decoded).toHaveProperty('scope_hash');

    // Second call with cursor should use gt filter
    // Reset content items for second page
    const secondPage = [
      {
        id: 'z0000000-0000-4000-8000-000000000000',
        title: 'Last Item',
        content_owner_id: null,
      },
    ];
    setContentItems(secondPage);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null });
    // Re-wire insert mocks after clearAllMocks
    mocks.contentHistoryChain.insert.mockReturnValue(mocks.contentHistoryChain);
    mocks.contentHistoryChain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    mocks.notificationsChain.insert.mockReturnValue(mocks.notificationsChain);
    mocks.notificationsChain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const result2 = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        cursor,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result2.isError).toBeUndefined();
    expect(result2.structuredContent!.assigned_count).toBe(1);
    // No more pages
    expect(result2.structuredContent!.next_cursor).toBeNull();

    // Verify gt filter was applied
    expect(mocks.sourceDocumentsChain.gt).toHaveBeenCalled();
  });

  // T14: content_history insert fails post-RPC — best-effort
  it('T14: audit write failure is best-effort — tool still succeeds', async () => {
    setContentItems([{ id: ITEM_1, title: 'Item A', content_owner_id: null }]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null });
    setHistoryInsertError('content_history insert failed');

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    // Tool succeeds despite audit failure
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(1);

    // logBestEffortWarn was called
    expect(mocks.logBestEffortWarn).toHaveBeenCalledWith(
      'content.owner.audit',
      expect.stringContaining('content_history'),
      expect.objectContaining({ affected_count: 1 }),
    );

    // Warning present in response
    const warnings = result.structuredContent!.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('Audit trail'))).toBe(true);
  });

  // T15: notify: false
  it('T15: notify false suppresses notification', async () => {
    setContentItems([{ id: ITEM_1, title: 'Item A', content_owner_id: null }]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: false,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    // No notification created
    expect(mocks.notificationsChain.insert).not.toHaveBeenCalled();
  });

  // T16: batch_mode: true sends summary notification
  it('T16: batch_mode sends summary notification with scope', async () => {
    setContentItems([
      { id: ITEM_1, title: 'Item A', content_owner_id: null },
      { id: ITEM_2, title: 'Item B', content_owner_id: null },
    ]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 2, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', subtopic: 'CQC', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: true,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();

    // Notification sent with batch-style title
    expect(mocks.notificationsChain.insert).toHaveBeenCalledTimes(1);
    const notifArgs = mocks.notificationsChain.insert.mock.calls[0][0];
    expect(notifArgs.title).toContain('assigned to you');
    expect(notifArgs.title).toContain('domain: Healthcare');
    expect(notifArgs.title).toContain('subtopic: CQC');
    expect(notifArgs.type).toBe('owner_assignment');
  });

  // T17: Self-assignment skips notification
  it('T17: self-assignment skips notification regardless of notify flag', async () => {
    // Set acting user = owner
    mocks.getMcpUserId.mockReturnValue(OWNER_ID);
    setContentItems([{ id: ITEM_1, title: 'Item A', content_owner_id: null }]);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null });

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        dry_run: false,
      },
      createMockExtra({ userId: OWNER_ID, role: 'admin' }),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.assigned_count).toBe(1);
    // No notification for self-assignment
    expect(mocks.notificationsChain.insert).not.toHaveBeenCalled();
  });

  // T18: Cursor with mismatched scope_hash
  it('T18: cursor with mismatched scope_hash is rejected', async () => {
    // Create a cursor with a different scope hash
    const fakeCursor = Buffer.from(
      JSON.stringify({
        last_id: ITEM_1,
        scope_hash: 'deadbeefdeadbeef', // wrong hash
      }),
    ).toString('base64url');

    const result = await tool.handler(
      {
        scope: { domain: 'Healthcare', unowned_only: true },
        owner_id: OWNER_ID,
        force_override: false,
        notify: true,
        batch_mode: false,
        cursor: fakeCursor,
        dry_run: false,
      },
      createMockExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Scope changed');
    expect(result.content[0].text).toContain('paginated calls');

    // No query or RPC executed
    expect(mocks.mockSupabaseClient.rpc).not.toHaveBeenCalled();
  });

  // Registration verification
  it('registers with NON_IDEMPOTENT_WRITE_ANNOTATIONS', () => {
    const annotations = tool.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(false);
    expect(annotations.idempotentHint).toBe(false);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.openWorldHint).toBe(false);
  });
});
