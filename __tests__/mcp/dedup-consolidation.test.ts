import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// ID-71.10 PART 2 (M32 / B-INV-32 dedup portion + B-INV-37) — the two dedup
// tools collapse to ONE parameterised `find_duplicates` entry with a `scope`
// param:
//   - scope: 'item' (requires `id`) → single-item dedup, admin visibility
//     default. Replaces `find_duplicate_candidates` (was lib/mcp/tools/search.ts).
//     Shares `findSimilarItemsImpl` with the consolidated `find` tool's
//     `similar_to` branch — the shared engine MUST stay intact.
//   - scope: 'all' (default) → batch KB scan via the `find_duplicate_pairs`
//     RPC. Replaces `find_all_duplicates` (was lib/mcp/tools/quality.ts).
//
// The new entry declares an `outputSchema` (B-INV-37 — new entries only). The
// retired single+batch pair MUST NOT persist as two entries (B-INV-32 Fail
// condition).
//
// The tests assert behaviour-first per test-philosophy.md: registration shape,
// scope-branch RPC selection (hybrid_search vs find_duplicate_pairs), the
// admin visibility default on the item branch, and the preserved error guards.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
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
    checkMcpRole: vi.fn().mockResolvedValue('admin'),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: vi.fn().mockResolvedValue('admin'),
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

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

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

function makeRpcPairRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id1: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title1: 'Item A',
    type1: 'note',
    domain1: 'compliance',
    id2: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    title2: 'Item B',
    type2: 'note',
    domain2: 'compliance',
    similarity: 0.97,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Registration — B-INV-32 consolidation + B-INV-37 outputSchema
// ---------------------------------------------------------------------------

describe('find_duplicates registration (ID-71.10 dedup consolidation)', () => {
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

  it('collapses the two dedup tools into ONE parameterised find_duplicates entry (B-INV-32)', () => {
    // Pass: one consolidated entry. Fail: a single+batch pair persists.
    expect(mockServer.getTool('find_duplicates')).toBeDefined();
    expect(mockServer.getTool('find_duplicate_candidates')).toBeUndefined();
    expect(mockServer.getTool('find_all_duplicates')).toBeUndefined();
  });

  it('omits outputSchema because FindDuplicatesResponseSchema is a z.union — the MCP SDK normalizeObjectSchema returns undefined for unions causing undefined._zod crash in validateToolOutput (SDK union gap, B-INV-37 deferred)', () => {
    const tool = mockServer.getTool('find_duplicates');
    // outputSchema intentionally absent until SDK gains union support.
    expect(tool!.config.outputSchema).toBeUndefined();
  });

  it('exposes a scope parameter covering item and all dedup branches', () => {
    const tool = mockServer.getTool('find_duplicates');
    const input = tool!.config.inputSchema as Record<string, unknown>;
    expect(input).toHaveProperty('scope');
  });

  it('keeps read-only annotations on the consolidated entry', () => {
    const tool = mockServer.getTool('find_duplicates');
    const annotations = tool!.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(false);
  });

  it('keeps the consolidated find tool (similar_to branch) intact', () => {
    expect(mockServer.getTool('find')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// scope: 'item' branch — single-item admin dedup (was find_duplicate_candidates)
// ---------------------------------------------------------------------------

describe('find_duplicates handler — scope: item (single-item dedup)', () => {
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

  it('routes scope=item to hybrid_search with admin visibility default', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    await handler({ scope: 'item', id: SOURCE_ID }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({ visibility_filter: 'admin' }),
    );
  });

  it('passes an explicit visibility_filter override through to the RPC', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    await handler(
      { scope: 'item', id: SOURCE_ID, visibility_filter: 'default' },
      extra,
    );

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({ visibility_filter: 'default' }),
    );
  });

  it('returns isError when scope=item is missing the id', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    const result = (await handler({ scope: 'item' }, extra)) as ToolResult;
    expect(result.isError).toBe(true);
  });

  it('returns isError with guidance text when source item has no embedding', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    mocks.singleMock.mockResolvedValueOnce({
      data: makeSourceItem({ embedding: null }),
      error: null,
    });

    const result = (await handler(
      { scope: 'item', id: SOURCE_ID },
      extra,
    )) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No embedding found');
  });

  it('returns markdown + structuredContent flagging likely duplicates', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [makeRpcSimilarRow({ similarity: 0.99 })],
      error: null,
    });

    const result = (await handler(
      { scope: 'item', id: SOURCE_ID },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    const items = sc.similar_items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].likely_duplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scope: 'all' branch — batch KB scan (was find_all_duplicates)
// ---------------------------------------------------------------------------

describe('find_duplicates handler — scope: all (batch KB scan)', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = createMockMcpServer();
    const { registerSearchTools } = await import('@/lib/mcp/tools/search');
    await registerSearchTools(
      mockServer.server as unknown as Parameters<typeof registerSearchTools>[0],
    );
  });

  it('defaults to the all-scope batch scan via find_duplicate_pairs', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    await handler({}, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'find_duplicate_pairs',
      expect.objectContaining({ similarity_threshold: 0.95, limit_count: 50 }),
    );
  });

  it('passes domain filter and threshold through to find_duplicate_pairs', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    await handler(
      { scope: 'all', domain: 'compliance', threshold: 0.9, limit: 25 },
      extra,
    );

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'find_duplicate_pairs',
      expect.objectContaining({
        similarity_threshold: 0.9,
        p_domain: 'compliance',
        limit_count: 25,
      }),
    );
  });

  it('returns markdown + structuredContent of duplicate pairs', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [makeRpcPairRow({ similarity: 0.98 })],
      error: null,
    });

    const result = (await handler({ scope: 'all' }, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.count).toBe(1);
    const pairs = sc.pairs as Array<Record<string, unknown>>;
    expect(pairs).toHaveLength(1);
    expect((pairs[0].item_a as Record<string, unknown>).id).toBe(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
  });

  it('surfaces a batch-scan RPC error as isError', async () => {
    const handler = mockServer.getHandler('find_duplicates')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'scan boom' },
    });

    const result = (await handler({ scope: 'all' }, extra)) as ToolResult;
    expect(result.isError).toBe(true);
  });
});
