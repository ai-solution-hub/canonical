/**
 * MCP `create_content_item` dedup soft-block + admin override
 * (WP1 / spec §6 D1, D2).
 *
 * ID-71.16: the create-leg no longer writes a direct `content_items.insert`
 * (the canonical store materialises the row via the pipeline). The dedup
 * soft-block BEHAVIOUR is unchanged — exact-hash match stamps
 * `dedup_status='suspected_duplicate'` + the existing id — but it is now
 * observed on the tool's structured response + markdown (the behaviour-visible
 * surface) rather than on the removed insert payload. Source-less creates
 * route through stageAndWalk, so these assertions key off the response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockMcpServer,
  type MockToolHandler,
} from '@/__tests__/helpers/mcp-server';

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
    recordPipelineRun: vi.fn().mockResolvedValue(undefined),
    stageAndWalk: vi.fn().mockResolvedValue({
      destPath: 'agent-create/new-item.md',
      stageRequestId: 'req-123',
      sourceFile: 'new-item.md',
    }),
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
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mocks.mockSupabaseClient),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: mocks.recordPipelineRun,
}));

// Source-less creates stage the markdown content as a file.
vi.mock('@/lib/upload/folder-drop', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/upload/folder-drop')
  >('@/lib/upload/folder-drop');
  return {
    ...actual,
    stageAndWalk: mocks.stageAndWalk,
  };
});

// Import after mocks
import { registerContentTools } from '@/lib/mcp/tools/content';

// ---------------------------------------------------------------------------
// Harness — uses canonical createMockMcpServer helper
// ---------------------------------------------------------------------------

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

const LONG_CONTENT =
  'This is sufficiently long markdown content that exceeds the 50-character minimum for dedup hash checks. It describes our organisation capability.';

// ---------------------------------------------------------------------------
// Tests — dedup soft-block observed on the tool's response surface.
// ---------------------------------------------------------------------------

describe('MCP create_content_item — dedup soft-block', () => {
  let createTool: MockToolHandler;

  beforeEach(async () => {
    vi.clearAllMocks();

    mocks.mockSupabaseClient.from.mockReturnValue(mocks.chain);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: [], error: null });
    mocks.chain.select.mockReturnValue(mocks.chain);
    mocks.chain.insert.mockReturnValue(mocks.chain);
    mocks.chain.update.mockReturnValue(mocks.chain);
    mocks.chain.eq.mockReturnValue(mocks.chain);

    const mockServer = createMockMcpServer();
    await registerContentTools(mockServer.server);
    const tool = mockServer.getTool('create_content_item');
    if (!tool) throw new Error('create_content_item not registered');
    createTool = tool.handler;

    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.recordPipelineRun.mockResolvedValue(undefined);
    mocks.stageAndWalk.mockResolvedValue({
      destPath: 'agent-create/new-item.md',
      stageRequestId: 'req-123',
      sourceFile: 'new-item.md',
    });
  });

  it('stamps dedup_status=suspected_duplicate on exact hash match', async () => {
    // checkExactDuplicate's find_exact_duplicates RPC returns a match (the
    // first — and for a source-less create, only — rpc call).
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

    // Markdown response mentions the flag.
    expect(result.content[0].text).toContain('Dedup');
    expect(result.content[0].text).toContain('suspected_duplicate');

    // Structured content surfaces the stamp.
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

    // No 403 — silent-ignore per spec §6 D2; the stamp is still applied.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.dedup_status).toBe('suspected_duplicate');
    expect(result.structuredContent.suspected_duplicate_of).toBe(EXISTING_ID);
  });
});
