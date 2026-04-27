/**
 * MCP `create_content_item` dedup soft-block + admin override
 * (WP1 / spec §6 D1, D2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const createChain = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );
    return chain;
  };

  const chain = createChain();

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    _chain: chain,
  };

  return {
    mockSupabaseClient,
    chain,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi
      .fn()
      .mockReturnValue('a0000000-0000-4000-8000-000000000001'),
    checkMcpRole: vi.fn(),
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
    classifyContent: vi.fn().mockResolvedValue(undefined),
    generateSummary: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/mcp/tools/shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp/tools/shared')>(
    '@/lib/mcp/tools/shared',
  );
  return {
    ...actual,
    getGenerateEmbedding: vi.fn().mockResolvedValue(mocks.generateEmbedding),
    getClassifyContent: vi.fn().mockResolvedValue(mocks.classifyContent),
    getGenerateSummary: vi.fn().mockResolvedValue(mocks.generateSummary),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mocks.mockSupabaseClient),
}));

vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: vi.fn().mockResolvedValue({ errors: [] }),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn().mockReturnValue({
    suggestedLayer: 'capability',
    reason: '',
    confidence: 'high',
  }),
}));

vi.mock('@/lib/guide-section-mapping', () => ({
  suggestGuideSections: vi.fn().mockResolvedValue([]),
}));

// Import after mocks
import { registerContentTools } from '@/lib/mcp/tools/content';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface RegisteredTool {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, extra: any) => Promise<any>;
}

function createTestServer(): {
  server: McpServer;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: RegisteredTool['handler']) => {
        tools.set(name, { name, handler });
        return { enabled: true };
      },
    ),
  } as unknown as McpServer;
  return { server, tools };
}

const MOCK_AUTH_INFO = {
  token: 'test-token',
  clientId: 'test-client',
  scopes: ['read', 'write'],
  extra: {
    userId: 'a0000000-0000-4000-8000-000000000001',
    role: 'editor',
  },
};

const EXISTING_ID = 'd4e5f6a7-b8c9-4012-8def-345678901234';
const NEW_ITEM_ID = 'a1b2c3d4-e5f6-4789-8abc-def012345678';

const LONG_CONTENT =
  'This is sufficiently long markdown content that exceeds the 50-character minimum for dedup hash checks. It describes our organisation capability.';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP create_content_item — dedup soft-block', () => {
  let createTool: RegisteredTool['handler'];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-register default implementations cleared by clearAllMocks
    mocks.mockSupabaseClient.from.mockReturnValue(mocks.chain);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: [], error: null });
    mocks.chain.select.mockReturnValue(mocks.chain);
    mocks.chain.insert.mockReturnValue(mocks.chain);
    mocks.chain.update.mockReturnValue(mocks.chain);
    mocks.chain.eq.mockReturnValue(mocks.chain);

    const { server, tools } = createTestServer();
    await registerContentTools(server);
    const tool = tools.get('create_content_item');
    if (!tool) throw new Error('create_content_item not registered');
    createTool = tool.handler;

    // Default: editor role
    mocks.checkMcpRole.mockResolvedValue('editor');

    // Default insert returns the new item
    mocks.chain.single.mockResolvedValue({
      data: {
        id: NEW_ITEM_ID,
        title: 'New Item',
        content_type: 'capability',
      },
      error: null,
    });
  });

  it('stamps dedup_status=suspected_duplicate on exact hash match', async () => {
    // Mock find_exact_duplicates returning a match
    mocks.mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [{ id: EXISTING_ID, title: 'Existing Item' }],
      error: null,
    });

    const result = await createTool(
      {
        title: 'New Item',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();

    const insertCall = mocks.chain.insert.mock.calls[0][0];
    expect(insertCall.dedup_status).toBe('suspected_duplicate');
    expect(insertCall.metadata.suspected_duplicate_of).toBe(EXISTING_ID);

    // Markdown response mentions the flag
    expect(result.content[0].text).toContain('Dedup');
    expect(result.content[0].text).toContain('suspected_duplicate');

    // Structured content mirrors the stamp
    expect(result.structuredContent.dedup_status).toBe('suspected_duplicate');
    expect(result.structuredContent.suspected_duplicate_of).toBe(EXISTING_ID);
  });

  it('stamps dedup_status=clean when no match', async () => {
    // Default rpc already returns empty data
    const result = await createTool(
      {
        title: 'Unique Item',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();

    const insertCall = mocks.chain.insert.mock.calls[0][0];
    expect(insertCall.dedup_status).toBe('clean');
    expect(insertCall.metadata?.suspected_duplicate_of).toBeUndefined();

    expect(result.structuredContent.dedup_status).toBe('clean');
    expect(result.structuredContent.suspected_duplicate_of).toBeNull();
  });

  it('admin skip_dedup=true bypasses the stamp even on exact match', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [{ id: EXISTING_ID, title: 'Existing Item' }],
      error: null,
    });

    const result = await createTool(
      {
        title: 'Admin Override',
        content: LONG_CONTENT,
        content_type: 'capability',
        skip_dedup: true,
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();
    const insertCall = mocks.chain.insert.mock.calls[0][0];
    expect(insertCall.dedup_status).toBe('clean');
    expect(result.structuredContent.dedup_status).toBe('clean');
  });

  it('non-admin skip_dedup=true is silently ignored — stamp applied', async () => {
    // Role remains 'editor' per beforeEach default
    mocks.mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [{ id: EXISTING_ID, title: 'Existing Item' }],
      error: null,
    });

    const result = await createTool(
      {
        title: 'Editor Cannot Override',
        content: LONG_CONTENT,
        content_type: 'capability',
        skip_dedup: true,
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    // No 403 — silent-ignore per spec §6 D2
    expect(result.isError).toBeFalsy();
    const insertCall = mocks.chain.insert.mock.calls[0][0];
    expect(insertCall.dedup_status).toBe('suspected_duplicate');
    expect(insertCall.metadata.suspected_duplicate_of).toBe(EXISTING_ID);
  });
});
