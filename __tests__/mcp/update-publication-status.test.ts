/**
 * Tests for the S202 §5.2 Phase 2 / T7 MCP tool `update_publication_status`.
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §7.1, §7.1.1
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T7
 *
 * Coverage:
 *   - AC4.4 — role-gate matrix mirrored from PATCH route (admin all
 *     transitions; editor restricted to draft↔in_review + in_review→published;
 *     viewer all forbidden).
 *   - AC6.2 — registration sanity (name, description, inputSchema, annotations).
 *   - State-machine validity — disallowed transitions return 409-equivalent
 *     errors even for admin (e.g. draft→archived).
 *   - Side-effects — archive_reason flows through to archive_reason column on
 *     published→archived; un-archive clears archived_at, preserves
 *     archived_by + archive_reason.
 *   - content_history — row written with change_type='publication_state' and
 *     canonical change_reason `Transition from ${from} to ${to}` (+ archive
 *     reason suffix).
 *   - Get-side widening — `get_governance_queue` accepts publication_status
 *     filter and ANDs it onto the existing query (verified in this file
 *     because it lives next to the new tool registration; the broader
 *     governance-queue-tools.test.ts continues to exercise the legacy params).
 *
 * Pattern mirrors __tests__/mcp/governance-queue-tools.test.ts: hoisted mocks
 * for auth + supabase/safe, then a chainable mock query builder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGovernanceTools } from '@/lib/mcp/tools/governance';

// ---------------------------------------------------------------------------
// Mock server + supabase chain
// ---------------------------------------------------------------------------

interface CapturedTool {
  name: string;
  config: Record<string, unknown>;
  callback: (...args: unknown[]) => unknown;
}

function createMockServer(): { server: McpServer; tools: CapturedTool[] } {
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
  return { server, tools };
}

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

function findTool(tools: CapturedTool[], name: string): CapturedTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`${name} not registered`);
  return t;
}

async function callTool(
  tool: CapturedTool,
  args: Record<string, unknown>,
): Promise<{
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  return (await tool.callback(args, MOCK_EXTRA)) as {
    content: Array<{ text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
}

/**
 * Build a transition test harness. Wires `tryQuery` to return the current
 * item state, captures the `update` payload, captures the `content_history`
 * insert payload, and returns the tool result + the captured payloads.
 *
 * Uses a single mock createMcpClient.from that returns an item-shaped chain
 * for the first invocation (the SELECT) and a generic chain for downstream
 * UPDATE/INSERT/SELECT history-version-lookup calls. The `update` and
 * `insert` mock-fn calls are inspected after the tool returns.
 */
async function runTransition({
  role,
  fromStatus,
  newStatus,
  archiveReason,
  itemOverrides = {},
}: {
  role: 'admin' | 'editor' | 'viewer';
  fromStatus: 'draft' | 'in_review' | 'published' | 'archived';
  newStatus: 'draft' | 'in_review' | 'published' | 'archived';
  archiveReason?: string;
  itemOverrides?: Record<string, unknown>;
}): Promise<{
  res: Awaited<ReturnType<typeof callTool>>;
  updatePayload: Record<string, unknown> | undefined;
  historyInsertPayload: Record<string, unknown> | undefined;
}> {
  vi.clearAllMocks();
  // checkMcpRole is the gate: returns the role string when admin/editor,
  // else null (viewer). The handler treats null as forbidden.
  if (role === 'viewer') {
    mocks.checkMcpRole.mockResolvedValue(null);
  } else {
    mocks.checkMcpRole.mockResolvedValue(role);
  }
  mocks.getMcpUserId.mockReturnValue(TEST_USER_ID);
  mocks.getMcpUserRole.mockResolvedValue(role);

  const itemRow = {
    id: TEST_ITEM_ID,
    publication_status: fromStatus,
    archived_at: fromStatus === 'archived' ? '2026-01-01T00:00:00.000Z' : null,
    archived_by: fromStatus === 'archived' ? TEST_USER_ID : null,
    archive_reason: fromStatus === 'archived' ? 'previously archived' : null,
    title: 'Test item',
    suggested_title: null,
    content: 'Test content',
    brief: null,
    detail: null,
    reference: null,
    ...itemOverrides,
  };

  // tryQuery: 1st call = item fetch, 2nd call = max version lookup.
  let tryQueryCallNo = 0;
  mocks.tryQuery.mockImplementation(async () => {
    tryQueryCallNo += 1;
    if (tryQueryCallNo === 1) {
      return { ok: true, data: itemRow };
    }
    return { ok: true, data: { version: 0 } };
  });

  // sb: terminal awaits for update + history insert. Capture chains.
  let sbCallNo = 0;
  let updateChain: ReturnType<typeof chain> | null = null;
  let historyChain: ReturnType<typeof chain> | null = null;
  mocks.sb.mockImplementation(async (chainArg: ReturnType<typeof chain>) => {
    sbCallNo += 1;
    if (sbCallNo === 1) updateChain = chainArg;
    if (sbCallNo === 2) historyChain = chainArg;
    return null;
  });

  // The supabase client only needs `.from(table)` to return a chainable for
  // both the update and the history insert. Both operations route through
  // sb() in the handler so the resolver shape doesn't matter here.
  const fromMock = vi.fn(() => chain({ data: null, error: null }));
  mocks.createMcpClient.mockReturnValue({ from: fromMock });

  const mock = createMockServer();
  await registerGovernanceTools(mock.server);
  const tool = findTool(mock.tools, 'update_publication_status');

  const args: Record<string, unknown> = {
    item_id: TEST_ITEM_ID,
    new_status: newStatus,
  };
  if (archiveReason !== undefined) {
    args.archive_reason = archiveReason;
  }

  const res = await callTool(tool, args);

  const updateMockFn = (
    updateChain as unknown as { update?: ReturnType<typeof vi.fn> } | null
  )?.update;
  const updatePayload = updateMockFn?.mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;

  const insertMockFn = (
    historyChain as unknown as { insert?: ReturnType<typeof vi.fn> } | null
  )?.insert;
  const historyInsertPayload = insertMockFn?.mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;

  return { res, updatePayload, historyInsertPayload };
}

// ---------------------------------------------------------------------------
// Registration (AC6.2)
// ---------------------------------------------------------------------------

describe('update_publication_status — registration (AC6.2)', () => {
  let tools: CapturedTool[];

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

    const mock = createMockServer();
    tools = mock.tools;
    await registerGovernanceTools(mock.server);
  });

  it('registers update_publication_status with the documented title', () => {
    const tool = findTool(tools, 'update_publication_status');
    expect(tool.config.title).toBe('Update Publication Status');
  });

  it('description distinguishes from update_governance_status', () => {
    const tool = findTool(tools, 'update_publication_status');
    const desc = tool.config.description as string;
    // Spec §7.1.1 — description must mention the four states + the
    // distinction from change-management status.
    expect(desc).toContain('publication lifecycle');
    expect(desc).toContain('draft');
    expect(desc).toContain('in_review');
    expect(desc).toContain('published');
    expect(desc).toContain('archived');
    expect(desc).toContain('update_governance_status');
    expect(desc).toContain('Editor or admin role required');
  });

  it('inputSchema declares item_id, new_status (4-enum), and archive_reason', () => {
    const tool = findTool(tools, 'update_publication_status');
    const schema = tool.config.inputSchema as Record<string, unknown>;
    expect(Object.keys(schema).sort()).toEqual([
      'archive_reason',
      'item_id',
      'new_status',
    ]);
  });

  it('uses SAFE_WRITE_ANNOTATIONS', () => {
    const tool = findTool(tools, 'update_publication_status');
    const ann = tool.config.annotations as Record<string, boolean>;
    expect(ann.readOnlyHint).toBe(false);
    expect(ann.idempotentHint).toBe(true);
    expect(ann.destructiveHint).toBe(false);
    expect(ann.openWorldHint).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Role-gate matrix (AC4.4) — mirrors the PATCH route role-gate matrix
// ---------------------------------------------------------------------------

describe('update_publication_status — admin role (all transitions)', () => {
  // Admin has the full §3.4 matrix:
  //   draft → in_review, draft → published
  //   in_review → published, in_review → draft
  //   published → archived, published → draft
  //   archived → published, archived → draft

  const adminAllowed: Array<
    [
      'draft' | 'in_review' | 'published' | 'archived',
      'draft' | 'in_review' | 'published' | 'archived',
    ]
  > = [
    ['draft', 'in_review'],
    ['draft', 'published'],
    ['in_review', 'draft'],
    ['in_review', 'published'],
    ['published', 'archived'],
    ['published', 'draft'],
    ['archived', 'published'],
    ['archived', 'draft'],
  ];

  it.each(adminAllowed)('admin can transition %s -> %s', async (from, to) => {
    const { res, updatePayload } = await runTransition({
      role: 'admin',
      fromStatus: from,
      newStatus: to,
    });

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.previous_status).toBe(from);
    expect(res.structuredContent?.new_status).toBe(to);
    expect(updatePayload?.publication_status).toBe(to);
  });
});

describe('update_publication_status — editor role (restricted matrix)', () => {
  // Editor has §3.4: draft↔in_review, in_review→published. No archive
  // mutations, no publish-direct-from-draft.
  const editorAllowed: Array<
    [
      'draft' | 'in_review' | 'published' | 'archived',
      'draft' | 'in_review' | 'published' | 'archived',
    ]
  > = [
    ['draft', 'in_review'],
    ['in_review', 'draft'],
    ['in_review', 'published'],
  ];

  const editorForbiddenInState: Array<
    'draft' | 'in_review' | 'published' | 'archived'
  > = ['published', 'archived'];

  // (from, to) pairs that editor must be REJECTED on.
  const editorForbiddenTransitions: Array<
    [
      'draft' | 'in_review' | 'published' | 'archived',
      'draft' | 'in_review' | 'published' | 'archived',
    ]
  > = [
    ['draft', 'published'], // draft → published is admin-only
  ];

  it.each(editorAllowed)('editor can transition %s -> %s', async (from, to) => {
    const { res } = await runTransition({
      role: 'editor',
      fromStatus: from,
      newStatus: to,
    });

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.new_status).toBe(to);
  });

  it.each(editorForbiddenInState)(
    'editor cannot transition out of %s (forbidden — empty allowed-list)',
    async (from) => {
      // Pick any plausible target; the handler rejects before checking the target.
      const target = from === 'archived' ? 'published' : 'draft';
      const { res } = await runTransition({
        role: 'editor',
        fromStatus: from,
        newStatus: target,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toContain(
        `Role 'editor' cannot transition out of '${from}'`,
      );
    },
  );

  it.each(editorForbiddenTransitions)(
    'editor cannot transition %s -> %s (allowed-list omits target)',
    async (from, to) => {
      const { res } = await runTransition({
        role: 'editor',
        fromStatus: from,
        newStatus: to,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toContain(
        `Transition not allowed: '${from}' -> '${to}' for role 'editor'`,
      );
    },
  );
});

describe('update_publication_status — viewer role (all forbidden)', () => {
  // Viewer has empty arrays everywhere. checkMcpRole returns null for viewer
  // because viewer is not in ['admin','editor'] — so the handler short-
  // circuits with a Permission-denied message before even fetching the row.

  const viewerForbidden: Array<
    [
      'draft' | 'in_review' | 'published' | 'archived',
      'draft' | 'in_review' | 'published' | 'archived',
    ]
  > = [
    ['draft', 'in_review'],
    ['draft', 'published'],
    ['in_review', 'published'],
    ['published', 'archived'],
  ];

  it.each(viewerForbidden)(
    'viewer cannot transition %s -> %s',
    async (from, to) => {
      const { res } = await runTransition({
        role: 'viewer',
        fromStatus: from,
        newStatus: to,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toContain('Permission denied');
      expect(res.content[0]?.text).toContain('editor or admin');
    },
  );
});

// ---------------------------------------------------------------------------
// State-machine validity (admin can hit a 409-equivalent on disallowed transitions)
// ---------------------------------------------------------------------------

describe('update_publication_status — state-machine disallowed transitions', () => {
  // Per §3.2 these transitions are NEVER allowed for any role:
  //   draft → archived (drafts are deleted, not archived)
  //   in_review → archived
  //   archived → in_review
  //   published → in_review
  const disallowedForAdmin: Array<
    [
      'draft' | 'in_review' | 'published' | 'archived',
      'draft' | 'in_review' | 'published' | 'archived',
    ]
  > = [
    ['draft', 'archived'],
    ['in_review', 'archived'],
    ['archived', 'in_review'],
    ['published', 'in_review'],
  ];

  it.each(disallowedForAdmin)(
    'admin %s -> %s is rejected as a state-machine violation (409-equivalent)',
    async (from, to) => {
      const { res } = await runTransition({
        role: 'admin',
        fromStatus: from,
        newStatus: to,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toContain(
        `Transition not allowed: '${from}' -> '${to}' for role 'admin'`,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Side-effects on archive transitions
// ---------------------------------------------------------------------------

describe('update_publication_status — archive side-effects', () => {
  // Pin time so we can assert archived_at deterministically.
  const PINNED_DATE = new Date('2026-04-27T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(PINNED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('published -> archived stamps archived_at, archived_by, and archive_reason when supplied', async () => {
    const { res, updatePayload } = await runTransition({
      role: 'admin',
      fromStatus: 'published',
      newStatus: 'archived',
      archiveReason: 'Replaced by 2026 revision',
    });

    expect(res.isError).toBeUndefined();
    expect(updatePayload).toMatchObject({
      publication_status: 'archived',
      archived_at: PINNED_DATE.toISOString(),
      archived_by: TEST_USER_ID,
      archive_reason: 'Replaced by 2026 revision',
    });
    expect(res.structuredContent?.archive_reason).toBe(
      'Replaced by 2026 revision',
    );
  });

  it('published -> archived without archive_reason omits the column from the update payload', async () => {
    const { res, updatePayload } = await runTransition({
      role: 'admin',
      fromStatus: 'published',
      newStatus: 'archived',
    });

    expect(res.isError).toBeUndefined();
    expect(updatePayload).toMatchObject({
      publication_status: 'archived',
      archived_at: PINNED_DATE.toISOString(),
      archived_by: TEST_USER_ID,
    });
    // Per spec §3.2 + the T5 helper: archive_reason key is absent (not
    // null) when caller omitted it — the existing column is preserved.
    expect(updatePayload).not.toHaveProperty('archive_reason');
    expect(res.structuredContent?.archive_reason).toBeNull();
  });

  it('archived -> published clears archived_at but preserves archived_by + archive_reason audit trail', async () => {
    const { res, updatePayload } = await runTransition({
      role: 'admin',
      fromStatus: 'archived',
      newStatus: 'published',
    });

    expect(res.isError).toBeUndefined();
    expect(updatePayload?.publication_status).toBe('published');
    expect(updatePayload?.archived_at).toBeNull();
    // Helper deliberately does NOT set archived_by / archive_reason on un-
    // archive — the previous values stay in the row, preserving audit trail.
    expect(updatePayload).not.toHaveProperty('archived_by');
    expect(updatePayload).not.toHaveProperty('archive_reason');
  });
});

// ---------------------------------------------------------------------------
// content_history row written
// ---------------------------------------------------------------------------

describe('update_publication_status — content_history write', () => {
  it('writes change_type=publication_state with canonical change_reason', async () => {
    const { historyInsertPayload } = await runTransition({
      role: 'editor',
      fromStatus: 'draft',
      newStatus: 'in_review',
    });

    expect(historyInsertPayload).toBeDefined();
    expect(historyInsertPayload?.change_type).toBe('publication_state');
    expect(historyInsertPayload?.change_reason).toBe(
      'Transition from draft to in_review',
    );
    expect(historyInsertPayload?.change_summary).toBe(
      'Publication status: draft -> in_review',
    );
    expect(historyInsertPayload?.content_item_id).toBe(TEST_ITEM_ID);
    expect(historyInsertPayload?.created_by).toBe(TEST_USER_ID);
    // Auto-version: max(0) + 1 = 1.
    expect(historyInsertPayload?.version).toBe(1);
  });

  it('appends archive_reason suffix to change_reason on archive transition', async () => {
    const { historyInsertPayload } = await runTransition({
      role: 'admin',
      fromStatus: 'published',
      newStatus: 'archived',
      archiveReason: 'Superseded by Q2 policy',
    });

    expect(historyInsertPayload?.change_reason).toBe(
      'Transition from published to archived (reason: Superseded by Q2 policy)',
    );
  });
});

// ---------------------------------------------------------------------------
// Item not found
// ---------------------------------------------------------------------------

describe('update_publication_status — error paths', () => {
  it('returns isError when item not found', async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue(TEST_USER_ID);
    mocks.tryQuery.mockResolvedValue({ ok: true, data: null });
    mocks.createMcpClient.mockReturnValue({
      from: vi.fn(() => chain({ data: null, error: null })),
    });

    const mock = createMockServer();
    await registerGovernanceTools(mock.server);
    const tool = findTool(mock.tools, 'update_publication_status');
    const res = await callTool(tool, {
      item_id: TEST_ITEM_ID,
      new_status: 'in_review',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('not found');
  });

  it('surfaces tryQuery DB errors', async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue(TEST_USER_ID);
    mocks.tryQuery.mockResolvedValue({
      ok: false,
      error: { message: 'connection refused' },
    });
    mocks.createMcpClient.mockReturnValue({
      from: vi.fn(() => chain({ data: null, error: null })),
    });

    const mock = createMockServer();
    await registerGovernanceTools(mock.server);
    const tool = findTool(mock.tools, 'update_publication_status');
    const res = await callTool(tool, {
      item_id: TEST_ITEM_ID,
      new_status: 'in_review',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('connection refused');
  });
});

// ---------------------------------------------------------------------------
// get_governance_queue widening — publication_status param
// ---------------------------------------------------------------------------

describe('get_governance_queue — publication_status filter (S202 §5.2 T7)', () => {
  let tools: CapturedTool[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.getMcpUserId.mockReturnValue(TEST_USER_ID);
    mocks.getMcpUserRole.mockResolvedValue('editor');
    mocks.tryQuery.mockResolvedValue({ ok: true, data: null });
    mocks.sb.mockResolvedValue(null);

    const mock = createMockServer();
    tools = mock.tools;
    await registerGovernanceTools(mock.server);
  });

  it('inputSchema declares optional publication_status enum', () => {
    const tool = findTool(tools, 'get_governance_queue');
    const schema = tool.config.inputSchema as Record<string, unknown>;
    expect(schema).toHaveProperty('publication_status');
  });

  it('description mentions the publication_status filter and AND composition', () => {
    const tool = findTool(tools, 'get_governance_queue');
    const desc = tool.config.description as string;
    expect(desc).toContain('publication_status');
    // Spec §7.2: filters compose via AND; description should signal that.
    expect(desc.toLowerCase()).toMatch(/and|compose/);
  });

  it('passes publication_status="in_review" to .eq() alongside the existing filters', async () => {
    const q = chain({ data: [], error: null, count: 0 });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });
    const tool = findTool(tools, 'get_governance_queue');
    await callTool(tool, {
      limit: 20,
      offset: 0,
      publication_status: 'in_review',
    });
    // §5.5 Phase 4 — review-status filter switched from .eq('pending') to
    // .in([...]). publication_status remains an .eq filter.
    const inCalls = (q.in as ReturnType<typeof vi.fn>).mock.calls;
    const eqCalls = (q.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(inCalls).toContainEqual([
      'governance_review_status',
      ['pending', 'review_overdue'],
    ]);
    expect(eqCalls).toContainEqual(['publication_status', 'in_review']);
  });

  it('omits the .eq publication_status filter when the param is not supplied (backwards-compat)', async () => {
    const q = chain({ data: [], error: null, count: 0 });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });
    const tool = findTool(tools, 'get_governance_queue');
    await callTool(tool, { limit: 20, offset: 0 });
    const calls = (q.eq as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, unknown]
    >;
    const hasPubFilter = calls.some(([col]) => col === 'publication_status');
    expect(hasPubFilter).toBe(false);
  });

  it('composes domain + publication_status filters via AND when both are supplied', async () => {
    const q = chain({ data: [], error: null, count: 0 });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });
    const tool = findTool(tools, 'get_governance_queue');
    await callTool(tool, {
      limit: 20,
      offset: 0,
      domain: 'compliance',
      publication_status: 'in_review',
    });
    // §5.5 Phase 4 — review-status filter via .in([...]); domain +
    // publication_status remain .eq filters.
    const inCalls = (q.in as ReturnType<typeof vi.fn>).mock.calls;
    const eqCalls = (q.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(inCalls).toContainEqual([
      'governance_review_status',
      ['pending', 'review_overdue'],
    ]);
    expect(eqCalls).toContainEqual(['primary_domain', 'compliance']);
    expect(eqCalls).toContainEqual(['publication_status', 'in_review']);
  });

  it('surfaces the publication_status filter in structuredContent metadata', async () => {
    const q = chain({ data: [], error: null, count: 0 });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });
    const tool = findTool(tools, 'get_governance_queue');
    const res = await callTool(tool, {
      limit: 20,
      offset: 0,
      publication_status: 'in_review',
    });
    expect(res.structuredContent?.publication_status_filter).toBe('in_review');
    // Domain not supplied — should be null in the result.
    expect(res.structuredContent?.domain_filter).toBeNull();
  });
});
