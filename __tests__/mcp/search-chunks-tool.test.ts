import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — supabase auth client + lazy-loaded embedding generator
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    ),
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
// Mock McpServer
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

function createMockMcpServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    tools,
    registerTool(
      name: string,
      config: Record<string, unknown>,
      handler: ToolHandler,
    ) {
      tools[name] = { handler };
    },
    getHandler(name: string): ToolHandler | undefined {
      return tools[name]?.handler;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRpcChunk(overrides: Record<string, unknown> = {}) {
  return {
    chunk_id: 'chunk-001',
    content_item_id: 'item-001',
    item_title: 'Fire Safety Policy',
    item_suggested_title: null,
    item_content_type: 'policy',
    item_primary_domain: 'Compliance & Governance',
    item_primary_subtopic: 'Workplace Safety',
    heading_text: 'Evacuation Procedures',
    heading_level: 2,
    heading_path: ['Fire Safety Policy', 'Evacuation Procedures'],
    content:
      'In the event of fire, staff must follow the nearest marked route.',
    position: 2,
    char_count: 65,
    word_count: 12,
    similarity: 0.78,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search_content_chunks tool handler', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.generateEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
    mockServer = createMockMcpServer();
    const { registerTools } = await import('@/lib/mcp/tools');
    await registerTools(
      mockServer as unknown as Parameters<typeof registerTools>[0],
    );
  });

  it('registers the search_content_chunks tool', () => {
    expect(mockServer.getHandler('search_content_chunks')).toBeDefined();
  });

  it('returns markdown and structuredContent for a successful search', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    const chunk1 = makeRpcChunk({
      chunk_id: 'c-1',
      heading_text: 'Evacuation Procedures',
    });
    const chunk2 = makeRpcChunk({
      chunk_id: 'c-2',
      heading_text: 'Fire Extinguisher Use',
    });
    mocks.rpcMock.mockResolvedValueOnce({
      data: [chunk1, chunk2],
      error: null,
    });

    const result = (await handler(
      { query: 'fire safety' },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Evacuation Procedures');
    expect(result.content[0].text).toContain('Fire Extinguisher Use');
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.count).toBe(2);
    expect(result.structuredContent!.query).toBe('fire safety');
  });

  it('returns isError when the RPC returns an error', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    });

    const result = (await handler({ query: 'anything' }, extra)) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
    expect(result.content[0].text.toLowerCase()).toContain(
      'chunk search failed',
    );
  });

  it('passes content_item_id through to the RPC filter_content_item_id param', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    const contentItemId = '11111111-2222-4333-8444-555555555555';
    await handler(
      { query: 'scoped query', content_item_id: contentItemId },
      extra,
    );

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'search_content_chunks',
      expect.objectContaining({
        filter_content_item_id: contentItemId,
      }),
    );
  });

  it('passes filter_content_item_id: undefined (NOT null) when omitted', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ query: 'broad query' }, extra);

    const callArgs = mocks.rpcMock.mock.calls[0];
    expect(callArgs[0]).toBe('search_content_chunks');
    const rpcParams = callArgs[1] as Record<string, unknown>;
    expect(rpcParams).toHaveProperty('filter_content_item_id');
    expect(rpcParams.filter_content_item_id).toBeUndefined();
    expect(rpcParams.filter_content_item_id).not.toBeNull();
  });

  it('clamps limit to 30 when a larger value is provided', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ query: 'q', limit: 100 }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'search_content_chunks',
      expect.objectContaining({ limit_count: 30 }),
    );
  });

  it('defaults limit to 10 when omitted', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ query: 'q' }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'search_content_chunks',
      expect.objectContaining({ limit_count: 10 }),
    );
  });

  it('uses the requested limit when below the 30 cap', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ query: 'q', limit: 5 }, extra);

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'search_content_chunks',
      expect.objectContaining({ limit_count: 5 }),
    );
  });

  it('serialises the embedding as a JSON string for the vector RPC param', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });
    mocks.generateEmbeddingMock.mockResolvedValueOnce([0.5, -0.1, 0.9]);

    await handler({ query: 'embedded' }, extra);

    const rpcParams = mocks.rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof rpcParams.query_embedding).toBe('string');
    expect(rpcParams.query_embedding).toBe(JSON.stringify([0.5, -0.1, 0.9]));
  });

  it('returns the empty-state markdown and count 0 when no chunks match', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    const result = (await handler(
      { query: 'nothing matches' },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No matching sections found');
    expect(result.structuredContent!.count).toBe(0);
  });

  it('treats null RPC data as empty results rather than an error', async () => {
    const handler = mockServer.getHandler('search_content_chunks')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: null, error: null });

    const result = (await handler({ query: 'any' }, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent!.count).toBe(0);
  });

  // ──────────────────────────────────────────
  // §5.5 Phase 4 — review-cadence filter params (S208 WP1)
  // Spec: docs/specs/p0-document-control-lifecycle-spec.md §8.2
  // AC1 (overdue_review=true), AC2 (review_due_within_days=30), AC7 (no break).
  // Note: row-filtering correctness (the actual SQL JOIN + WHERE conditions
  // in supabase/migrations/20260428212936_extend_search_content_chunks_review_filters.sql)
  // is exercised by MCP eval Layer 4 (bun run test:mcp-eval:fc). The handler-
  // pass-through assertions below verify the params reach the RPC call.
  // ──────────────────────────────────────────

  describe('§5.5 Phase 4 — review-cadence filter params', () => {
    it('passes overdue_review=true through to RPC filter_overdue_review (AC1)', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

      await handler({ query: 'q', overdue_review: true }, extra);

      expect(mocks.rpcMock).toHaveBeenCalledWith(
        'search_content_chunks',
        expect.objectContaining({ filter_overdue_review: true }),
      );
    });

    it('passes overdue_review=false through to RPC filter_overdue_review', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

      await handler({ query: 'q', overdue_review: false }, extra);

      expect(mocks.rpcMock).toHaveBeenCalledWith(
        'search_content_chunks',
        expect.objectContaining({ filter_overdue_review: false }),
      );
    });

    it('passes filter_overdue_review: undefined when omitted (AC7 backwards-compat)', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

      await handler({ query: 'q' }, extra);

      const rpcParams = mocks.rpcMock.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(rpcParams).toHaveProperty('filter_overdue_review');
      expect(rpcParams.filter_overdue_review).toBeUndefined();
      expect(rpcParams.filter_overdue_review).not.toBeNull();
    });

    it('passes review_due_within_days through to filter_review_due_within_days (AC2)', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

      await handler({ query: 'q', review_due_within_days: 30 }, extra);

      expect(mocks.rpcMock).toHaveBeenCalledWith(
        'search_content_chunks',
        expect.objectContaining({ filter_review_due_within_days: 30 }),
      );
    });

    it('passes filter_review_due_within_days: undefined when omitted', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

      await handler({ query: 'q' }, extra);

      const rpcParams = mocks.rpcMock.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(rpcParams).toHaveProperty('filter_review_due_within_days');
      expect(rpcParams.filter_review_due_within_days).toBeUndefined();
    });

    it('combines content_item_id, overdue_review, and review_due_within_days in one call', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });
      const contentItemId = '11111111-2222-4333-8444-555555555555';

      await handler(
        {
          query: 'fire safety',
          content_item_id: contentItemId,
          overdue_review: true,
          review_due_within_days: 14,
        },
        extra,
      );

      expect(mocks.rpcMock).toHaveBeenCalledWith(
        'search_content_chunks',
        expect.objectContaining({
          filter_content_item_id: contentItemId,
          filter_overdue_review: true,
          filter_review_due_within_days: 14,
        }),
      );
    });

    it('surfaces the filter values in structuredContent', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

      const result = (await handler(
        { query: 'q', overdue_review: true, review_due_within_days: 30 },
        extra,
      )) as ToolResult;

      expect(result.structuredContent?.overdue_review_filter).toBe(true);
      expect(result.structuredContent?.review_due_within_days_filter).toBe(30);
    });

    it('reports null for unset filters in structuredContent', async () => {
      const handler = mockServer.getHandler('search_content_chunks')!;
      mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

      const result = (await handler({ query: 'q' }, extra)) as ToolResult;

      expect(result.structuredContent?.overdue_review_filter).toBeNull();
      expect(result.structuredContent?.review_due_within_days_filter).toBeNull();
    });
  });
});
