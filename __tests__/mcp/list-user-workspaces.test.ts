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

import { registerWorkspaceTools } from '@/lib/mcp/tools/workspaces';
import {
  createMockMcpServer,
  type MockToolRegistration,
} from '@/__tests__/helpers/mcp-server';

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

// Post-T2: MCP tool selects `workspaces.id, name, application_types!inner(key)`
// and projects the nested `application_types.key` as `type` in the response.
// Fixtures here represent the *DB row* shape returned to the tool, not the
// API-projected response.
const WORKSPACE_FIXTURES = {
  intelligence: {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    name: 'UK Education Sector',
    application_types: { key: 'intelligence' },
  },
  bid: {
    id: 'a1234567-89ab-4cde-8000-ffffffffffff',
    name: 'DfE Framework 2026',
    application_types: { key: 'procurement' },
  },
  kbSection: {
    id: 'b2345678-90ab-4cde-8000-ffffffffffff',
    name: 'Safeguarding Library',
    application_types: { key: 'kb_section' },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('list_user_workspaces MCP tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('viewer');

    // Re-wire the chained query mock after clearAllMocks
    mocks.selectReturn.eq.mockReturnThis();
    mocks.selectReturn.order.mockResolvedValue({ data: [], error: null });
    mocks.fromReturn.select.mockReturnValue(mocks.selectReturn);
    mocks.supabaseClient.from.mockReturnValue(mocks.fromReturn);
    mocks.createMcpClient.mockReturnValue(mocks.supabaseClient);

    mockServer = createMockMcpServer();
    await registerWorkspaceTools(mockServer.server);
  });

  function getWorkspaceTool(): MockToolRegistration {
    const tool = mockServer.getTool('list_user_workspaces');
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
    const result = (await tool.handler({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: Record<string, unknown>;
    };

    expect(result.content[0].text).toContain('No workspaces found');
    expect(result.structuredContent).toEqual({ workspaces: [] });
  });

  it('returns single workspace with correct shape', async () => {
    mocks.selectReturn.order.mockResolvedValue({
      data: [WORKSPACE_FIXTURES.intelligence],
      error: null,
    });

    const tool = getWorkspaceTool();
    const result = (await tool.handler({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: unknown;
    };

    expect(result.content[0].text).toContain('Workspaces (1)');
    expect(result.content[0].text).toContain('UK Education Sector');
    const structured = (
      result.structuredContent as {
        workspaces: Array<{ id: string; name: string; type: string }>;
      }
    ).workspaces;
    expect(structured).toHaveLength(1);
    expect(structured[0]).toEqual({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'UK Education Sector',
      // Projected from application_types.key
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
    const result = (await tool.handler({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: unknown;
    };

    expect(result.content[0].text).toContain('Workspaces (3)');
    const structured = (
      result.structuredContent as {
        workspaces: Array<{ id: string; name: string; type: string }>;
      }
    ).workspaces;
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
    await tool.handler({ type: 'intelligence' }, MOCK_EXTRA);

    // Post-T2: discriminator is `application_types.key` via JOIN, not the
    // dropped `workspaces.type` text col. Verify both `is_archived` filter
    // and the nested-key filter were applied.
    expect(eqCalls).toContainEqual(['is_archived', false]);
    expect(eqCalls).toContainEqual(['application_types.key', 'intelligence']);
  });

  it('remaps type: "bid" to DB application_types.key "procurement" when filtering', async () => {
    // The MCP tool accepts 'bid' as a legacy filter value, but post-T2 the DB
    // application_types.key is `procurement` (per Q-OQR1-02). Mapping happens
    // in the query layer.
    const eqCalls: Array<[string, unknown]> = [];
    const chainedQuery = {
      eq: vi.fn((...args: [string, unknown]) => {
        eqCalls.push(args);
        return chainedQuery;
      }),
      order: vi.fn().mockResolvedValue({
        data: [WORKSPACE_FIXTURES.bid],
        error: null,
      }),
    };
    mocks.fromReturn.select.mockReturnValue(chainedQuery);

    const tool = getWorkspaceTool();
    await tool.handler({ type: 'bid' }, MOCK_EXTRA);

    // Post-T2 key is procurement (bid → procurement remap)
    expect(eqCalls).toContainEqual([
      'application_types.key',
      'procurement',
    ]);
    expect(eqCalls).not.toContainEqual(['application_types.key', 'bid']);
  });

  it('remaps type: "content" to DB enum "kb_section" when filtering', async () => {
    // The tool accepts 'content' as the user-facing type name but the DB
    // application_types.key it maps to is `kb_section`. Even though no rows
    // exist for that key (kb_section retired post-T2), the remap still runs
    // in the query layer — we only assert the call, not row presence.
    const eqCalls: Array<[string, unknown]> = [];
    const chainedQuery = {
      eq: vi.fn((...args: [string, unknown]) => {
        eqCalls.push(args);
        return chainedQuery;
      }),
      order: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    };
    mocks.fromReturn.select.mockReturnValue(chainedQuery);

    const tool = getWorkspaceTool();
    await tool.handler({ type: 'content' }, MOCK_EXTRA);

    // content remaps to kb_section against application_types.key
    expect(eqCalls).toContainEqual(['application_types.key', 'kb_section']);
    expect(eqCalls).not.toContainEqual(['application_types.key', 'content']);
  });

  it('denies access to unauthenticated users', async () => {
    mocks.checkMcpRole.mockResolvedValue(null);

    const tool = getWorkspaceTool();
    const result = (await tool.handler({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
  });
});
