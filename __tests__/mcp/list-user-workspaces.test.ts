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

// A filter-aware query mock: records the eq() predicates the production code
// applies and filters the seeded dataset by them, so the handler's observable
// output reflects whether the query was actually scoped. Dropping a filter (or
// the bid->procurement remap) changes what the caller sees — making the output
// assertions load-bearing rather than fixture-echoes.
function seedFilterableWorkspaces(rows: Array<Record<string, unknown>>): void {
  const eqFilters: Array<[string, unknown]> = [];
  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      eqFilters.push([column, value]);
      return query;
    }),
    order: vi.fn(async () => ({
      data: rows.filter((row) =>
        eqFilters.every(([column, value]) => {
          if (column === 'application_types.key') {
            return (row.application_types as { key: string }).key === value;
          }
          if (column === 'is_archived') {
            return (row.is_archived ?? false) === value;
          }
          return true;
        }),
      ),
      error: null,
    })),
  };
  mocks.fromReturn.select.mockReturnValue(query);
}

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

  it('returns only the requested type when a type filter is provided', async () => {
    // Seed a mixed dataset: a live intelligence workspace, an ARCHIVED
    // intelligence workspace (must be excluded by .eq('is_archived', false)),
    // and a procurement workspace (must be excluded by the type filter). The
    // filter-aware mock returns only rows surviving the recorded eq() filters,
    // so the assertion fails if production drops EITHER filter.
    seedFilterableWorkspaces([
      WORKSPACE_FIXTURES.intelligence,
      {
        ...WORKSPACE_FIXTURES.intelligence,
        id: 'c3333333-3333-4333-8333-333333333333',
        name: 'Archived Intelligence Space',
        is_archived: true,
      },
      WORKSPACE_FIXTURES.bid,
    ]);

    const tool = getWorkspaceTool();
    const result = (await tool.handler(
      { type: 'intelligence' },
      MOCK_EXTRA,
    )) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: {
        workspaces: Array<{ id: string; name: string; type: string }>;
      };
    };

    // Only the live, non-archived intelligence workspace survives both filters.
    expect(result.structuredContent.workspaces).toEqual([
      {
        id: WORKSPACE_FIXTURES.intelligence.id,
        name: WORKSPACE_FIXTURES.intelligence.name,
        type: 'intelligence',
      },
    ]);
    expect(result.content[0].text).toContain(
      WORKSPACE_FIXTURES.intelligence.name,
    );
  });

  it("explicitly surfaces the gap for type='procurement' instead of silently returning empty", async () => {
    // ID-145 {145.39} (DR-038 form-first): post-W1e the `workspaces` table
    // holds zero procurement rows (536->28 rows dropped), so a
    // type=procurement query against application_types.key would always
    // silently return an empty list. Per the Curator/owner ruling (id-71
    // RESEARCH.md §2.2 does not re-shape this tool onto form_instances), the
    // handler now short-circuits with explicit guidance instead of querying.
    // Seed a row that WOULD match if the query ran, so this test fails if the
    // short-circuit is ever removed and the (broken) query path is restored.
    seedFilterableWorkspaces([
      WORKSPACE_FIXTURES.bid, // application_types.key === 'procurement'
    ]);

    const tool = getWorkspaceTool();
    const result = (await tool.handler(
      { type: 'procurement' },
      MOCK_EXTRA,
    )) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('list_active_procurement');
    expect(result.content[0].text).toContain('get_procurement_detail');
    // The supabase query must never have been reached for this branch.
    expect(mocks.createMcpClient).not.toHaveBeenCalled();
  });

  it("explicitly surfaces the gap for the legacy type='bid' alias too", async () => {
    // Same short-circuit as the 'procurement' case above — 'bid' is the
    // legacy alias and must hit the identical explicit-unsupported path
    // rather than being remapped into a (broken) form_instances-less query.
    seedFilterableWorkspaces([
      WORKSPACE_FIXTURES.bid, // application_types.key === 'procurement'
    ]);

    const tool = getWorkspaceTool();
    const result = (await tool.handler({ type: 'bid' }, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('list_active_procurement');
    expect(result.content[0].text).toContain('get_procurement_detail');
    expect(mocks.createMcpClient).not.toHaveBeenCalled();
  });

  it('input schema enum covers the live application_types vocabulary', () => {
    const tool = getWorkspaceTool();
    const schema = tool.config.inputSchema as {
      type: { unwrap: () => { options: string[] } };
    };
    const options = schema.type.unwrap().options;
    expect(options).toEqual([
      'procurement',
      'intelligence',
      'sales_proposal',
      'product_guide',
      'competitor_research',
      'training_onboarding',
      'bid',
    ]);
    expect(options).not.toContain('content');
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
