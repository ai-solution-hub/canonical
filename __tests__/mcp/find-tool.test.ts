import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// ID-71.7 (B-INV-27 / B-INV-33 / M27 / M33 / M37) — ONE parameterised `find`
// tool collapses the prior search trio (`search_knowledge_base`,
// `search_qa_library`, `search_content_chunks`) + `find_similar_items` into a
// single outcome-shaped entry.
//
//   - `type` / `scope` preserve the q_a_pairs + scope_tag (domain) corpus
//     semantics of the trio.
//   - `granularity` ('item' | 'chunk') preserves whole-item vs section-level
//     retrieval (the `search_content_chunks` branch).
//   - `similar_to` preserves the `find_similar_items` vector-discovery branch.
//   - Two-step list/preview → verbatim-on-accept retrieval is preserved
//     (B-INV-33): `find` returns metadata/previews only; verbatim fetch is the
//     caller's follow-up `get_content_item` step.
//   - The new entry declares an `outputSchema` (M37 forward standard).
//
// The retired trio + `find_similar_items` MUST NOT be registered any longer.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // `.from('content_items').select(...).eq(...).single()` backs the
  // similar-to source-item lookup (mirrors find-similar-items.test.ts).
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

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// v4-compliant UUID (Zod `.uuid()` enforces RFC 4122 — CLAUDE.md gotcha).
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

function makeSearchRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
    title: 'Knowledge Item',
    suggested_title: null,
    content_type: 'article',
    primary_domain: 'security',
    primary_subtopic: 'access-control',
    summary: 'A short summary.',
    similarity: 0.87,
    ...overrides,
  };
}

function makeChunkRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    chunk_id: 'cccccccc-1111-4222-8333-444444444444',
    content_item_id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
    item_title: 'Health and Safety Policy',
    item_suggested_title: null,
    item_content_type: 'policy',
    item_primary_domain: 'compliance',
    item_primary_subtopic: null,
    heading_text: 'Risk Assessment',
    heading_level: 2,
    heading_path: ['Policy', 'Risk Assessment'],
    content: 'The risk assessment section content.',
    position: 3,
    char_count: 42,
    word_count: 7,
    similarity: 0.81,
    ...overrides,
  };
}

async function buildServer() {
  const mockServer = createMockMcpServer();
  const { registerSearchTools } = await import('@/lib/mcp/tools/search');
  await registerSearchTools(
    mockServer.server as unknown as Parameters<typeof registerSearchTools>[0],
  );
  return mockServer;
}

// ---------------------------------------------------------------------------
// Consolidation — the trio + find_similar_items collapse into one `find`
// ---------------------------------------------------------------------------

describe('find tool — consolidation (B-INV-27)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.singleMock.mockResolvedValue({ data: makeSourceItem(), error: null });
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = await buildServer();
  });

  it('registers a single `find` entry with read-only annotations', () => {
    const tool = mockServer.getTool('find');
    expect(tool).toBeDefined();
    const annotations = tool!.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(false);
  });

  it('no longer registers the retired search trio or find_similar_items', () => {
    expect(mockServer.getTool('search_knowledge_base')).toBeUndefined();
    expect(mockServer.getTool('search_qa_library')).toBeUndefined();
    expect(mockServer.getTool('search_content_chunks')).toBeUndefined();
    expect(mockServer.getTool('find_similar_items')).toBeUndefined();
  });

  it('exposes type / scope / granularity params that preserve the trio semantics', () => {
    const tool = mockServer.getTool('find');
    const schema = tool!.config.inputSchema as Record<string, unknown>;
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining(['type', 'scope', 'granularity']),
    );
  });

  it('omits outputSchema because FindResponseSchema is a z.union — the MCP SDK normalizeObjectSchema returns undefined for unions causing undefined._zod crash in validateToolOutput (SDK union gap, M37 deferred)', () => {
    const tool = mockServer.getTool('find');
    // outputSchema intentionally absent until SDK gains union support.
    expect(tool!.config.outputSchema).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item granularity — whole-item search (search_knowledge_base branch)
// ---------------------------------------------------------------------------

describe('find tool — item granularity (whole-item search)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = await buildServer();
  });

  it('runs hybrid_search and returns list/preview metadata (not verbatim) — B-INV-33', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [makeSearchRow({ similarity: 0.9 })],
      error: null,
    });

    const result = (await handler({ query: 'ISO 27001' }, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(mocks.rpcMock.mock.calls[0][0]).toBe('hybrid_search');
    const sc = result.structuredContent as Record<string, unknown>;
    const results = sc.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    // Preview fields present; no verbatim `content`/`body` field at item level.
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('summary');
    expect(results[0]).not.toHaveProperty('content');
    expect(results[0]).not.toHaveProperty('body');
  });

  it('filters by scope (domain corpus semantics from search_knowledge_base)', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        makeSearchRow({
          id: 'aaaaaaaa-1111-4222-8333-444444444444',
          primary_domain: 'security',
        }),
        makeSearchRow({
          id: 'bbbbbbbb-1111-4222-8333-444444444444',
          primary_domain: 'compliance',
        }),
      ],
      error: null,
    });

    const result = (await handler(
      { query: 'ISO 27001', scope: 'security' },
      extra,
    )) as ToolResult;

    const sc = result.structuredContent as Record<string, unknown>;
    const results = sc.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].primary_domain).toBe('security');
  });

  it('omits visibility_filter from the RPC payload when not supplied', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler({ query: 'test' }, extra);

    const rpcParams = mocks.rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcParams).toHaveProperty('visibility_filter');
    expect(rpcParams.visibility_filter).toBeUndefined();
    expect(rpcParams.visibility_filter).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// type=q_a_pair — preserves search_qa_library semantics
// ---------------------------------------------------------------------------

describe('find tool — type=q_a_pair (Q&A library semantics)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildServer();
  });

  it('returns only q_a_pair results when type=q_a_pair', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        makeSearchRow({
          id: 'aaaaaaaa-1111-4222-8333-444444444444',
          content_type: 'q_a_pair',
        }),
        makeSearchRow({
          id: 'bbbbbbbb-1111-4222-8333-444444444444',
          content_type: 'article',
        }),
      ],
      error: null,
    });

    const result = (await handler(
      { query: 'SLA response times', type: 'q_a_pair' },
      extra,
    )) as ToolResult;

    const sc = result.structuredContent as Record<string, unknown>;
    const results = sc.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].content_type).toBe('q_a_pair');
  });
});

// ---------------------------------------------------------------------------
// granularity=chunk — preserves search_content_chunks semantics
// ---------------------------------------------------------------------------

describe('find tool — granularity=chunk (section-level retrieval)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildServer();
  });

  it('calls the search_content_chunks RPC and returns chunk previews', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [makeChunkRow()],
      error: null,
    });

    const result = (await handler(
      { query: 'risk assessment', granularity: 'chunk' },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(mocks.rpcMock.mock.calls[0][0]).toBe('search_content_chunks');
    const sc = result.structuredContent as Record<string, unknown>;
    const results = sc.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('chunk_id');
    expect(results[0]).toHaveProperty('heading_path');
  });

  it('passes review-cadence + content_item_id chunk filters through to the RPC', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await handler(
      {
        query: 'risk',
        granularity: 'chunk',
        content_item_id: SOURCE_ID,
        overdue_review: true,
        review_due_within_days: 30,
      },
      extra,
    );

    const rpcParams = mocks.rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcParams.filter_content_item_id).toBe(SOURCE_ID);
    expect(rpcParams.filter_overdue_review).toBe(true);
    expect(rpcParams.filter_review_due_within_days).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// similar_to — preserves find_similar_items vector-discovery branch
// ---------------------------------------------------------------------------

describe('find tool — similar_to (vector discovery)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.singleMock.mockResolvedValue({ data: makeSourceItem(), error: null });
    mocks.rpcMock.mockResolvedValue({ data: [], error: null });
    mockServer = await buildServer();
  });

  it('fetches the source item embedding and returns similar items with likely_duplicate flag', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        makeSearchRow({
          id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          similarity: 0.97,
        }),
        makeSearchRow({
          id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          similarity: 0.82,
        }),
      ],
      error: null,
    });

    const result = (await handler(
      { similar_to: SOURCE_ID },
      extra,
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    const similar = sc.similar_items as Array<Record<string, unknown>>;
    expect(similar).toHaveLength(2);
    expect(similar[0].likely_duplicate).toBe(true); // 0.97 > 0.95
    expect(similar[1].likely_duplicate).toBe(false); // 0.82
  });

  it('returns isError with guidance when the source item has no embedding', async () => {
    const handler = mockServer.getHandler('find')!;
    mocks.singleMock.mockResolvedValueOnce({
      data: makeSourceItem({ embedding: null }),
      error: null,
    });

    const result = (await handler(
      { similar_to: SOURCE_ID },
      extra,
    )) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No embedding found');
  });
});
