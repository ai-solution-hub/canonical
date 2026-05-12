/**
 * Tests for the three S180 P0-23 review workflow tools:
 *   - get_review_queue
 *   - get_assignments_for_user
 *   - create_review_assignment
 *
 * Mirrors the mock pattern from governance-queue-tools.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  checkMcpRole: vi.fn(),
  createMcpClient: vi.fn(),
  getMcpUserId: vi.fn(),
  getMcpUserRole: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: mocks.createNotification,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { registerReviewTools } from '@/lib/mcp/tools/review';
import {
  createMockMcpServer,
  type MockToolRegistration,
} from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Chainable Supabase builder
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

const MOCK_EXTRA = {
  authInfo: {
    token: 'test-bearer-token',
    extra: { userId: 'user-admin-001', role: 'admin' },
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

// ---------------------------------------------------------------------------
// get_review_queue
// ---------------------------------------------------------------------------

describe('get_review_queue MCP tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.getMcpUserId.mockReturnValue('user-editor-001');
    mocks.getMcpUserRole.mockResolvedValue('editor');

    mockServer = createMockMcpServer();
    await registerReviewTools(mockServer.server);
  });

  it('registers with READ_ONLY annotations', () => {
    const tool = mockServer.getTool('get_review_queue')!;
    expect(tool.config.title).toBe('Get Review Queue');
    const ann = tool.config.annotations as Record<string, boolean>;
    expect(ann.readOnlyHint).toBe(true);
    expect(ann.destructiveHint).toBe(false);
  });

  it('returns permission denied for viewer role', async () => {
    mocks.checkMcpRole.mockResolvedValueOnce(null);
    const tool = mockServer.getTool('get_review_queue')!;
    const res = await callTool(tool, { status: 'unverified' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('Permission denied');
  });

  it('returns a friendly not-yet-available message for flagged status', async () => {
    const tool = mockServer.getTool('get_review_queue')!;
    const res = await callTool(tool, { status: 'flagged' });
    // Not an error — the tool chose to surface a helpful pointer rather
    // than error out. Makes the caller aware without breaking their flow.
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain(
      'Flagged items view is not yet available',
    );
    expect(res.content[0]?.text).toContain('web review queue');
  });

  it('renders an empty queue result correctly', async () => {
    let call = 0;
    const fromMock = vi.fn(() => {
      call += 1;
      if (call === 1) return chain({ data: [], error: null, count: 0 });
      // verified_count + flagged_count head-queries — just return 0 each.
      return chain({ data: null, error: null, count: 0 });
    });
    mocks.createMcpClient.mockReturnValue({ from: fromMock });
    const tool = mockServer.getTool('get_review_queue')!;
    const res = await callTool(tool, { status: 'unverified' });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain('# Review Queue');
    expect(res.content[0]?.text).toContain('No items match');
  });

  it('renders a table with rows and applies the domain filter', async () => {
    const itemRows = [
      {
        id: 'item-1',
        title: 'Safeguarding policy',
        suggested_title: null,
        primary_domain: 'compliance',
        content_type: 'policy',
        quality_score: 78,
        classification_confidence: 0.85,
        verified_at: null,
        governance_review_status: null,
      },
    ];

    let call = 0;
    const primaryChain = chain({ data: itemRows, error: null, count: 1 });
    const verificationChain = chain({ data: [], error: null });
    const verifiedCount = chain({ data: null, error: null, count: 42 });
    const flaggedCount = chain({ data: null, error: null, count: 3 });

    const fromMock = vi.fn(() => {
      call += 1;
      if (call === 1) return primaryChain;
      if (call === 2) return verificationChain;
      if (call === 3) return verifiedCount;
      return flaggedCount;
    });
    mocks.createMcpClient.mockReturnValue({ from: fromMock });

    const tool = mockServer.getTool('get_review_queue')!;
    const res = await callTool(tool, {
      status: 'unverified',
      domain: 'compliance',
      limit: 20,
      offset: 0,
    });

    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('Safeguarding policy');
    expect(text).toContain('`compliance`');
    expect(text).toContain('42 verified, 3 flagged');

    // Domain filter applied via `.eq('primary_domain', 'compliance')`
    const eqCalls = (primaryChain.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual(['primary_domain', 'compliance']);
  });
});

// ---------------------------------------------------------------------------
// get_assignments_for_user
// ---------------------------------------------------------------------------

describe('get_assignments_for_user MCP tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    await registerReviewTools(mockServer.server);
  });

  it('registers with READ_ONLY annotations', () => {
    const tool = mockServer.getTool('get_assignments_for_user')!;
    const ann = tool.config.annotations as Record<string, boolean>;
    expect(ann.readOnlyHint).toBe(true);
  });

  it('denies viewer role', async () => {
    mocks.checkMcpRole.mockResolvedValueOnce(null);
    const tool = mockServer.getTool('get_assignments_for_user')!;
    const res = await callTool(tool, { status: 'active' });
    expect(res.isError).toBe(true);
  });

  it('auto-scopes non-admin caller to own reviewer_id even when arg points elsewhere', async () => {
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.getMcpUserId.mockReturnValue('editor-self-id');
    mocks.getMcpUserRole.mockResolvedValue('editor');

    const q = chain({ data: [], error: null });
    const fromMock = vi.fn(() => q);
    mocks.createMcpClient.mockReturnValue({ from: fromMock });

    const tool = mockServer.getTool('get_assignments_for_user')!;
    const res = await callTool(tool, {
      status: 'active',
      // Non-admin tries to query another reviewer — must NOT escape scope.
      reviewer_id: '99999999-9999-4999-8999-999999999999',
    });

    expect(res.isError).toBeUndefined();
    const eqCalls = (q.eq as ReturnType<typeof vi.fn>).mock.calls;
    // Assignment self-scope is enforced: reviewer_id is always the caller's
    // own ID regardless of the arg.
    expect(eqCalls).toContainEqual(['reviewer_id', 'editor-self-id']);
    expect(eqCalls).not.toContainEqual([
      'reviewer_id',
      '99999999-9999-4999-8999-999999999999',
    ]);
    expect(res.structuredContent?.scope).toBe('self');
  });

  it('admin can query any reviewer_id', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('admin-id');
    mocks.getMcpUserRole.mockResolvedValue('admin');

    const q = chain({ data: [], error: null });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });

    const tool = mockServer.getTool('get_assignments_for_user')!;
    const res = await callTool(tool, {
      status: 'active',
      reviewer_id: '44444444-4444-4444-8444-444444444444',
    });

    expect(res.isError).toBeUndefined();
    const eqCalls = (q.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual([
      'reviewer_id',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(res.structuredContent?.scope).toBe('reviewer');
  });

  it('admin with no reviewer_id sees all assignments (scope=all)', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('admin-id');
    mocks.getMcpUserRole.mockResolvedValue('admin');

    const rows = [
      {
        id: 'assignment-1',
        reviewer_id: 'reviewer-a',
        assigned_by: 'admin-id',
        assignment_type: 'manual',
        status: 'active',
        filter_domains: ['compliance'],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        due_date: '2026-04-30T00:00:00Z',
        item_count: 10,
        notes: null,
        completed_at: null,
        created_at: '2026-04-10T00:00:00Z',
      },
    ];
    const q = chain({ data: rows, error: null });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });

    const tool = mockServer.getTool('get_assignments_for_user')!;
    const res = await callTool(tool, { status: 'active' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.scope).toBe('all');
    expect(res.content[0]?.text).toContain('30/04/2026'); // UK date format
    expect(res.content[0]?.text).toContain('reviewer-a');
  });

  it('applies the status filter when not "all"', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('admin-id');
    mocks.getMcpUserRole.mockResolvedValue('admin');
    const q = chain({ data: [], error: null });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });

    const tool = mockServer.getTool('get_assignments_for_user')!;
    await callTool(tool, { status: 'completed' });
    const eqCalls = (q.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual(['status', 'completed']);
  });
});

// ---------------------------------------------------------------------------
// create_review_assignment
// ---------------------------------------------------------------------------

describe('create_review_assignment MCP tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    await registerReviewTools(mockServer.server);
  });

  it('registers with NON_IDEMPOTENT_WRITE annotations', () => {
    const tool = mockServer.getTool('create_review_assignment')!;
    const ann = tool.config.annotations as Record<string, boolean>;
    expect(ann.readOnlyHint).toBe(false);
    expect(ann.idempotentHint).toBe(false);
    expect(ann.destructiveHint).toBe(false);
    expect(ann.openWorldHint).toBe(false);
  });

  it('rejects non-admin callers (editor gets permission denied)', async () => {
    mocks.checkMcpRole.mockResolvedValueOnce(null);
    const tool = mockServer.getTool('create_review_assignment')!;
    const res = await callTool(tool, {
      reviewer_id: '11111111-1111-4111-8111-111111111111',
      filter_domains: [],
      filter_content_types: [],
      filter_freshness: [],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('admin role required');
  });

  it('creates an assignment with item_count from filter head-query + fires notification', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('admin-id');

    let call = 0;
    const countChain = chain({ data: null, error: null, count: 12 });
    const newAssignment = {
      id: 'new-assignment-id',
      reviewer_id: '11111111-1111-4111-8111-111111111111',
      assigned_by: 'admin-id',
      assignment_type: 'manual',
      status: 'active',
      filter_domains: ['compliance'],
      filter_content_types: [],
      filter_freshness: [],
      filter_date_from: null,
      filter_date_to: null,
      item_count: 12,
      due_date: '2026-04-30T00:00:00Z',
      notes: 'Please prioritise the certification-adjacent items.',
      completed_at: null,
      created_at: '2026-04-21T00:00:00Z',
    };
    const insertChain = chain({ data: newAssignment, error: null });

    const fromMock = vi.fn(() => {
      call += 1;
      if (call === 1) return countChain;
      return insertChain;
    });
    mocks.createMcpClient.mockReturnValue({ from: fromMock });
    mocks.createNotification.mockResolvedValue({ error: null });

    const tool = mockServer.getTool('create_review_assignment')!;
    const res = await callTool(tool, {
      reviewer_id: '11111111-1111-4111-8111-111111111111',
      filter_domains: ['compliance'],
      filter_content_types: [],
      filter_freshness: [],
      due_date: '2026-04-30T00:00:00Z',
      notes: 'Please prioritise the certification-adjacent items.',
    });

    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('# Review Assignment Created');
    expect(text).toContain('12 items matching filter');
    expect(text).toContain('30/04/2026');

    expect(res.structuredContent?.item_count).toBe(12);
    expect(res.structuredContent?.notification_sent).toBe(true);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);

    // filter applied to count query
    const inCalls = (countChain.in as ReturnType<typeof vi.fn>).mock.calls;
    expect(inCalls).toContainEqual(['primary_domain', ['compliance']]);
  });

  it('does not roll back assignment on notification failure', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('admin-id');

    let call = 0;
    const countChain = chain({ data: null, error: null, count: 3 });
    const assignmentRow = {
      id: 'assignment-abc',
      reviewer_id: '11111111-1111-4111-8111-111111111111',
      assigned_by: 'admin-id',
      item_count: 3,
    };
    const insertChain = chain({ data: assignmentRow, error: null });

    mocks.createMcpClient.mockReturnValue({
      from: vi.fn(() => {
        call += 1;
        return call === 1 ? countChain : insertChain;
      }),
    });
    mocks.createNotification.mockResolvedValue({
      error: { message: 'SMTP down' },
    });

    const tool = mockServer.getTool('create_review_assignment')!;
    const res = await callTool(tool, {
      reviewer_id: '11111111-1111-4111-8111-111111111111',
      filter_domains: [],
      filter_content_types: [],
      filter_freshness: [],
    });

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.notification_sent).toBe(false);
    expect(res.structuredContent?.notification_error).toBe('SMTP down');
    // The assignment itself is recorded successfully
    expect(res.structuredContent?.id).toBe('assignment-abc');
    expect(res.content[0]?.text).toContain('Notification failed: SMTP down');
  });

  it('surfaces DB insert errors as isError', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('admin-id');
    let call = 0;
    const countChain = chain({ data: null, error: null, count: 0 });
    const insertChain = chain({
      data: null,
      error: { message: 'FK constraint' },
    });
    mocks.createMcpClient.mockReturnValue({
      from: vi.fn(() => {
        call += 1;
        return call === 1 ? countChain : insertChain;
      }),
    });

    const tool = mockServer.getTool('create_review_assignment')!;
    const res = await callTool(tool, {
      reviewer_id: '11111111-1111-4111-8111-111111111111',
      filter_domains: [],
      filter_content_types: [],
      filter_freshness: [],
    });

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('FK constraint');
  });
});
