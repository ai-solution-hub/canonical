import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const selectReturn = {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const fromReturn = {
    select: vi.fn().mockReturnValue(selectReturn),
  };
  const supabaseClient = {
    from: vi.fn().mockReturnValue(fromReturn),
  };

  return {
    checkMcpRole: vi.fn().mockResolvedValue('viewer'),
    createMcpClient: vi.fn().mockReturnValue(supabaseClient),
    supabaseClient,
    fromReturn,
    selectReturn,
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/supabase/safe', () => ({
  sb: vi.fn(
    async (
      queryPromise: Promise<{ data: unknown; error: unknown }>,
      _context?: string,
    ) => {
      const result = await queryPromise;
      if (result.error) throw new Error(String(result.error));
      return result.data;
    },
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWorkspaceTools } from '@/lib/mcp/tools/workspaces';

// ---------------------------------------------------------------------------
// Mock server that captures tool registrations
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_AUTH_INFO = {
  token: 'test-bearer-token',
  extra: { userId: 'a1b2c3d4-e5f6-4000-8000-000000000001', role: 'viewer' },
};

const MOCK_EXTRA = {
  authInfo: MOCK_AUTH_INFO,
  signal: new AbortController().signal,
  sendNotification: vi.fn(),
  _meta: undefined,
  requestId: 'test-req-ws-1',
  sendElicitationRequest: vi.fn(),
};

const WORKSPACE_FIXTURES = {
  intelligence: {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    name: 'UK Education Sector',
    type: 'intelligence',
  },
  bid: {
    id: 'a1234567-89ab-4cde-8000-ffffffffffff',
    name: 'DfE Framework 2026',
    type: 'bid',
  },
  kbSection: {
    id: 'b2345678-90ab-4cde-8000-ffffffffffff',
    name: 'Safeguarding Library',
    type: 'kb_section',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('list_user_workspaces MCP tool', () => {
  let tools: CapturedTool[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('viewer');

    // Re-wire the chained query mock after clearAllMocks
    mocks.selectReturn.eq.mockReturnThis();
    mocks.selectReturn.order.mockResolvedValue({ data: [], error: null });
    mocks.fromReturn.select.mockReturnValue(mocks.selectReturn);
    mocks.supabaseClient.from.mockReturnValue(mocks.fromReturn);
    mocks.createMcpClient.mockReturnValue(mocks.supabaseClient);

    const mock = createMockServer();
    tools = mock.tools;
    await registerWorkspaceTools(mock.server);
  });

  function getWorkspaceTool(): CapturedTool {
    const tool = tools.find((t) => t.name === 'list_user_workspaces');
    if (!tool) throw new Error('list_user_workspaces not registered');
    return tool;
  }

  it('registers with READ_ONLY_ANNOTATIONS', () => {
    const tool = getWorkspaceTool();
    const annotations = tool.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.openWorldHint).toBe(false);
  });

  it('returns empty array when user has no workspaces', async () => {
    mocks.selectReturn.order.mockResolvedValue({ data: [], error: null });

    const tool = getWorkspaceTool();
    const result = (await tool.callback({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: Record<string, unknown>;
    };

    expect(result.content[0].text).toContain('No workspaces found');
    expect(result.structuredContent).toEqual([]);
  });

  it('returns single workspace with correct shape', async () => {
    mocks.selectReturn.order.mockResolvedValue({
      data: [WORKSPACE_FIXTURES.intelligence],
      error: null,
    });

    const tool = getWorkspaceTool();
    const result = (await tool.callback({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: unknown;
    };

    expect(result.content[0].text).toContain('Workspaces (1)');
    expect(result.content[0].text).toContain('UK Education Sector');
    const structured = result.structuredContent as Array<{
      id: string;
      name: string;
      type: string;
    }>;
    expect(structured).toHaveLength(1);
    expect(structured[0]).toEqual({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'UK Education Sector',
      type: 'intelligence',
    });
  });

  it('returns multiple workspaces ordered by name', async () => {
    const allWorkspaces = [
      WORKSPACE_FIXTURES.bid,
      WORKSPACE_FIXTURES.kbSection,
      WORKSPACE_FIXTURES.intelligence,
    ];
    mocks.selectReturn.order.mockResolvedValue({
      data: allWorkspaces,
      error: null,
    });

    const tool = getWorkspaceTool();
    const result = (await tool.callback({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: unknown;
    };

    expect(result.content[0].text).toContain('Workspaces (3)');
    const structured = result.structuredContent as Array<{
      id: string;
      name: string;
      type: string;
    }>;
    expect(structured).toHaveLength(3);
    // Verify all workspace IDs are present
    const ids = structured.map((ws) => ws.id);
    expect(ids).toContain(WORKSPACE_FIXTURES.bid.id);
    expect(ids).toContain(WORKSPACE_FIXTURES.kbSection.id);
    expect(ids).toContain(WORKSPACE_FIXTURES.intelligence.id);
  });

  it('applies type filter when provided', async () => {
    // Track all eq calls across the chain
    const eqCalls: Array<[string, unknown]> = [];
    const chainedQuery = {
      eq: vi.fn((...args: [string, unknown]) => {
        eqCalls.push(args);
        return chainedQuery;
      }),
      order: vi.fn().mockResolvedValue({
        data: [WORKSPACE_FIXTURES.intelligence],
        error: null,
      }),
    };
    mocks.fromReturn.select.mockReturnValue(chainedQuery);

    const tool = getWorkspaceTool();
    await tool.callback({ type: 'intelligence' }, MOCK_EXTRA);

    // Verify eq was called with both is_archived and type filter
    expect(eqCalls).toContainEqual(['is_archived', false]);
    expect(eqCalls).toContainEqual(['type', 'intelligence']);
  });

  it('remaps type: "content" to DB enum "kb_section" when filtering', async () => {
    // The tool accepts 'content' as the user-facing type name but the DB enum
    // is `kb_section` — mapping must happen in the query layer.
    const eqCalls: Array<[string, unknown]> = [];
    const chainedQuery = {
      eq: vi.fn((...args: [string, unknown]) => {
        eqCalls.push(args);
        return chainedQuery;
      }),
      order: vi.fn().mockResolvedValue({
        data: [WORKSPACE_FIXTURES.kbSection],
        error: null,
      }),
    };
    mocks.fromReturn.select.mockReturnValue(chainedQuery);

    const tool = getWorkspaceTool();
    await tool.callback({ type: 'content' }, MOCK_EXTRA);

    // DB enum is kb_section, not content
    expect(eqCalls).toContainEqual(['type', 'kb_section']);
    expect(eqCalls).not.toContainEqual(['type', 'content']);
  });

  it('denies access to unauthenticated users', async () => {
    mocks.checkMcpRole.mockResolvedValue(null);

    const tool = getWorkspaceTool();
    const result = (await tool.callback({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
  });
});
