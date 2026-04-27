import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  checkMcpRole: vi.fn().mockResolvedValue('admin'),
  createMcpClient: vi.fn(),
  getMcpUserId: vi.fn().mockReturnValue('user-admin-001'),
  getMcpUserRole: vi.fn().mockResolvedValue('admin'),
  runPipeline: vi.fn(),
  createServiceClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock('@/lib/intelligence/pipeline', () => ({
  runPipeline: (...args: unknown[]) => mocks.runPipeline(...args),
}));

// Mock the intelligence summary module (needed by the existing get_intelligence_summary tool)
vi.mock('@/lib/intelligence/summary', () => ({
  fetchIntelligenceSummary: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type {
  McpServer,
  RegisteredTool,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerIntelligenceTools } from '@/lib/mcp/tools/intelligence';

// ---------------------------------------------------------------------------
// Mock server that captures tool registrations
// ---------------------------------------------------------------------------

interface CapturedTool {
  name: string;
  config: Record<string, unknown>;
  callback: (...args: unknown[]) => unknown;
}

function createMockServer(): { server: McpServer; tools: CapturedTool[] } {
  const tools: CapturedTool[] = [];
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        config: Record<string, unknown>,
        cb: (...args: unknown[]) => unknown,
      ) => {
        tools.push({ name, config, callback: cb });
        return { enabled: true } as unknown as RegisteredTool;
      },
    ),
  } as unknown as McpServer;
  return { server, tools };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_AUTH_INFO = {
  token: 'test-bearer-token',
  extra: { userId: 'user-admin-001', role: 'admin' },
};

const MOCK_EXTRA = {
  authInfo: MOCK_AUTH_INFO,
  signal: new AbortController().signal,
  sendNotification: vi.fn(),
  _meta: undefined,
  requestId: 'test-req-1',
  sendElicitationRequest: vi.fn(),
};

const MOCK_PIPELINE_RESULT = {
  runId: 'run-abc-123',
  startedAt: '2026-04-16T10:00:00Z',
  completedAt: '2026-04-16T10:02:30Z',
  sourcesProcessed: 3,
  totalArticlesFound: 15,
  totalArticlesNew: 8,
  totalArticlesPassed: 5,
  feedResults: [],
  errors: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trigger_intelligence_poll MCP tool', () => {
  let tools: CapturedTool[];

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks wipes them
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.createServiceClient.mockReturnValue({});

    const mock = createMockServer();
    tools = mock.tools;
    await registerIntelligenceTools(mock.server);
  });

  function getTriggerTool(): CapturedTool {
    const tool = tools.find((t) => t.name === 'trigger_intelligence_poll');
    if (!tool) throw new Error('trigger_intelligence_poll not registered');
    return tool;
  }

  it('registers the trigger_intelligence_poll tool', () => {
    expect(tools.some((t) => t.name === 'trigger_intelligence_poll')).toBe(
      true,
    );
  });

  it('has NON_IDEMPOTENT_OPEN_WORLD_WRITE_ANNOTATIONS', () => {
    const tool = getTriggerTool();
    const annotations = tool.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(false);
    expect(annotations.idempotentHint).toBe(false);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.openWorldHint).toBe(true);
  });

  it('returns pipeline run summary on success', async () => {
    mocks.runPipeline.mockResolvedValue(MOCK_PIPELINE_RESULT);

    const tool = getTriggerTool();
    const result = await tool.callback({}, MOCK_EXTRA);

    expect(mocks.checkMcpRole).toHaveBeenCalledWith(MOCK_AUTH_INFO, ['admin']);
    expect(mocks.runPipeline).toHaveBeenCalledOnce();

    const typedResult = result as {
      content: Array<{ type: string; text: string }>;
      structuredContent: Record<string, unknown>;
    };

    expect(typedResult.content[0].text).toContain(
      'Intelligence Poll Triggered',
    );
    expect(typedResult.content[0].text).toContain('run-abc-123');
    expect(typedResult.content[0].text).toContain('Sources processed:** 3');
    expect(typedResult.structuredContent).toEqual({
      run_id: 'run-abc-123',
      started_at: '2026-04-16T10:00:00Z',
      completed_at: '2026-04-16T10:02:30Z',
      sources_processed: 3,
      total_articles_found: 15,
      total_articles_new: 8,
      total_articles_passed: 5,
      errors: [],
    });
  });

  it('includes errors in output when pipeline reports them', async () => {
    mocks.runPipeline.mockResolvedValue({
      ...MOCK_PIPELINE_RESULT,
      errors: ['Source xyz timed out', 'Feed parse error on abc'],
    });

    const tool = getTriggerTool();
    const result = (await tool.callback({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: Record<string, unknown>;
    };

    expect(result.content[0].text).toContain('### Errors');
    expect(result.content[0].text).toContain('Source xyz timed out');
    expect(result.content[0].text).toContain('Feed parse error on abc');
    expect((result.structuredContent.errors as string[]).length).toBe(2);
  });

  it('rejects non-admin users', async () => {
    mocks.checkMcpRole.mockResolvedValue(null);

    const tool = getTriggerTool();
    const result = (await tool.callback({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
    expect(result.content[0].text).toContain('admin role required');
    expect(mocks.runPipeline).not.toHaveBeenCalled();
  });

  it('returns error content when pipeline throws', async () => {
    mocks.runPipeline.mockRejectedValue(new Error('Database connection lost'));

    const tool = getTriggerTool();
    const result = (await tool.callback({}, MOCK_EXTRA)) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Intelligence poll failed');
    expect(result.content[0].text).toContain('Database connection lost');
  });

  it('takes no input parameters', () => {
    const tool = getTriggerTool();
    const inputSchema = tool.config.inputSchema as Record<string, unknown>;
    expect(Object.keys(inputSchema)).toHaveLength(0);
  });
});
