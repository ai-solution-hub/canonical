import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — supabase client, lazy-loaded AI + chunk-store modules
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    ),
  };

  const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(chainMethods),
    rpc: rpcMock,
    _chain: chainMethods,
  };

  const regenerateChunksMock = vi.fn().mockResolvedValue({ errors: [] });
  const createServiceClientMock = vi.fn().mockReturnValue(mockSupabaseClient);

  return {
    mockSupabaseClient,
    chainMethods,
    rpcMock,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi
      .fn()
      .mockReturnValue('00000000-0000-4000-8000-000000000001'),
    regenerateChunksMock,
    createServiceClientMock,
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: vi.fn().mockResolvedValue('editor'),
}));

// Lazy-loaded modules
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  MAX_EMBEDDING_CHARS: 24_000,
  getEmbeddingModel: vi.fn().mockReturnValue('text-embedding-3-large'),
  getEmbeddingDimensions: vi.fn().mockReturnValue(1024),
}));
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: mocks.regenerateChunksMock,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClientMock,
}));

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
// Shared setup
// ---------------------------------------------------------------------------

let mockServer: ReturnType<typeof createMockMcpServer>;
const extra = { authInfo: { token: 'test' } };

async function setupServer() {
  mockServer = createMockMcpServer();
  const { registerContentTools } = await import('@/lib/mcp/tools/content');
  await registerContentTools(
    mockServer as unknown as Parameters<typeof registerContentTools>[0],
  );
}

// ---------------------------------------------------------------------------
// get_content_item: chunks fetch
// ---------------------------------------------------------------------------

describe('get_content_item chunks fetch', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupServer();
  });

  it('returns Document Sections markdown and chunks array when chunks are present', async () => {
    const handler = mockServer.getHandler('get_content_item')!;

    const itemRow = {
      id: 'item-123',
      title: 'Fire Safety Policy',
      suggested_title: 'Fire Safety Policy',
      content_type: 'policy',
      primary_domain: 'Compliance & Governance',
      primary_subtopic: 'Workplace Safety',
      summary: 'Summary text.',
      ai_keywords: ['fire', 'safety'],
      freshness: 'fresh',
      classification_confidence: 0.9,
      source_url: null,
      content: 'Full markdown content.',
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z',
      governance_review_status: null,
      priority: 'high',
    };

    const chunkRows = [
      {
        id: 'chunk-a',
        heading_text: 'Scope',
        heading_level: 2,
        heading_path: ['Scope'],
        position: 1,
        char_count: 80,
        word_count: 14,
      },
      {
        id: 'chunk-b',
        heading_text: 'Procedures',
        heading_level: 2,
        heading_path: ['Procedures'],
        position: 2,
        char_count: 120,
        word_count: 20,
      },
      {
        id: 'chunk-c',
        heading_text: 'Review',
        heading_level: 2,
        heading_path: ['Review'],
        position: 3,
        char_count: 60,
        word_count: 10,
      },
    ];

    // 1. content_items.select...single() — the item
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: itemRow, error: null }),
    );
    // 2. content_chunks.select...order() — the chunks
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: chunkRows, error: null }),
    );

    const result = (await handler(
      { id: '11111111-2222-4333-8444-555555555555' },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('## Document Sections');
    expect(result.content[0].text).toContain('Scope');
    expect(result.content[0].text).toContain('Procedures');
    expect(result.content[0].text).toContain('Review');

    expect(result.structuredContent).toBeDefined();
    const chunks = result.structuredContent!.chunks as Array<
      Record<string, unknown>
    >;
    expect(chunks).toHaveLength(3);
    expect(chunks[0].id).toBe('chunk-a');
    expect(chunks[2].heading_text).toBe('Review');
  });

  it('returns the item with an empty chunks array when chunk fetch fails (non-fatal)', async () => {
    const handler = mockServer.getHandler('get_content_item')!;

    const itemRow = {
      id: 'item-456',
      title: 'Standalone Item',
      suggested_title: null,
      content_type: 'article',
      primary_domain: null,
      primary_subtopic: null,
      summary: null,
      ai_keywords: null,
      freshness: null,
      classification_confidence: null,
      source_url: null,
      content: 'Body text.',
      created_at: null,
      updated_at: null,
      governance_review_status: null,
      priority: null,
    };

    // 1. content_items.select...single() — success
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: itemRow, error: null }),
    );
    // 2. content_chunks.select...order() — degraded
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'chunks table unavailable', code: 'X' },
        }),
    );

    const result = (await handler(
      { id: '11111111-2222-4333-8444-666666666666' },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    // Item detail still renders
    expect(result.content[0].text).toContain('# Standalone Item');
    // No Document Sections section when chunks are empty
    expect(result.content[0].text).not.toContain('## Document Sections');

    const structuredChunks = result.structuredContent!.chunks as unknown[];
    expect(Array.isArray(structuredChunks)).toBe(true);
    expect(structuredChunks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// create_content_item: chunks generation
// ---------------------------------------------------------------------------

describe('create_content_item chunking', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.regenerateChunksMock.mockResolvedValue({ errors: [] });
    await setupServer();
  });

  it('calls regenerateChunks for non-draft items with the new id and content', async () => {
    const handler = mockServer.getHandler('create_content_item')!;

    // 1. insert.select.single() — created item row
    mocks.chainMethods.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: {
            id: 'new-item-1',
            title: 'New Article',
            content_type: 'article',
          },
          error: null,
        }),
    );

    const result = (await handler(
      {
        title: 'New Article',
        content: '# New Article\n\nBody content in markdown.',
        content_type: 'article',
      },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(mocks.regenerateChunksMock).toHaveBeenCalledTimes(1);
    const [serviceClient, itemId, content] =
      mocks.regenerateChunksMock.mock.calls[0];
    expect(serviceClient).toBe(mocks.mockSupabaseClient);
    expect(itemId).toBe('new-item-1');
    expect(content).toBe('# New Article\n\nBody content in markdown.');
  });

  it('does NOT call regenerateChunks for draft items', async () => {
    const handler = mockServer.getHandler('create_content_item')!;

    mocks.chainMethods.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: {
            id: 'new-draft-1',
            title: 'Draft Item',
            content_type: 'note',
          },
          error: null,
        }),
    );

    const result = (await handler(
      {
        title: 'Draft Item',
        content: '# Draft\n\nNot yet ready.',
        content_type: 'note',
        governance_review_status: 'draft',
      },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(mocks.regenerateChunksMock).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Draft');
  });

  it('returns success with a "Content chunking failed" warning when regenerateChunks throws', async () => {
    const handler = mockServer.getHandler('create_content_item')!;

    mocks.chainMethods.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: {
            id: 'new-item-2',
            title: 'Article With Chunk Failure',
            content_type: 'article',
          },
          error: null,
        }),
    );
    mocks.regenerateChunksMock.mockRejectedValueOnce(
      new Error('chunk store explosion'),
    );

    const result = (await handler(
      {
        title: 'Article With Chunk Failure',
        content: '# Content\n\nMarkdown body.',
        content_type: 'article',
      },
      extra,
    )) as ToolResult;

    // Item was still created — not an error response
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('# Content Item Created');

    // Warnings appear in both markdown and structuredContent
    expect(result.content[0].text).toContain('Content chunking failed');
    const warnings = result.structuredContent!.warnings as string[];
    expect(warnings).toEqual(
      expect.arrayContaining(['Content chunking failed']),
    );
  });
});
