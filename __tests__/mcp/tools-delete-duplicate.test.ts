import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';
// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    ),
  };

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(chainMethods),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    _chain: chainMethods,
  };

  return {
    mockSupabaseClient,
    chainMethods,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi.fn().mockReturnValue('user-123'),
    getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: vi.fn().mockResolvedValue(true),
}));

// Mock lazy-loaded modules
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn(),
  };
});
vi.mock('@/lib/ai/classify', () => ({ classifyContent: vi.fn() }));
vi.mock('@/lib/ai/summarise', () => ({ generateSummary: vi.fn() }));
vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: vi.fn(),
}));
vi.mock('@/lib/dashboard', () => ({
  fetchUnifiedDashboardData: vi.fn(),
  unifiedToDashboardData: vi.fn((d: unknown) => d),
}));
vi.mock('@/lib/reorient', () => ({
  fetchReorientData: vi.fn(),
  resolveDisplayNames: vi.fn(),
}));
vi.mock('@/lib/domains/procurement/procurement-queries', () => ({
  fetchProcurementSections: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock McpServer
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

describe('delete_content_item', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    const { registerGovernanceTools } =
      await import('@/lib/mcp/tools/governance');
    await registerGovernanceTools(
      mockServer.server as unknown as Parameters<
        typeof registerGovernanceTools
      >[0],
    );
  });

  it('archives item and records history when mode: archive', async () => {
    const handler = mockServer.getHandler('delete_content_item')!;

    // 1. Mock fetch item
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: { id: '1', title: 'T', content: 'C', archived_at: null },
          error: null,
        }),
    );
    // 2. Mock fetch history for version tracking
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ version: 2 }], error: null }),
    );
    // 3 & 4. update and insert use default then (data: null)

    const result = (await handler(
      { id: '1', mode: 'archive', reason: 'R' },
      extra as Record<string, unknown>,
    )) as ToolResult;

    expect(result.content[0].text).toContain('# Content Item Archived');
    expect(result.content[0].text).toContain('**Mode:** archive');
    expect(mocks.chainMethods.update).toHaveBeenCalled();
    expect(mocks.chainMethods.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 3,
        change_type: 'archive',
        change_summary: 'Item archived: R',
      }),
    );
  });

  it('returns informational message if already archived', async () => {
    const handler = mockServer.getHandler('delete_content_item')!;

    // 1. Mock fetch item (already archived)
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: { id: '1', title: 'T', archived_at: '2026-01-01' },
          error: null,
        }),
    );

    const result = (await handler(
      { id: '1', mode: 'archive', reason: 'R' },
      extra as Record<string, unknown>,
    )) as ToolResult;
    expect(result.content[0].text).toContain('already archived');
    expect(mocks.chainMethods.update).not.toHaveBeenCalled();
  });

  it('denies delete for non-admin', async () => {
    const handler = mockServer.getHandler('delete_content_item')!;
    mocks.getMcpUserRole.mockResolvedValueOnce('editor');

    const result = (await handler(
      { id: '1', mode: 'delete', reason: 'R' },
      extra as Record<string, unknown>,
    )) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('requires admin');
  });

  it('allows delete for admin and records history', async () => {
    const handler = mockServer.getHandler('delete_content_item')!;
    mocks.getMcpUserRole.mockResolvedValueOnce('admin');

    // 1. Mock fetch item
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: { id: '1', title: 'T' }, error: null }),
    );
    // 2. Mock fetch history for version tracking
    mocks.chainMethods.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [{ version: 2 }], error: null }),
    );
    // 3 & 4. insert and delete use default then

    const result = (await handler(
      { id: '1', mode: 'delete', reason: 'R' },
      extra as Record<string, unknown>,
    )) as ToolResult;
    expect(result.content[0].text).toContain('# Content Item Deleted');
    expect(mocks.chainMethods.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        change_type: 'delete',
      }),
    );
    expect(mocks.chainMethods.delete).toHaveBeenCalled();
  });

  // (The `find_duplicates (scope: all)` whole-KB batch-scan test block —
  // asserting the find_duplicate_pairs RPC call + "Potential Duplicates
  // Scan" markdown — was retired under ID-131.15, G-DEDUP legacy
  // dedup-family retirement, S446, alongside the production branch it
  // exercised. See __tests__/mcp/dedup-consolidation.test.ts for the
  // surviving single-item find_duplicates coverage.)
});
