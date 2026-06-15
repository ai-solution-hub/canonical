import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// ID-71.7 — LLM semantic-discovery (published-only similar items) is now the
// `similar_to` branch of the consolidated `find` tool (M27/B-INV-27). The
// standalone `find_similar_items` entry is retired. The admin-dedup surface
// `find_duplicate_candidates` is NOT consolidated here (dedup consolidation is
// the later M32 / {71.10} slice) and continues to share `findSimilarItemsImpl`
// with `find`'s similar_to branch.
//
// `find_duplicate_candidates`  → admin default returning every state.
//
// The tests below assert: (a) `find_similar_items` is retired and `find`'s
// `similar_to` branch serves LLM discovery, (b) RPC pass-through correctness
// for the surviving admin-dedup tool, and (c) the shared error-handling guard
// for items missing an embedding.
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

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: mocks.generateEmbeddingMock,
  };
});
vi.mock('@/lib/ai/classify', () => ({ classifyContent: vi.fn() }));
vi.mock('@/lib/ai/summarise', () => ({ generateSummary: vi.fn() }));

// ---------------------------------------------------------------------------
// Mock McpServer that captures both registration metadata and tool callbacks
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
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

describe('find / find_duplicate_candidates registration (ID-71.7)', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.singleMock.mockResolvedValue({ data: makeSourceItem(), error: null });
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = createMockMcpServer();
    const { registerSearchTools } = await import('@/lib/mcp/tools/search');
    await registerSearchTools(
      mockServer.server as unknown as Parameters<typeof registerSearchTools>[0],
    );
  });

  it('retires the standalone find_similar_items entry (now find.similar_to)', () => {
    expect(mockServer.getTool('find_similar_items')).toBeUndefined();
    expect(mockServer.getTool('find')).toBeDefined();
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

  it('find_duplicate_candidates description steers LLM-discovery callers to the find tool', () => {
    const tool = mockServer.getTool('find_duplicate_candidates');
    const description = tool!.config.description as string;
    expect(description).toContain('find');
    expect(description).toContain('similar_to');
  });
});

describe('find (similar_to) handler — LLM semantic discovery', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  /** Drives `find`'s similar_to branch (former find_similar_items). */
  function getSimilarHandler() {
    const findHandler = mockServer.getHandler('find')!;
    return (
      args: { id: string; visibility_filter?: 'default' | 'all' | 'admin' },
      e: typeof extra,
    ) => {
      const { id, ...rest } = args;
      return findHandler({ similar_to: id, ...rest }, e);
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.singleMock.mockResolvedValue({ data: makeSourceItem(), error: null });
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = createMockMcpServer();
    const { registerSearchTools } = await import('@/lib/mcp/tools/search');
    await registerSearchTools(
      mockServer.server as unknown as Parameters<typeof registerSearchTools>[0],
    );
  });

  it('omits visibility_filter from RPC call when arg not provided (preserves RPC default of "default")', async () => {
    const handler = getSimilarHandler();
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
    const handler = getSimilarHandler();
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ id: SOURCE_ID, visibility_filter: 'all' }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({ visibility_filter: 'all' }),
    );
  });

  it('returns isError with guidance text when source item has no embedding', async () => {
    const handler = getSimilarHandler();
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
    const handler = getSimilarHandler();
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
    const { registerSearchTools } = await import('@/lib/mcp/tools/search');
    await registerSearchTools(
      mockServer.server as unknown as Parameters<typeof registerSearchTools>[0],
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
