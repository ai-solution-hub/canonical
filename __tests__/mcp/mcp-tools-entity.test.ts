/**
 * Tests for MCP tools #14-16:
 *   14. get_entity_relationships
 *   15. cite_content
 *   16. get_content_effectiveness
 *
 * Strategy: Create a mock McpServer that captures registered tool handlers
 * via registerTool(), then call the handlers directly with mock auth and
 * Supabase clients.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above const declarations
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockSupabaseClient = {
    rpc: vi.fn(),
    from: vi.fn(),
  };

  return {
    mockSupabaseClient,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi.fn().mockReturnValue('user-123'),
    getMcpUserRole: vi.fn().mockResolvedValue('editor'),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

// Mock lazy-loaded AI modules (not used by tools 14-16, but imported at module level)
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  };
});
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));
vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn(),
}));
vi.mock('@/lib/ai/errors', () => ({
  AIServiceError: class AIServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('@/lib/dashboard', () => ({
  fetchUnifiedDashboardData: vi.fn(),
  unifiedToDashboardData: vi.fn((d: unknown) => d),
}));
vi.mock('@/lib/procurement/procurement-queries', () => ({
  getBidDetail: vi.fn(),
  getBidQuestion: vi.fn(),
}));
vi.mock('@/lib/reorient', () => ({
  getReorientData: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock McpServer that captures registered tool handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAuthExtra(authInfo?: Partial<AuthInfo>) {
  return {
    authInfo: {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'write'],
      extra: { userId: 'user-123', role: 'editor' },
      ...authInfo,
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MCP tools #14-16', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  let supabase: typeof mocks.mockSupabaseClient;
  const extra = makeAuthExtra();

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    supabase = mocks.mockSupabaseClient;
    // Register only the categories under test: entity relationships plus
    // citation/effectiveness bid tools.
    const { registerEntityTools } = await import('@/lib/mcp/tools/entities');
    const { registerProcurementTools } = await import('@/lib/mcp/tools/procurement');
    await registerEntityTools(mockServer.server as never);
    await registerProcurementTools(mockServer.server as never);
  });

  // ─────────────────────────────────────────
  // 14. get_entity_relationships
  // ─────────────────────────────────────────

  describe('get_entity_relationships', () => {
    it('maps RPC summary rows to EntitySummaryResult format', async () => {
      const handler = mockServer.getHandler('get_entity_relationships')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            canonical_name: 'ISO 27001',
            entity_type: 'certification',
            mention_count: 12,
            content_item_ids: ['item-001', 'item-002'],
            related_entities: [{ relationship: 'holds', source: 'Acme Ltd' }],
          },
        ],
        error: null,
      });

      const result = (await handler(
        { entity_type: 'certification' },
        extra,
      )) as {
        content: Array<{ text: string }>;
        structuredContent: {
          summaries: Array<{
            canonical_name: string;
            entity_type: string;
            mention_count: number;
            content_item_ids: string[];
          }>;
        };
      };

      expect(result.content[0].text).toContain('ISO 27001');
      expect(result.structuredContent.summaries).toHaveLength(1);
      expect(result.structuredContent.summaries[0]).toEqual({
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        mention_count: 12,
        content_item_ids: ['item-001', 'item-002'],
        related_entities: [{ relationship: 'holds', source: 'Acme Ltd' }],
      });
    });

    it('fetches relationship details when entity_name is provided', async () => {
      const handler = mockServer.getHandler('get_entity_relationships')!;

      // First RPC call: get_entity_summary
      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            canonical_name: 'ISO 27001',
            entity_type: 'certification',
            mention_count: 5,
            content_item_ids: ['item-001'],
            related_entities: [],
          },
        ],
        error: null,
      });

      // Second RPC call: get_entity_relationships_rpc
      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            source_entity: 'Acme Ltd',
            relationship_type: 'holds',
            target_entity: 'ISO 27001',
            source_item_id: 'item-001',
            confidence: 0.95,
          },
        ],
        error: null,
      });

      const result = (await handler({ entity_name: 'ISO 27001' }, extra)) as {
        structuredContent: {
          relationships: Array<{
            source_entity: string;
            relationship_type: string;
            target_entity: string;
            source_item_id: string;
            confidence: number;
          }>;
        };
      };

      expect(supabase.rpc).toHaveBeenCalledTimes(2);
      expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'get_entity_summary', {
        p_entity_name: 'ISO 27001',
      });
      expect(supabase.rpc).toHaveBeenNthCalledWith(
        2,
        'get_entity_relationships_rpc',
        {
          p_entity_name: 'ISO 27001',
        },
      );

      expect(result.structuredContent.relationships).toHaveLength(1);
      expect(result.structuredContent.relationships[0]).toEqual({
        source_entity: 'Acme Ltd',
        relationship_type: 'holds',
        target_entity: 'ISO 27001',
        source_item_id: 'item-001',
        confidence: 0.95,
      });
    });

    it('does not fetch relationships when entity_name is omitted', async () => {
      const handler = mockServer.getHandler('get_entity_relationships')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            canonical_name: 'Acme Ltd',
            entity_type: 'organisation',
            mention_count: 3,
            content_item_ids: ['item-001'],
            related_entities: [],
          },
        ],
        error: null,
      });

      const result = (await handler(
        { entity_type: 'organisation' },
        extra,
      )) as {
        structuredContent: { relationships: unknown[] };
      };

      // Only one RPC call (summary), no relationship call
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(result.structuredContent.relationships).toEqual([]);
    });

    it('returns error response when RPC fails', async () => {
      const handler = mockServer.getHandler('get_entity_relationships')!;

      supabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'function not found' },
      });

      const result = (await handler({ entity_name: 'Test' }, extra)) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Entity query failed');
      expect(result.content[0].text).toContain('function not found');
    });

    it('returns empty summaries message when no entities match', async () => {
      const handler = mockServer.getHandler('get_entity_relationships')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = (await handler({ entity_name: 'NonExistent' }, extra)) as {
        content: Array<{ text: string }>;
        structuredContent: { entity_count: number };
      };

      expect(result.content[0].text).toContain('No entities found');
      expect(result.structuredContent.entity_count).toBe(0);
    });

    it('handles null content_item_ids and related_entities gracefully', async () => {
      const handler = mockServer.getHandler('get_entity_relationships')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            canonical_name: 'Test Entity',
            entity_type: 'technology',
            mention_count: 1,
            content_item_ids: null,
            related_entities: null,
          },
        ],
        error: null,
      });

      const result = (await handler({ entity_type: 'technology' }, extra)) as {
        structuredContent: {
          summaries: Array<{
            content_item_ids: string[];
            related_entities: unknown[];
          }>;
        };
      };

      expect(result.structuredContent.summaries[0].content_item_ids).toEqual(
        [],
      );
      expect(result.structuredContent.summaries[0].related_entities).toEqual(
        [],
      );
    });
  });

  // ─────────────────────────────────────────
  // 15. cite_content
  // ─────────────────────────────────────────

  describe('cite_content', () => {
    it('upserts a citation and returns formatted result', async () => {
      const handler = mockServer.getHandler('cite_content')!;

      const mockChain = {
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'cit-001',
            content_item_id: 'item-abc',
            bid_response_id: 'resp-xyz',
            citation_type: 'reference',
          },
          error: null,
        }),
      };
      supabase.from.mockReturnValue(mockChain);

      const result = (await handler(
        {
          content_item_id: 'item-abc',
          bid_response_id: 'resp-xyz',
        },
        extra,
      )) as {
        content: Array<{ text: string }>;
        structuredContent: Record<string, unknown>;
      };

      expect(supabase.from).toHaveBeenCalledWith('content_citations');
      expect(mockChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_item_id: 'item-abc',
          bid_response_id: 'resp-xyz',
          citation_type: 'reference',
          created_by: 'user-123',
        }),
        { onConflict: 'content_item_id,bid_response_id' },
      );
      expect(result.content[0].text).toContain('Citation Recorded');
      expect(result.content[0].text).toContain('item-abc');
      expect(result.content[0].text).toContain('resp-xyz');
      expect(result.structuredContent.id).toBe('cit-001');
    });

    it('uses custom citation_type when provided', async () => {
      const handler = mockServer.getHandler('cite_content')!;

      const mockChain = {
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'cit-002',
            content_item_id: 'item-abc',
            bid_response_id: 'resp-xyz',
            citation_type: 'adapted',
          },
          error: null,
        }),
      };
      supabase.from.mockReturnValue(mockChain);

      const result = (await handler(
        {
          content_item_id: 'item-abc',
          bid_response_id: 'resp-xyz',
          citation_type: 'adapted',
        },
        extra,
      )) as { content: Array<{ text: string }> };

      expect(mockChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ citation_type: 'adapted' }),
        expect.any(Object),
      );
      expect(result.content[0].text).toContain('**Type:** adapted');
    });

    it('rejects with permission error when user lacks editor role', async () => {
      const handler = mockServer.getHandler('cite_content')!;

      mocks.checkMcpRole.mockResolvedValueOnce(null);

      const result = (await handler(
        {
          content_item_id: 'item-abc',
          bid_response_id: 'resp-xyz',
        },
        extra,
      )) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
    });

    it('returns error when upsert fails', async () => {
      const handler = mockServer.getHandler('cite_content')!;

      const mockChain = {
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'foreign key violation' },
        }),
      };
      supabase.from.mockReturnValue(mockChain);

      const result = (await handler(
        {
          content_item_id: 'item-abc',
          bid_response_id: 'resp-xyz',
        },
        extra,
      )) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to record citation');
      expect(result.content[0].text).toContain('foreign key violation');
    });
  });

  // ─────────────────────────────────────────
  // 16. get_content_effectiveness
  // ─────────────────────────────────────────

  describe('get_content_effectiveness', () => {
    it('returns effectiveness data from win rate RPC', async () => {
      const handler = mockServer.getHandler('get_content_effectiveness')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            total_citations: 10,
            winning_citations: 7,
            losing_citations: 3,
            pending_citations: 0,
            win_rate: 0.7,
          },
        ],
        error: null,
      });

      const result = (await handler(
        { content_item_id: 'item-001' },
        extra,
      )) as {
        content: Array<{ text: string }>;
        structuredContent: {
          content_item_id: string;
          total_citations: number;
          winning_citations: number;
          losing_citations: number;
          pending_citations: number;
          win_rate: number;
        };
      };

      expect(supabase.rpc).toHaveBeenCalledWith('get_content_win_rate', {
        p_content_item_id: 'item-001',
      });

      expect(result.content[0].text).toContain('Content Effectiveness');
      expect(result.content[0].text).toContain('70%');
      expect(result.content[0].text).toContain('highly effective');

      expect(result.structuredContent.content_item_id).toBe('item-001');
      expect(result.structuredContent.total_citations).toBe(10);
      expect(result.structuredContent.winning_citations).toBe(7);
      expect(result.structuredContent.losing_citations).toBe(3);
      expect(result.structuredContent.pending_citations).toBe(0);
      expect(result.structuredContent.win_rate).toBe(0.7);
    });

    it('handles empty RPC result (no citations)', async () => {
      const handler = mockServer.getHandler('get_content_effectiveness')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = (await handler(
        { content_item_id: 'item-002' },
        extra,
      )) as {
        content: Array<{ text: string }>;
        structuredContent: { total_citations: number; win_rate: number };
      };

      expect(result.structuredContent.total_citations).toBe(0);
      expect(result.structuredContent.win_rate).toBe(0);
      expect(result.content[0].text).toContain('not yet been cited');
    });

    it('handles null RPC result', async () => {
      const handler = mockServer.getHandler('get_content_effectiveness')!;

      supabase.rpc.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = (await handler(
        { content_item_id: 'item-003' },
        extra,
      )) as {
        structuredContent: {
          total_citations: number;
          winning_citations: number;
          losing_citations: number;
          pending_citations: number;
          win_rate: number;
        };
      };

      expect(result.structuredContent.total_citations).toBe(0);
      expect(result.structuredContent.winning_citations).toBe(0);
      expect(result.structuredContent.losing_citations).toBe(0);
      expect(result.structuredContent.pending_citations).toBe(0);
      expect(result.structuredContent.win_rate).toBe(0);
    });

    it('returns error response when RPC fails', async () => {
      const handler = mockServer.getHandler('get_content_effectiveness')!;

      supabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'function not found' },
      });

      const result = (await handler(
        { content_item_id: 'item-004' },
        extra,
      )) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Effectiveness query failed');
      expect(result.content[0].text).toContain('function not found');
    });

    it('returns low win rate commentary when win rate is below 0.4', async () => {
      const handler = mockServer.getHandler('get_content_effectiveness')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            total_citations: 8,
            winning_citations: 1,
            losing_citations: 7,
            pending_citations: 0,
            win_rate: 0.125,
          },
        ],
        error: null,
      });

      const result = (await handler(
        { content_item_id: 'item-005' },
        extra,
      )) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('low win rate');
    });

    it('shows awaiting outcomes when citations exist but no decided bids', async () => {
      const handler = mockServer.getHandler('get_content_effectiveness')!;

      supabase.rpc.mockResolvedValueOnce({
        data: [
          {
            total_citations: 4,
            winning_citations: 0,
            losing_citations: 0,
            pending_citations: 4,
            win_rate: 0,
          },
        ],
        error: null,
      });

      const result = (await handler(
        { content_item_id: 'item-006' },
        extra,
      )) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain('Awaiting outcomes');
      expect(result.content[0].text).not.toContain('low win rate');
      expect(result.content[0].text).not.toContain('not yet been cited');
    });
  });
});
