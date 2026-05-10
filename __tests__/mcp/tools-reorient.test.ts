import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

const mocks = vi.hoisted(() => {
  return {
    mockSupabaseClient: {
      from: vi.fn(),
      rpc: vi.fn(),
    },
    createMcpClient: vi.fn().mockImplementation(() => mocks.mockSupabaseClient),
    getMcpUserId: vi.fn().mockReturnValue('user-123'),
    getMcpUserRole: vi.fn().mockResolvedValue('editor'),
    fetchReorientData: vi.fn(),
    resolveDisplayNames: vi.fn(),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
}));

vi.mock('@/lib/reorient', () => ({
  fetchReorientData: mocks.fetchReorientData,
  resolveDisplayNames: mocks.resolveDisplayNames,
}));

vi.mock('@/lib/mcp/formatters', () => ({
  truncateResponse: vi.fn().mockImplementation((text: string) => text),
  formatReorientation: vi.fn().mockReturnValue('# Reorient Me Briefing'),
  toStructuredContent: vi.fn().mockImplementation((val: unknown) => val),
  formatBidDashboard: vi.fn(),
}));

vi.mock('@/lib/mcp/app-bundles', () => ({
  REORIENT_ME_HTML: '<html></html>',
  COVERAGE_MATRIX_HTML: '<html></html>',
  BID_DASHBOARD_HTML: '<html></html>',
}));

vi.mock('@/lib/mcp/resources', () => ({
  registerResources: vi.fn(),
  registerPrompts: vi.fn(),
}));

type ToolHandler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<unknown>;

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: vi.fn(
    (
      server: {
        registerTool: (
          name: string,
          config: Record<string, unknown>,
          handler: ToolHandler,
        ) => unknown;
      },
      name: string,
      config: Record<string, unknown>,
      handler: ToolHandler,
    ) => server.registerTool(name, config, handler),
  ),
}));

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}


const baseReorientData = {
  last_active_at: '2026-03-01T10:00:00Z',
  last_active_relative: '10 days ago',
  urgent: [],
  team_changes: [
    {
      user_id: 'user-456',
      user_name: null,
      action: 'updated',
      entity_type: 'content_item',
      entity_id: 'item-1',
      entity_title: 'Title',
      created_at: '2026-03-01T12:00:00Z',
    },
  ],
  my_recent_work: [],
  bid_summary: [],
  counts: {
    unread_notifications: 0,
    pending_reviews: 0,
    stale_or_expired: 0,
    quality_flags: 0,
  },
  generated_at: '2026-03-11T10:00:00Z',
  user_display_name: 'Liam',
  has_display_name: true,
  errors: [],
};

describe('show_reorient_me trigger tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: {} as AuthInfo };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    const { registerAppTools } = await import('@/lib/mcp/tools/apps');
    await registerAppTools(mockServer.server as never);
  });

  it('returns valid structuredContent', async () => {
    const handler = mockServer.getHandler('show_reorient_me')!;
    mocks.fetchReorientData.mockResolvedValue(baseReorientData);
    mocks.resolveDisplayNames.mockResolvedValue(new Map());

    const result = (await handler({}, extra)) as ToolResult;

    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.last_active_relative).toBe('10 days ago');
  });

  it('resolves display names', async () => {
    const handler = mockServer.getHandler('show_reorient_me')!;
    mocks.fetchReorientData.mockResolvedValue(baseReorientData);

    const nameMap = new Map([['user-456', 'Alice']]);
    mocks.resolveDisplayNames.mockResolvedValue(nameMap);

    const result = (await handler({}, extra)) as ToolResult;

    expect(
      (result.structuredContent as { team_changes: { user_name: string }[] })
        .team_changes[0].user_name,
    ).toBe('Alice');
  });

  it('returns Markdown content', async () => {
    const handler = mockServer.getHandler('show_reorient_me')!;
    mocks.fetchReorientData.mockResolvedValue(baseReorientData);
    mocks.resolveDisplayNames.mockResolvedValue(new Map());

    const result = (await handler({}, extra)) as ToolResult;
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('# Reorient Me Briefing');
  });

  it('handles errors', async () => {
    const handler = mockServer.getHandler('show_reorient_me')!;
    mocks.fetchReorientData.mockRejectedValue(new Error('Test error'));

    const result = (await handler({}, extra)) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Test error');
  });
});
