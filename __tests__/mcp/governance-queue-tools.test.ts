/**
 * Tests for the two S180 P0-23 additions to the governance tool category:
 *   - get_governance_queue
 *   - review_governance_item
 *
 * Uses the same mock-server pattern as trigger-intelligence-poll.test.ts.
 * Mocks auth + supabase client at the module boundary and asserts the tool
 * callbacks drive the right queries, role gates, and notification paths.
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
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/supabase/safe', () => ({
  sb: vi.fn(),
  tryQuery: vi.fn().mockResolvedValue({ ok: true, data: null }),
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
// Mock server + Supabase builder
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

/**
 * Minimal chainable query mock — each chain method returns the same object
 * (chain) so `.eq().order().range()` keeps flowing. The terminator is the
 * `then` hook which resolves the chain to `{ data, error, count }`.
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get_governance_queue MCP tool', () => {
  let tools: CapturedTool[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.getMcpUserId.mockReturnValue('user-admin-001');
    mocks.getMcpUserRole.mockResolvedValue('editor');

    const mock = createMockServer();
    tools = mock.tools;
    await registerGovernanceTools(mock.server);
  });

  it('registers the get_governance_queue tool with READ_ONLY annotations', () => {
    const tool = findTool(tools, 'get_governance_queue');
    expect(tool.config.title).toBe('Get Governance Queue');
    const ann = tool.config.annotations as Record<string, boolean>;
    expect(ann.readOnlyHint).toBe(true);
    expect(ann.idempotentHint).toBe(true);
    expect(ann.destructiveHint).toBe(false);
    expect(ann.openWorldHint).toBe(false);
  });

  it('returns permission denied for viewer role', async () => {
    mocks.checkMcpRole.mockResolvedValueOnce(null);
    const tool = findTool(tools, 'get_governance_queue');
    const res = await callTool(tool, { limit: 20, offset: 0 });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('Permission denied');
    expect(res.content[0]?.text).toContain('editor or admin');
  });

  it('renders the empty-state message when no items are pending', async () => {
    const empty = chain({ data: [], error: null, count: 0 });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => empty) });
    const tool = findTool(tools, 'get_governance_queue');
    const res = await callTool(tool, { limit: 20, offset: 0 });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain('Governance queue is clear');
  });

  it('renders a markdown table when items are pending', async () => {
    const rows = [
      {
        id: 'item-1',
        title: 'Contract policy',
        suggested_title: null,
        primary_domain: 'compliance',
        governance_review_status: 'pending',
        governance_review_due: '2026-04-30T00:00:00Z',
        governance_reviewer_id: 'user-rachel',
        updated_by: 'user-james',
        updated_at: '2026-04-15T09:00:00Z',
      },
      {
        id: 'item-2',
        title: null,
        suggested_title: 'Draft anti-bribery policy',
        primary_domain: 'compliance',
        governance_review_status: 'pending',
        governance_review_due: null,
        governance_reviewer_id: null,
        updated_by: 'user-james',
        updated_at: '2026-04-14T12:30:00Z',
      },
    ];
    const q = chain({ data: rows, error: null, count: 2 });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });
    const tool = findTool(tools, 'get_governance_queue');
    const res = await callTool(tool, { limit: 20, offset: 0 });
    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('# Governance Queue');
    expect(text).toContain('Contract policy');
    expect(text).toContain('Draft anti-bribery policy'); // suggested_title fallback
    expect(text).toContain('30/04/2026'); // UK date
    expect(text).toContain('—'); // null placeholders
    expect(res.structuredContent?.total).toBe(2);
  });

  it('passes the optional domain filter through to the query', async () => {
    const q = chain({ data: [], error: null, count: 0 });
    const from = vi.fn(() => q);
    mocks.createMcpClient.mockReturnValue({ from });
    const tool = findTool(tools, 'get_governance_queue');
    await callTool(tool, { limit: 20, offset: 0, domain: 'audit-content' });
    // `.eq` is invoked twice: first for governance_review_status='pending',
    // then for primary_domain='audit-content' when the arg is supplied.
    const calls = (q.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(['governance_review_status', 'pending']);
    expect(calls).toContainEqual(['primary_domain', 'audit-content']);
  });

  it('surfaces DB errors via isError', async () => {
    const q = chain({ data: null, error: { message: 'db down' }, count: null });
    mocks.createMcpClient.mockReturnValue({ from: vi.fn(() => q) });
    const tool = findTool(tools, 'get_governance_queue');
    const res = await callTool(tool, { limit: 20, offset: 0 });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('db down');
  });
});

describe('review_governance_item MCP tool', () => {
  let tools: CapturedTool[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.getMcpUserId.mockReturnValue('user-admin-001');
    mocks.getMcpUserRole.mockResolvedValue('editor');

    const mock = createMockServer();
    tools = mock.tools;
    await registerGovernanceTools(mock.server);
  });

  it('registers the review_governance_item tool with NON_IDEMPOTENT_WRITE annotations', () => {
    const tool = findTool(tools, 'review_governance_item');
    expect(tool.config.title).toBe('Process Governance Review Action');
    const ann = tool.config.annotations as Record<string, boolean>;
    expect(ann.readOnlyHint).toBe(false);
    expect(ann.idempotentHint).toBe(false);
    expect(ann.destructiveHint).toBe(false);
    expect(ann.openWorldHint).toBe(false);
  });

  it('returns permission denied for viewer role', async () => {
    mocks.checkMcpRole.mockResolvedValueOnce(null);
    const tool = findTool(tools, 'review_governance_item');
    const res = await callTool(tool, {
      item_id: '11111111-1111-4111-8111-111111111111',
      action: 'approve',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('Permission denied');
  });

  it('rejects items not currently pending review', async () => {
    const fromMock = vi.fn((_table: string) => {
      return chain({
        data: {
          id: 'x',
          title: 'Already approved',
          suggested_title: null,
          governance_review_status: 'approved',
          content_owner_id: null,
          updated_by: null,
        },
        error: null,
      });
    });
    mocks.createMcpClient.mockReturnValue({ from: fromMock });
    const tool = findTool(tools, 'review_governance_item');
    const res = await callTool(tool, {
      item_id: '11111111-1111-4111-8111-111111111111',
      action: 'approve',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('not pending governance review');
    expect(res.content[0]?.text).toContain('approved');
  });

  it('returns 404-style error when item does not exist', async () => {
    const fromMock = vi.fn(() => chain({ data: null, error: null }));
    mocks.createMcpClient.mockReturnValue({ from: fromMock });
    const tool = findTool(tools, 'review_governance_item');
    const res = await callTool(tool, {
      item_id: '11111111-1111-4111-8111-111111111111',
      action: 'approve',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('not found');
  });

  it('approves an item and produces a success markdown + structuredContent', async () => {
    let step = 0;
    const itemRow = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Awaiting approval',
      suggested_title: null,
      governance_review_status: 'pending',
      content_owner_id: 'user-owner',
      updated_by: 'user-editor',
    };
    const fromMock = vi.fn(() => {
      step += 1;
      if (step === 1) {
        // initial fetch — `.maybeSingle`
        return chain({ data: itemRow, error: null });
      }
      if (step === 2) {
        // update — chain awaited directly via then
        return chain({ data: { id: itemRow.id }, error: null });
      }
      // Notification inserts — return empty success
      return chain({ data: null, error: null });
    });
    mocks.createMcpClient.mockReturnValue({ from: fromMock });

    const tool = findTool(tools, 'review_governance_item');
    const res = await callTool(tool, {
      item_id: itemRow.id,
      action: 'approve',
      notes: 'LGTM — consistent with 2025 revisions.',
    });

    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('# Governance review — Approved');
    expect(text).toContain(itemRow.id);
    expect(text).toContain('LGTM');
    expect(res.structuredContent?.new_status).toBe('approved');
    expect(res.structuredContent?.action).toBe('approve');
  });

  it('routes each of the 3 actions to the matching new_status', async () => {
    const actions: Array<[string, string]> = [
      ['approve', 'approved'],
      ['request_changes', 'changes_requested'],
      ['revert', 'reverted'],
    ];

    for (const [action, newStatus] of actions) {
      vi.clearAllMocks();
      mocks.checkMcpRole.mockResolvedValue('editor');
      mocks.getMcpUserId.mockReturnValue('user-admin-001');
      mocks.getMcpUserRole.mockResolvedValue('editor');

      let step = 0;
      const fromMock = vi.fn(() => {
        step += 1;
        if (step === 1) {
          return chain({
            data: {
              id: 'abc',
              title: 'Item',
              suggested_title: null,
              governance_review_status: 'pending',
              content_owner_id: null,
              updated_by: null,
            },
            error: null,
          });
        }
        return chain({ data: { id: 'abc' }, error: null });
      });
      mocks.createMcpClient.mockReturnValue({ from: fromMock });

      const mock = createMockServer();
      tools = mock.tools;
      await registerGovernanceTools(mock.server);
      const tool = findTool(tools, 'review_governance_item');

      const res = await callTool(tool, {
        item_id: '11111111-1111-4111-8111-111111111111',
        action,
      });
      expect(res.isError).toBeUndefined();
      expect(res.structuredContent?.new_status).toBe(newStatus);
    }
  });

  // ──────────────────────────────────────────
  // S200 WP5 §5.5 Phase 1 / §6.5.1 — guard widening
  // ──────────────────────────────────────────

  it('accepts items in review_overdue (Phase 2 cron path)', async () => {
    let step = 0;
    const itemRow = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Overdue review',
      suggested_title: null,
      governance_review_status: 'review_overdue',
      content_owner_id: null,
      updated_by: null,
    };
    const fromMock = vi.fn(() => {
      step += 1;
      if (step === 1) {
        // initial fetch — `.maybeSingle`
        return chain({ data: itemRow, error: null });
      }
      if (step === 2) {
        // update — chain awaited directly via then
        return chain({ data: { id: itemRow.id }, error: null });
      }
      // Notification inserts — return empty success
      return chain({ data: null, error: null });
    });
    mocks.createMcpClient.mockReturnValue({ from: fromMock });

    const tool = findTool(tools, 'review_governance_item');
    const res = await callTool(tool, {
      item_id: itemRow.id,
      action: 'approve',
    });

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.new_status).toBe('approved');
    expect(res.structuredContent?.action).toBe('approve');
  });

  it('continues to reject items in draft (regression check)', async () => {
    const fromMock = vi.fn((_table: string) => {
      return chain({
        data: {
          id: 'x',
          title: 'In draft',
          suggested_title: null,
          governance_review_status: 'draft',
          content_owner_id: null,
          updated_by: null,
        },
        error: null,
      });
    });
    mocks.createMcpClient.mockReturnValue({ from: fromMock });
    const tool = findTool(tools, 'review_governance_item');
    const res = await callTool(tool, {
      item_id: '11111111-1111-4111-8111-111111111111',
      action: 'approve',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('not pending governance review');
    expect(res.content[0]?.text).toContain('draft');
  });
});
