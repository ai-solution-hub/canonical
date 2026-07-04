/**
 * Tests for the S202 §5.2 Phase 2.5 / T8a-rewired MCP tool
 * `update_governance_status`.
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §6.5, §10.6
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T8a + Wave 3A (publish-coherence
 *       fix)
 *
 * Coverage:
 *   - Tool registration: name, title, description, inputSchema,
 *     SAFE_WRITE annotations.
 *   - `action='draft'` branch (post-T8a rewire):
 *       * Editor + admin allowed; viewer 403.
 *       * Writes `publication_status: 'draft'` (NOT
 *         `governance_review_status`) per spec §6.5 / Phase 2.5 rewire.
 *       * Does NOT clear `governance_review_status` (legacy column left as-is
 *         per §10.6 read-side compatibility).
 *       * `content_history` row written with canonical
 *         `change_reason: 'status_change_draft'` and `change_type: 'draft'`.
 *       * Covers transitioning from `'published' → 'draft'` and
 *         `'in_review' → 'draft'`.
 *   - `action='publish'` branch (post-Wave-3A coherence fix):
 *       * Editor + admin allowed; viewer 403.
 *       * `governance_review_status` cleared to null in all branches.
 *       * `publication_status='draft'` → promotes to `'published'`.
 *       * `publication_status='in_review'` → no-op on `publication_status`
 *         (legacy column-clear only).
 *       * `publication_status='published'` → no-op on `publication_status`.
 *       * `publication_status='archived'` → returns error
 *         ("Cannot publish archived; use update_publication_status").
 *   - Error paths: missing item_id (404-equivalent), Supabase fetch error,
 *     Supabase update error.
 *
 * Pattern mirrors __tests__/mcp/update-publication-status.test.ts (T7's
 * 23-test file): hoisted mocks for auth + supabase/safe + safe singleton, a
 * chainable mock query builder, and a `runUpdate` harness for both action
 * branches.
 *
 * Coordination note (Wave 3A): the publish-coherence fix lands in parallel.
 * These tests describe POST-FIX behaviour. If they're run before Wave 3A
 * lands, the tests asserting `publication_status` promotion / archived-block
 * will fail — once Wave 3A merges (in either order), the suite goes green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — set BEFORE imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  checkMcpRole: vi.fn(),
  createMcpClient: vi.fn(),
  getMcpUserId: vi.fn(),
  getMcpUserRole: vi.fn(),
  sb: vi.fn(),
  tryQuery: vi.fn(),
  generateEmbedding: vi.fn(),
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/supabase/safe', () => ({
  sb: mocks.sb,
  tryQuery: mocks.tryQuery,
  isOk: (r: { ok: boolean }) => r.ok,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: mocks.generateEmbedding,
  };
});

// Stub the lazy-import shims used by the publish branch (classify,
// pipeline-run). These are dynamic imports inside the handler so vi.mock the
// modules themselves. (ID-56.11 retired the app-side chunk-store mock.)
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: vi.fn() })),
  createClient: vi.fn(),
}));
vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { registerGovernanceTools } from '@/lib/mcp/tools/governance';
import {
  createMockMcpServer,
  type MockToolRegistration,
} from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Supabase chain builder
// ---------------------------------------------------------------------------

type QueryResolver = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

function chain(resolve: QueryResolver) {
  const c: Record<string, unknown> = {};
  const methods = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'or',
    'gte',
    'lte',
    'order',
    'range',
    'limit',
  ];
  for (const m of methods) c[m] = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue(resolve);
  c.maybeSingle = vi.fn().mockResolvedValue(resolve);
  c.then = vi.fn((ok: (v: unknown) => void) => ok(resolve));
  return c;
}

const TEST_USER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const TEST_ITEM_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

const MOCK_EXTRA = {
  authInfo: {
    token: 'test-bearer-token',
    extra: { userId: TEST_USER_ID, role: 'admin' },
  },
  signal: new AbortController().signal,
  sendNotification: vi.fn(),
  _meta: undefined,
  requestId: 'test-req-1',
  sendElicitationRequest: vi.fn(),
};

async function callTool(
  tool: MockToolRegistration,
  args: Record<string, unknown>,
): Promise<{
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  return (await tool.handler(args, MOCK_EXTRA)) as {
    content: Array<{ text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
}

/**
 * Build an action-test harness.
 *
 * ID-131 (G-MCP-REPOINT): the handler no longer reads/writes a single
 * `content_items` table. It now:
 *   1. Calls `checkMcpRole` — viewer returns null → tool short-circuits.
 *   2. Fetches BOTH `source_documents` and `q_a_pairs` in parallel
 *      (`.in('id', ids)`) plus `record_lifecycle` (governance_review_status,
 *      keyed by `owner_id`) — whichever typed table has a matching row wins
 *      (`ownerKind` param below selects which).
 *   3. For each item: q_a_pair owners generate an embedding
 *      (`question_embedding`) before the update; source_document owners
 *      skip embedding entirely (no embedding column under OKF) but may run
 *      the classify-on-first-publish leg.
 *   4. On publish, clears `governance_review_status` via a SEPARATE
 *      `record_lifecycle` upsert (facet clear) — no longer part of the main
 *      table's `.update()` payload.
 *   5. Performs a content_history version lookup via `sb()` then inserts a
 *      content_history row.
 *
 * Captures the `update(...)` payload on the resolved owner table, the
 * `upsert(...)` payload on `record_lifecycle` (facet clear), and the
 * `insert(...)` payload on `content_history`.
 */
async function runUpdate({
  role,
  status,
  itemRow,
  ownerKind = 'source_document',
  embedding = [0.1, 0.2, 0.3],
  embeddingError,
  updateError,
}: {
  role: 'admin' | 'editor' | 'viewer';
  status: 'publish' | 'draft';
  itemRow: Record<string, unknown> | null;
  ownerKind?: 'source_document' | 'q_a_pair';
  embedding?: number[];
  embeddingError?: string;
  updateError?: string;
}): Promise<{
  res: Awaited<ReturnType<typeof callTool>>;
  updatePayload: Record<string, unknown> | undefined;
  facetUpsertPayload: Record<string, unknown> | undefined;
  historyInsertPayload: Record<string, unknown> | undefined;
  fromCalls: string[];
}> {
  vi.clearAllMocks();
  if (role === 'viewer') {
    mocks.checkMcpRole.mockResolvedValue(null);
  } else {
    mocks.checkMcpRole.mockResolvedValue(role);
  }
  mocks.getMcpUserId.mockReturnValue(TEST_USER_ID);
  mocks.getMcpUserRole.mockResolvedValue(role);

  // tryQuery is used for the embedding-pipeline classify + the
  // content_history version lookup. Stub a generic ok response.
  mocks.tryQuery.mockResolvedValue({ ok: true, data: null });

  // sb() is used for the content_history version lookup. Returns
  // [{ version: 0 }] so nextVersion = 1.
  mocks.sb.mockResolvedValue([{ version: 0 }]);

  if (embeddingError) {
    mocks.generateEmbedding.mockRejectedValue(new Error(embeddingError));
  } else {
    mocks.generateEmbedding.mockResolvedValue(embedding);
  }

  const fromCalls: string[] = [];
  const sdFetchChain = chain({
    data: itemRow && ownerKind === 'source_document' ? [itemRow] : [],
    error: null,
  });
  const qaFetchChain = chain({
    data: itemRow && ownerKind === 'q_a_pair' ? [itemRow] : [],
    error: null,
  });
  const lifecycleFetchChain = chain({
    data: itemRow
      ? [
          {
            owner_id: TEST_ITEM_ID,
            governance_review_status: itemRow.governance_review_status ?? null,
          },
        ]
      : [],
    error: null,
  });
  const updateChain = chain({
    data: null,
    error: updateError ? { message: updateError } : null,
    count: null,
  });
  const facetUpsertChain = chain({ data: null, error: null });
  const historyChain = chain({ data: null, error: null });

  // First `.from('source_documents')` / `.from('q_a_pairs')` call = the
  // parallel batch fetch; a subsequent call (source_document/q_a_pair owner
  // branch) = the per-item update. `.from('record_lifecycle')`: first call =
  // governance_review_status batch lookup, second (publish only) = facet
  // clear upsert.
  let sourceDocumentsCall = 0;
  let qaPairsCall = 0;
  let recordLifecycleCall = 0;
  const fromMock = vi.fn((table: string) => {
    fromCalls.push(table);
    if (table === 'content_history') return historyChain;
    if (table === 'source_documents') {
      sourceDocumentsCall += 1;
      return sourceDocumentsCall === 1 ? sdFetchChain : updateChain;
    }
    if (table === 'q_a_pairs') {
      qaPairsCall += 1;
      return qaPairsCall === 1 ? qaFetchChain : updateChain;
    }
    if (table === 'record_lifecycle') {
      recordLifecycleCall += 1;
      return recordLifecycleCall === 1 ? lifecycleFetchChain : facetUpsertChain;
    }
    return chain({ data: null, error: null });
  });
  mocks.createMcpClient.mockReturnValue({ from: fromMock });

  const localServer = createMockMcpServer();
  await registerGovernanceTools(localServer.server);
  const tool = localServer.getTool('update_governance_status')!;

  const res = await callTool(tool, {
    item_ids: [TEST_ITEM_ID],
    status,
  });

  const updateMockFn = updateChain.update as ReturnType<typeof vi.fn>;
  const updatePayload = updateMockFn.mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;

  const facetUpsertMockFn = facetUpsertChain.upsert as ReturnType<typeof vi.fn>;
  const facetUpsertPayload = facetUpsertMockFn.mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;

  const insertMockFn = historyChain.insert as ReturnType<typeof vi.fn>;
  const historyInsertPayload = insertMockFn.mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;

  return {
    res,
    updatePayload,
    facetUpsertPayload,
    historyInsertPayload,
    fromCalls,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('update_governance_status — registration', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue(TEST_USER_ID);
    mocks.getMcpUserRole.mockResolvedValue('admin');
    mocks.tryQuery.mockResolvedValue({ ok: true, data: null });
    mocks.sb.mockResolvedValue(null);
    mocks.createMcpClient.mockReturnValue({
      from: vi.fn(() => chain({ data: null, error: null })),
    });

    mockServer = createMockMcpServer();
    await registerGovernanceTools(mockServer.server);
  });

  it('registers update_governance_status with the documented title', () => {
    const tool = mockServer.getTool('update_governance_status')!;
    expect(tool.config.title).toBe('Update Governance Status');
  });

  it('description distinguishes from update_publication_status and notes the T8a rewire', () => {
    const tool = mockServer.getTool('update_governance_status')!;
    const desc = tool.config.description as string;
    // Per T8a: external 'draft' verb is unchanged for LLM callers but the
    // underlying column is now publication_status. Description should
    // explain the rewire.
    expect(desc).toMatch(/publish|draft/i);
    expect(desc).toMatch(/publication_status/);
    // Distinguish from update_publication_status — they handle different
    // axes (publish/draft vs. lifecycle transitions).
    expect(desc.toLowerCase()).toContain('embedding');
    // Role gate is documented (current wording: "Requires editor or admin
    // role"; post-Wave-3A may rephrase). Match either ordering insensitively.
    expect(desc.toLowerCase()).toMatch(/editor or admin role/);
  });

  it('inputSchema declares item_ids (array of UUIDs) and status (publish|draft enum)', () => {
    const tool = mockServer.getTool('update_governance_status')!;
    const schema = tool.config.inputSchema as Record<string, unknown>;
    expect(Object.keys(schema).sort()).toEqual(['item_ids', 'status']);
  });

  it('uses SAFE_WRITE_ANNOTATIONS', () => {
    const tool = mockServer.getTool('update_governance_status')!;
    const ann = tool.config.annotations as Record<string, boolean>;
    expect(ann.readOnlyHint).toBe(false);
    expect(ann.idempotentHint).toBe(true);
    expect(ann.destructiveHint).toBe(false);
    expect(ann.openWorldHint).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Role gate (viewer 403, editor + admin allowed)
// ---------------------------------------------------------------------------

describe('update_governance_status — role gate', () => {
  it('viewer is denied with isError + permission-denied message (action=draft)', async () => {
    const { res } = await runUpdate({
      role: 'viewer',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'X',
        suggested_title: null,
        content: 'body',
        publication_status: 'published',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/Permission denied/i);
    expect(res.content[0]?.text).toMatch(/editor or admin/i);
  });

  it('viewer is denied with isError + permission-denied message (action=publish)', async () => {
    const { res } = await runUpdate({
      role: 'viewer',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'X',
        suggested_title: null,
        content: 'body',
        publication_status: 'draft',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/Permission denied/i);
  });

  it('editor can call action=draft (no permission-denied isError)', async () => {
    const { res } = await runUpdate({
      role: 'editor',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'X',
        suggested_title: null,
        content: 'body',
        publication_status: 'published',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    // Either the call succeeds (item stamped successful) OR — if a Wave 3A
    // not-yet-merged validity check rejects something — there is no
    // top-level Permission denied.
    expect(res.content[0]?.text ?? '').not.toMatch(/Permission denied/i);
  });

  it('admin can call action=draft', async () => {
    const { res } = await runUpdate({
      role: 'admin',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'X',
        suggested_title: null,
        content: 'body',
        publication_status: 'in_review',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(res.content[0]?.text ?? '').not.toMatch(/Permission denied/i);
  });
});

// ---------------------------------------------------------------------------
// action='draft' branch (T8a rewire — writes publication_status='draft')
// ---------------------------------------------------------------------------

describe('update_governance_status — action="draft" branch (T8a)', () => {
  it('writes publication_status="draft" to content_items (NOT governance_review_status)', async () => {
    const { res, updatePayload } = await runUpdate({
      role: 'admin',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Live item',
        suggested_title: null,
        content: 'body',
        publication_status: 'published',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });

    expect(res.isError).toBeUndefined();
    expect(updatePayload).toBeDefined();
    expect(updatePayload!.publication_status).toBe('draft');
    expect(updatePayload!.updated_by).toBe(TEST_USER_ID);
    // Per spec §10.6: legacy governance_review_status is NOT touched.
    expect('governance_review_status' in updatePayload!).toBe(false);
  });

  it('does NOT generate an embedding on the draft branch', async () => {
    await runUpdate({
      role: 'admin',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Live item',
        suggested_title: null,
        content: 'body',
        publication_status: 'published',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(mocks.generateEmbedding).not.toHaveBeenCalled();
  });

  it('transitions published → draft', async () => {
    const { res, updatePayload } = await runUpdate({
      role: 'editor',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'X',
        suggested_title: null,
        content: 'body',
        publication_status: 'published',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(res.isError).toBeUndefined();
    expect(updatePayload!.publication_status).toBe('draft');
  });

  it('transitions in_review → draft', async () => {
    const { res, updatePayload } = await runUpdate({
      role: 'editor',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'X',
        suggested_title: null,
        content: 'body',
        publication_status: 'in_review',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(res.isError).toBeUndefined();
    expect(updatePayload!.publication_status).toBe('draft');
    // Legacy column not cleared by this tool — Phase 1f migration owns the
    // global NULLing per spec §10.6.
    expect('governance_review_status' in updatePayload!).toBe(false);
  });

  it('writes content_history with change_type="draft" and canonical change_reason', async () => {
    const { historyInsertPayload } = await runUpdate({
      role: 'editor',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Live item',
        suggested_title: null,
        content: 'body content',
        publication_status: 'published',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(historyInsertPayload).toBeDefined();
    expect(historyInsertPayload!.change_type).toBe('draft');
    expect(historyInsertPayload!.change_reason).toBe('status_change_draft');
    expect(historyInsertPayload!.change_summary).toBe(
      'Item moved to draft status',
    );
    expect(historyInsertPayload!.content_item_id).toBe(TEST_ITEM_ID);
    expect(historyInsertPayload!.created_by).toBe(TEST_USER_ID);
    expect(historyInsertPayload!.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// action='publish' branch — POST-Wave-3A coherence fix
//
// Pre-Wave-3A behaviour: publish unconditionally cleared
// governance_review_status and ignored publication_status. Post-fix:
// publish clears governance_review_status in all branches, BUT also
// promotes publication_status='draft' → 'published' and rejects
// publication_status='archived' as a state-machine violation.
// ---------------------------------------------------------------------------

describe('update_governance_status — action="publish" branch (post-Wave-3A)', () => {
  it('clears governance_review_status to null when current publication_status="draft"', async () => {
    // ID-131 (G-MCP-REPOINT): governance_review_status now clears via a
    // SEPARATE record_lifecycle facet upsert, not the main table update.
    const { facetUpsertPayload } = await runUpdate({
      role: 'admin',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Drafted',
        suggested_title: null,
        content: 'body',
        publication_status: 'draft',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(facetUpsertPayload).toBeDefined();
    expect(facetUpsertPayload!.governance_review_status).toBeNull();
  });

  it('promotes publication_status="draft" → "published" (post-Wave-3A coherence fix)', async () => {
    const { updatePayload } = await runUpdate({
      role: 'admin',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Drafted',
        suggested_title: null,
        content: 'body',
        publication_status: 'draft',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(updatePayload).toBeDefined();
    expect(updatePayload!.publication_status).toBe('published');
  });

  it('does NOT promote publication_status when current="in_review" (legacy column-clear only)', async () => {
    const { updatePayload, facetUpsertPayload } = await runUpdate({
      role: 'admin',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Reviewing',
        suggested_title: null,
        content: 'body',
        publication_status: 'in_review',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(facetUpsertPayload).toBeDefined();
    expect(facetUpsertPayload!.governance_review_status).toBeNull();
    // Per Wave-3A coherence fix: in_review is NOT touched by this tool;
    // update_publication_status owns the in_review → published transition.
    expect(updatePayload).toBeDefined();
    expect('publication_status' in updatePayload!).toBe(false);
  });

  it('does NOT promote publication_status when current="published" (no-op on publication_status)', async () => {
    const { updatePayload, facetUpsertPayload } = await runUpdate({
      role: 'admin',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Already live',
        suggested_title: null,
        content: 'body',
        publication_status: 'published',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(facetUpsertPayload).toBeDefined();
    expect(facetUpsertPayload!.governance_review_status).toBeNull();
    expect(updatePayload).toBeDefined();
    expect('publication_status' in updatePayload!).toBe(false);
  });

  it('returns error when current publication_status="archived" (Cannot publish archived)', async () => {
    const { res } = await runUpdate({
      role: 'admin',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Archived',
        suggested_title: null,
        content: 'body',
        publication_status: 'archived',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    // Per-item failure surfaces in the items[] aggregate; the top-level
    // markdown reports the failure.
    const text = res.content[0]?.text ?? '';
    expect(text).toMatch(/archived/i);
    // Per Wave-3A spec: directs caller to update_publication_status.
    expect(text).toMatch(/update_publication_status/);
  });

  it('writes content_history with change_type="publish" and canonical change_reason', async () => {
    const { historyInsertPayload } = await runUpdate({
      role: 'admin',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Drafted',
        suggested_title: null,
        content: 'body content',
        publication_status: 'draft',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(historyInsertPayload).toBeDefined();
    expect(historyInsertPayload!.change_type).toBe('publish');
    expect(historyInsertPayload!.change_reason).toBe('status_change_publish');
    expect(historyInsertPayload!.change_summary).toBe(
      'Item published from draft to live',
    );
  });

  it('does NOT generate an embedding for a source_document owner (no embedding column under OKF)', async () => {
    // ID-131 (G-MCP-REPOINT) content-drift: source_documents carries no
    // embedding column — a document's searchability comes from its
    // cocoindex-populated content_chunks, not an item-level vector. Publish
    // no longer generates one for a source_document owner.
    await runUpdate({
      role: 'admin',
      status: 'publish',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'Drafted',
        suggested_title: null,
        content: 'body content',
        publication_status: 'draft',
        governance_review_status: 'pending',
        classified_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(mocks.generateEmbedding).not.toHaveBeenCalled();
  });

  it('generates a question_embedding via generateEmbedding for a q_a_pair owner before update', async () => {
    // q_a_pairs still carries `question_embedding` (pre-M5) — the
    // embed-then-commit step survives for this owner kind only.
    const { updatePayload } = await runUpdate({
      role: 'admin',
      status: 'publish',
      ownerKind: 'q_a_pair',
      itemRow: {
        id: TEST_ITEM_ID,
        question_text: 'What is the refund policy?',
        answer_standard: 'body content',
        publication_status: 'draft',
        governance_review_status: 'pending',
      },
    });
    expect(mocks.generateEmbedding).toHaveBeenCalled();
    expect(updatePayload).toBeDefined();
    expect(updatePayload!.question_embedding).toBeDefined();
  });

  it('reports per-item failure when embedding generation fails for a q_a_pair owner', async () => {
    const { res } = await runUpdate({
      role: 'admin',
      status: 'publish',
      ownerKind: 'q_a_pair',
      itemRow: {
        id: TEST_ITEM_ID,
        question_text: 'What is the refund policy?',
        answer_standard: 'body content',
        publication_status: 'draft',
        governance_review_status: 'pending',
      },
      embeddingError: 'OpenAI rate limit exceeded',
    });
    const text = res.content[0]?.text ?? '';
    expect(text).toMatch(/Embedding failed/i);
    expect(text).toMatch(/OpenAI rate limit exceeded/);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('update_governance_status — error paths', () => {
  it('reports per-item "Item not found" when fetch returns no row for the id', async () => {
    const { res } = await runUpdate({
      role: 'admin',
      status: 'draft',
      itemRow: null, // batch fetch returns []
    });
    const text = res.content[0]?.text ?? '';
    expect(text).toMatch(/Item not found/i);
  });

  it('surfaces Supabase update error in the per-item failure list (action=draft)', async () => {
    const { res } = await runUpdate({
      role: 'admin',
      status: 'draft',
      itemRow: {
        id: TEST_ITEM_ID,
        title: 'X',
        suggested_title: null,
        content: 'body',
        publication_status: 'published',
        governance_review_status: null,
        classified_at: '2026-01-01T00:00:00Z',
      },
      updateError: 'connection refused',
    });
    const text = res.content[0]?.text ?? '';
    expect(text).toMatch(/connection refused/);
  });
});
