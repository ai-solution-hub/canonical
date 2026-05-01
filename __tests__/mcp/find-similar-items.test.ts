import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// S217 W1B — split LLM-discovery surface from admin dedup surface.
// `find_similar_items`        → published-only default (LLM semantic discovery)
// `find_duplicate_candidates` → admin default returning every state
// Spec authority: archived publication-lifecycle-state-machine-spec §5.3.2.
// Both tools share an implementation; only the visibility-filter fallback
// differs. The tests below assert: (a) registration metadata, (b) RPC
// pass-through correctness for both default and override paths, and (c) the
// shared error-handling guard for items missing an embedding.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hoisted mocks — supabase auth client + lazy-loaded embedding generator
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // The find-similar-items handler does `.from('content_items').select(...).eq(...).single()`
  // to fetch the source item before calling the RPC. The chain methods below
  // back that lookup; tests override `singleMock` per case to swap in a
  // source item with or without an embedding.
  const singleMock = vi.fn();
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: singleMock,
  };

  const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const generateEmbeddingMock = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(chainMethods),
    rpc: rpcMock,
    _chain: chainMethods,
  };

  return {
    mockSupabaseClient,
    chainMethods,
    rpcMock,
    singleMock,
    generateEmbeddingMock,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mocks.generateEmbeddingMock,
}));
vi.mock('@/lib/ai/classify', () => ({ classifyContent: vi.fn() }));
vi.mock('@/lib/ai/summarise', () => ({ generateSummary: vi.fn() }));

// ---------------------------------------------------------------------------
// Mock McpServer that captures both registration metadata and tool callbacks
// ---------------------------------------------------------------------------

type ToolHandler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<unknown>;

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface RegisteredTool {
  config: Record<string, unknown>;
  handler: ToolHandler;
}

function createMockMcpServer() {
  const tools: Record<string, RegisteredTool> = {};
  return {
    tools,
    registerTool(
      name: string,
      config: Record<string, unknown>,
      handler: ToolHandler,
    ) {
      tools[name] = { config, handler };
    },
    getTool(name: string): RegisteredTool | undefined {
      return tools[name];
    },
    getHandler(name: string): ToolHandler | undefined {
      return tools[name]?.handler;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// v4-compliant UUID (Zod's `.uuid()` enforces RFC 4122 — see CLAUDE.md gotcha).
const SOURCE_ID = '11111111-2222-4333-8444-555555555555';

function makeSourceItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SOURCE_ID,
    title: 'Source Item',
    suggested_title: 'Source Item (suggested)',
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

function makeRpcSimilarRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
    title: 'Similar Item',
    suggested_title: null,
    content_type: 'note',
    primary_domain: 'compliance',
    similarity: 0.87,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('find_similar_items + find_duplicate_candidates registration', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.singleMock.mockResolvedValue({ data: makeSourceItem(), error: null });
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = createMockMcpServer();
    const { registerTools } = await import('@/lib/mcp/tools');
    await registerTools(
      mockServer as unknown as Parameters<typeof registerTools>[0],
    );
  });

  it('registers find_similar_items with the LLM-discovery title and read-only annotations', () => {
    const tool = mockServer.getTool('find_similar_items');
    expect(tool).toBeDefined();
    expect(tool!.config.title).toBe('Find Similar Items');
    const annotations = tool!.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(false);
  });

  it('registers find_duplicate_candidates with the admin-dedup title and read-only annotations', () => {
    const tool = mockServer.getTool('find_duplicate_candidates');
    expect(tool).toBeDefined();
    expect(tool!.config.title).toBe('Find Duplicate Candidates (Admin)');
    const annotations = tool!.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(false);
  });

  it('find_similar_items description steers admin-dedup callers to the sibling tool', () => {
    const tool = mockServer.getTool('find_similar_items');
    const description = tool!.config.description as string;
    expect(description).toContain('find_duplicate_candidates');
  });

  it('find_duplicate_candidates description steers LLM-discovery callers to the sibling tool', () => {
    const tool = mockServer.getTool('find_duplicate_candidates');
    const description = tool!.config.description as string;
    expect(description).toContain('find_similar_items');
  });

  it('find_similar_items and find_duplicate_candidates expose identical input schemas', () => {
    const a = mockServer.getTool('find_similar_items');
    const b = mockServer.getTool('find_duplicate_candidates');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const aSchema = a!.config.inputSchema as Record<string, unknown>;
    const bSchema = b!.config.inputSchema as Record<string, unknown>;
    // Same param keys (id, threshold, limit, visibility_filter).
    expect(Object.keys(aSchema).sort()).toEqual(Object.keys(bSchema).sort());
  });
});

describe('find_similar_items handler', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.singleMock.mockResolvedValue({ data: makeSourceItem(), error: null });
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = createMockMcpServer();
    const { registerTools } = await import('@/lib/mcp/tools');
    await registerTools(
      mockServer as unknown as Parameters<typeof registerTools>[0],
    );
  });

  it('omits visibility_filter from RPC call when arg not provided (preserves RPC default of "default")', async () => {
    const handler = mockServer.getHandler('find_similar_items')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ id: SOURCE_ID }, extra);

    const callArgs = mocks.rpcMock.mock.calls[0];
    expect(callArgs[0]).toBe('hybrid_search');
    const rpcParams = callArgs[1] as Record<string, unknown>;
    expect(rpcParams).toHaveProperty('visibility_filter');
    expect(rpcParams.visibility_filter).toBeUndefined();
    expect(rpcParams.visibility_filter).not.toBeNull();
  });

  it('passes explicit visibility_filter override through to the RPC', async () => {
    const handler = mockServer.getHandler('find_similar_items')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ id: SOURCE_ID, visibility_filter: 'all' }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({ visibility_filter: 'all' }),
    );
  });

  it('returns isError with guidance text when source item has no embedding', async () => {
    const handler = mockServer.getHandler('find_similar_items')!;
    mocks.singleMock.mockResolvedValueOnce({
      data: makeSourceItem({ embedding: null }),
      error: null,
    });

    const result = (await handler({ id: SOURCE_ID }, extra)) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No embedding found');
    expect(result.content[0].text).toContain(SOURCE_ID);
  });

  it('returns markdown + structuredContent for a successful similarity search', async () => {
    const handler = mockServer.getHandler('find_similar_items')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        makeRpcSimilarRow({
          id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          similarity: 0.97,
        }),
        makeRpcSimilarRow({
          id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          similarity: 0.82,
        }),
      ],
      error: null,
    });

    const result = (await handler({ id: SOURCE_ID }, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.structuredContent).toBeDefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.source_item as Record<string, unknown>).id).toBe(SOURCE_ID);
    const similarItems = sc.similar_items as Array<Record<string, unknown>>;
    expect(similarItems).toHaveLength(2);
    expect(similarItems[0].likely_duplicate).toBe(true); // similarity 0.97 > 0.95
    expect(similarItems[1].likely_duplicate).toBe(false); // similarity 0.82
  });
});

describe('find_duplicate_candidates handler', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.singleMock.mockResolvedValue({ data: makeSourceItem(), error: null });
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = createMockMcpServer();
    const { registerTools } = await import('@/lib/mcp/tools');
    await registerTools(
      mockServer as unknown as Parameters<typeof registerTools>[0],
    );
  });

  it('passes visibility_filter="admin" to the RPC when arg not provided', async () => {
    const handler = mockServer.getHandler('find_duplicate_candidates')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ id: SOURCE_ID }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({ visibility_filter: 'admin' }),
    );
  });

  it('passes explicit visibility_filter override through to the RPC (overrides admin default)', async () => {
    const handler = mockServer.getHandler('find_duplicate_candidates')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ id: SOURCE_ID, visibility_filter: 'default' }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({ visibility_filter: 'default' }),
    );
  });

  it('passes explicit visibility_filter="all" override through to the RPC', async () => {
    const handler = mockServer.getHandler('find_duplicate_candidates')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ id: SOURCE_ID, visibility_filter: 'all' }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({ visibility_filter: 'all' }),
    );
  });

  it('returns isError with guidance text when source item has no embedding', async () => {
    const handler = mockServer.getHandler('find_duplicate_candidates')!;
    mocks.singleMock.mockResolvedValueOnce({
      data: makeSourceItem({ embedding: null }),
      error: null,
    });

    const result = (await handler({ id: SOURCE_ID }, extra)) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No embedding found');
    expect(result.content[0].text).toContain(SOURCE_ID);
  });

  it('returns isError when the source item itself is not found', async () => {
    const handler = mockServer.getHandler('find_duplicate_candidates')!;
    mocks.singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows' },
    });

    const result = (await handler({ id: SOURCE_ID }, extra)) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Content item not found');
  });

  it('returns markdown + structuredContent for a successful similarity search', async () => {
    const handler = mockServer.getHandler('find_duplicate_candidates')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        makeRpcSimilarRow({
          id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          similarity: 0.99,
        }),
      ],
      error: null,
    });

    const result = (await handler({ id: SOURCE_ID }, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    const similarItems = sc.similar_items as Array<Record<string, unknown>>;
    expect(similarItems).toHaveLength(1);
    expect(similarItems[0].likely_duplicate).toBe(true);
  });
});
