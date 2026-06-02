import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Hoisted mocks — supabase client, lazy-loaded AI modules
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

  const createServiceClientMock = vi.fn().mockReturnValue(mockSupabaseClient);

  return {
    mockSupabaseClient,
    chainMethods,
    rpcMock,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi
      .fn()
      .mockReturnValue('00000000-0000-4000-8000-000000000001'),
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
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };
});
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClientMock,
}));
vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: vi.fn(),
}));

// Import after mocks
import { registerContentTools } from '@/lib/mcp/tools/content';

// ---------------------------------------------------------------------------
// Mock McpServer
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let mockServer: ReturnType<typeof createMockMcpServer>;
const extra = { authInfo: { token: 'test' } };

async function setupServer() {
  mockServer = createMockMcpServer();
  await registerContentTools(
    mockServer.server as unknown as Parameters<typeof registerContentTools>[0],
  );
}

function resetSupabaseMocks() {
  mocks.createMcpClient.mockReset().mockReturnValue(mocks.mockSupabaseClient);
  mocks.getMcpUserId
    .mockReset()
    .mockReturnValue('00000000-0000-4000-8000-000000000001');
  mocks.createServiceClientMock
    .mockReset()
    .mockReturnValue(mocks.mockSupabaseClient);
  mocks.rpcMock.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.mockSupabaseClient.from.mockReset().mockReturnValue(mocks.chainMethods);

  for (const key of [
    'select',
    'order',
    'limit',
    'eq',
    'is',
    'single',
    'update',
    'delete',
    'insert',
  ] as const) {
    mocks.chainMethods[key].mockReset().mockReturnValue(mocks.chainMethods);
  }
  mocks.chainMethods.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );
}

beforeAll(async () => {
  await setupServer();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetSupabaseMocks();
});

// ---------------------------------------------------------------------------
// get_content_item: chunks fetch
// ---------------------------------------------------------------------------

describe('get_content_item chunks fetch', () => {
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

  // ID-56.10: cocoindex-emitted chunks ({56.8}) carry NULL heading_text +
  // NULL heading_level (heading_path is [] — base column NOT NULL default
  // '{}'). Migration 2 ({56.7}) was DDL-unachievable so these surface as
  // runtime nulls despite the non-null DB type. The content tool's cast +
  // formatter guards must render such a row as "(preamble)" without
  // throwing and still expose it in structuredContent.
  it('renders a cocoindex-emitted chunk (null heading_text + null heading_level) as "(preamble)" without throwing', async () => {
    const handler = mockServer.getHandler('get_content_item')!;

    const itemRow = {
      id: 'item-cc',
      title: 'CocoIndex Ingested Doc',
      suggested_title: 'CocoIndex Ingested Doc',
      content_type: 'article',
      primary_domain: null,
      primary_subtopic: null,
      summary: null,
      ai_keywords: null,
      freshness: null,
      classification_confidence: null,
      source_url: null,
      content: 'Body emitted by the cocoindex pipeline.',
      created_at: null,
      updated_at: null,
      governance_review_status: null,
      priority: null,
    };

    // cocoindex chunk: NULL heading_text + NULL heading_level, heading_path []
    const chunkRows = [
      {
        id: 'chunk-coco',
        heading_text: null,
        heading_level: null,
        heading_path: [],
        position: 1,
        char_count: 120,
        word_count: 22,
      },
    ];

    // 1. content_items.select...single() — the item
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: itemRow, error: null }),
    );
    // 2. content_chunks.select...order() — the cocoindex chunk
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: chunkRows, error: null }),
    );

    const result = (await handler(
      { id: '11111111-2222-4333-8444-777777777777' },
      extra,
    )) as ToolResult;

    // Did not throw; rendered the preamble fallback.
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('## Document Sections');
    expect(result.content[0].text).toContain('(preamble)');

    // Null headings survive into structuredContent (heading_path coerced []).
    const chunks = result.structuredContent!.chunks as Array<
      Record<string, unknown>
    >;
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading_text).toBeNull();
    expect(chunks[0].heading_level).toBeNull();
    expect(chunks[0].heading_path).toEqual([]);
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

// create_content_item chunking describe block removed (ID-56.11): the
// app-side regenerateChunks path is retired — cocoindex is the sole
// content_chunks writer and re-ingests the corpus natively. The
// get_content_item read path above still exercises chunk rendering against
// cocoindex-emitted rows.
