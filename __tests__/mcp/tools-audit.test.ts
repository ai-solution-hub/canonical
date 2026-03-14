import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpClient, checkMcpRole } from '@/lib/mcp/auth';

// ---------------------------------------------------------------------------
// Hoisted mocks
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

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(chainMethods),
    rpc: rpcMock,
    _chain: chainMethods,
  };

  return {
    mockSupabaseClient,
    chainMethods,
    rpcMock,
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

// Mock lazy-loaded modules
vi.mock('@/lib/ai/embed', () => ({ generateEmbedding: vi.fn() }));
vi.mock('@/lib/ai/classify', () => ({ classifyContent: vi.fn() }));
vi.mock('@/lib/ai/summarise', () => ({ generateSummary: vi.fn() }));

// ---------------------------------------------------------------------------
// Mock McpServer
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;

function createMockMcpServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    tools,
    registerTool(name: string, config: Record<string, unknown>, handler: ToolHandler) {
      tools[name] = { handler };
    },
    getHandler(name: string): ToolHandler | undefined {
      return tools[name]?.handler;
    },
  };
}

describe('audit_content brief_content logic', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    const { registerTools } = await import('@/lib/mcp/tools');
    await registerTools(mockServer as unknown as Parameters<typeof registerTools>[0]);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper, result shape varies
  const runAudit = async (rows: Record<string, unknown>[], issueType?: string): Promise<any> => {
    const handler = mockServer.getHandler('audit_content')!;
    mocks.rpcMock.mockResolvedValue({ data: rows, error: null });
    return await handler({ issue_type: issueType }, extra as Record<string, unknown>);
  };

  it('flags q_a_pair with 150 chars as brief_content', async () => {
    const rows = [{
      id: '1', title: 'Q', content_type: 'q_a_pair', content_length: 150,
      classification_confidence: 0.9, ai_summary: 'S', ai_keywords: ['K'], primary_domain: 'D'
    }];
    const result = await runAudit(rows);
    expect(result.structuredContent.items[0].issues).toContain('brief_content');
  });

  it('flags article with 400 chars as brief_content', async () => {
    const rows = [{
      id: '1', title: 'A', content_type: 'article', content_length: 400,
      classification_confidence: 0.9, ai_summary: 'S', ai_keywords: ['K'], primary_domain: 'D'
    }];
    const result = await runAudit(rows);
    expect(result.structuredContent.items[0].issues).toContain('brief_content');
  });

  it('flags policy with 250 chars as brief_content', async () => {
    const rows = [{
      id: '1', title: 'P', content_type: 'policy', content_length: 250,
      classification_confidence: 0.9, ai_summary: 'S', ai_keywords: ['K'], primary_domain: 'D'
    }];
    const result = await runAudit(rows);
    expect(result.structuredContent.items[0].issues).toContain('brief_content');
  });

  it('does NOT flag q_a_pair with 250 chars as brief_content', async () => {
    const rows = [{
      id: '1', title: 'Q', content_type: 'q_a_pair', content_length: 250,
      classification_confidence: 0.9, ai_summary: 'S', ai_keywords: ['K'], primary_domain: 'D'
    }];
    const result = await runAudit(rows);
    expect(result.structuredContent.total_flagged).toBe(0);
  });

  it('flags items < 20 chars as thin_content only', async () => {
    const rows = [{
      id: '1', title: 'T', content_type: 'article', content_length: 15,
      classification_confidence: 0.9, ai_summary: 'S', ai_keywords: ['K'], primary_domain: 'D'
    }];
    const result = await runAudit(rows);
    const item = result.structuredContent.items[0];
    expect(item.issues).toContain('thin_content');
    expect(item.issues).not.toContain('brief_content');
  });

  it('filters by brief_content issue type', async () => {
    const rows = [
      {
        id: 'brief', title: 'B', content_type: 'q_a_pair', content_length: 150,
        classification_confidence: 0.9, ai_summary: 'S', ai_keywords: ['K'], primary_domain: 'D'
      },
      {
        id: 'thin', title: 'T', content_type: 'q_a_pair', content_length: 10,
        classification_confidence: 0.9, ai_summary: 'S', ai_keywords: ['K'], primary_domain: 'D'
      }
    ];
    const result = await runAudit(rows, 'brief_content');
    expect(result.structuredContent.total_flagged).toBe(1);
    expect(result.structuredContent.items[0].id).toBe('brief');
  });
});
