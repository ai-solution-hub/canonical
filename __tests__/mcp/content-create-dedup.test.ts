/**
 * MCP `create_content_item` dedup retirement (ID-131.15, G-DEDUP legacy
 * dedup-family retirement, S446).
 *
 * The on-ingest exact-hash dedup soft-block (checkExactDuplicate /
 * resolveDedupStamp, backed by the now-DROPped find_exact_duplicates RPC)
 * was removed under owner-ratified opt-i. New items are always stamped
 * `dedup_status='clean'` with no `suspected_duplicate_of`, regardless of
 * any prior matching content in the KB. `skip_dedup` is accepted on the
 * input schema (caller backwards-compatibility) but is now a no-op for
 * both admin and non-admin callers.
 *
 * ID-71.16: the create-leg does not write a direct `content_items.insert`
 * (the canonical store materialises the row via the pipeline) — the
 * dedup_status stamp is observed on the tool's structured response +
 * markdown, not on an insert payload. Source-less creates route through
 * stageAndWalk, so these assertions key off the response.
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
      sourceDocumentId: 'sd400000-0000-4000-8000-000000000001',
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
// Tests — dedup retirement: always-clean stamping, skip_dedup no-op.
// ---------------------------------------------------------------------------

describe('MCP create_content_item — dedup retirement (ID-131.15)', () => {
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
      sourceDocumentId: 'sd400000-0000-4000-8000-000000000001',
    });
  });

  it('always stamps dedup_status=clean — no on-ingest exact-hash check runs', async () => {
    // Even though the RPC mock is primed with a would-be "exact match" row,
    // nothing in the create-leg queries for duplicates any more (the
    // find_exact_duplicates RPC this test used to exercise was DROPped).
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
    expect(result.structuredContent.dedup_status).toBe('clean');
    expect(result.structuredContent.suspected_duplicate_of).toBeNull();
    // No dedup warning note in the markdown response.
    expect(result.content[0].text).not.toContain('Dedup');
    expect(result.content[0].text).not.toContain('suspected_duplicate');
  });

  it('skip_dedup=true (admin) is a no-op — item still stamps clean', async () => {
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [{ id: EXISTING_ID, title: 'Existing Item' }],
      error: null,
    });

    const result = await createTool(
      {
        title: 'Admin Legacy Field',
        content: LONG_CONTENT,
        content_type: 'capability',
        skip_dedup: true,
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.dedup_status).toBe('clean');
  });

  it('skip_dedup=true (non-admin) is a no-op — item still stamps clean', async () => {
    // Role remains 'editor' per beforeEach default
    mocks.mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [{ id: EXISTING_ID, title: 'Existing Item' }],
      error: null,
    });

    const result = await createTool(
      {
        title: 'Editor Legacy Field',
        content: LONG_CONTENT,
        content_type: 'capability',
        skip_dedup: true,
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.dedup_status).toBe('clean');
    expect(result.structuredContent.suspected_duplicate_of).toBeNull();
  });
});
