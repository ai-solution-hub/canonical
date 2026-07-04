import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// ID-71.7 — LLM semantic-discovery (published-only similar items) is now the
// `similar_to` branch of the consolidated `find` tool (M27/B-INV-27). The
// standalone `find_similar_items` entry is retired.
//
// ID-71.10 PART 2 (M32 / B-INV-32 dedup portion) — the admin-dedup surface
// `find_duplicate_candidates` is now the consolidated `find_duplicates` entry
// (it continues to share `findSimilarItemsImpl` with `find`'s similar_to
// branch). Its standalone registration is retired; the find_duplicates
// behaviour is asserted in `dedup-consolidation.test.ts`. (ID-131.15,
// G-DEDUP legacy dedup-family retirement, S446, later removed the sibling
// `scope: 'all'` batch-scan branch — find_duplicates is single-item-only now.)
//
// The tests below assert: (a) `find_similar_items` and the standalone
// `find_duplicate_candidates` are retired, the consolidated `find` /
// `find_duplicates` entries replace them, and (b) `find`'s `similar_to` branch
// (which shares `findSimilarItemsImpl`) still serves LLM discovery — i.e. the
// dedup consolidation did NOT break the shared engine.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hoisted mocks — supabase auth client + lazy-loaded embedding generator
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // ID-131.11 G-SEARCH (§9): findSimilarItemsImpl now reads the source
  // embedding from the polymorphic record_embeddings store —
  // `.from('record_embeddings').select('embedding').eq('owner_id', id)
  //   .eq('model', …).limit(1).maybeSingle()` — replacing the retired
  // content_items.embedding inline column. The chain methods below back that
  // read; tests override `maybeSingleMock` per case to swap in a source
  // embedding row with or without an `embedding`.
  const maybeSingleMock = vi.fn();
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: maybeSingleMock,
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
    maybeSingleMock,
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

// The source read now returns a record_embeddings row (SELECT embedding …),
// not a content_items row — so the fixture carries only the embedding column.
function makeSourceEmbeddingRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
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

describe('find / find_duplicates registration (ID-71.7 + ID-71.10)', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.maybeSingleMock.mockResolvedValue({
      data: makeSourceEmbeddingRow(),
      error: null,
    });
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

  it('retires the standalone find_duplicate_candidates entry (now find_duplicates, single-item-only since ID-131.15)', () => {
    expect(mockServer.getTool('find_duplicate_candidates')).toBeUndefined();
    expect(mockServer.getTool('find_duplicates')).toBeDefined();
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
    mocks.maybeSingleMock.mockResolvedValue({
      data: makeSourceEmbeddingRow(),
      error: null,
    });
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
    mocks.maybeSingleMock.mockResolvedValueOnce({
      data: makeSourceEmbeddingRow({ embedding: null }),
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
    // Source embedding is read from the polymorphic record_embeddings store.
    expect(mocks.mockSupabaseClient.from).toHaveBeenCalledWith(
      'record_embeddings',
    );
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.source_item as Record<string, unknown>).id).toBe(SOURCE_ID);
    const similarItems = sc.similar_items as Array<Record<string, unknown>>;
    expect(similarItems).toHaveLength(2);
    expect(similarItems[0].likely_duplicate).toBe(true); // similarity 0.97 > 0.95
    expect(similarItems[1].likely_duplicate).toBe(false); // similarity 0.82
  });
});
