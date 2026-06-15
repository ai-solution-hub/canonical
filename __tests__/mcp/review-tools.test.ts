/**
 * Tests for the review workflow write tool:
 *   - create_review_assignment
 *
 * ID-71.9 (M30/OQ-5, B-INV-30) retired the read tools `get_review_queue` and
 * `get_assignments_for_user` into the consolidated `whats_in_my_queue` faceted
 * queue — their handler tests retired with them (see
 * __tests__/mcp/whats-in-my-queue-tool.test.ts for the content-quality facet).
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
