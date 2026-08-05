/**
 * Tests for the entity MCP tool surface: get_entity_relationships.
 * (cite_content + get_content_effectiveness were retired with the S530
 * id-417 wave — their describes went with them.)
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
vi.mock('@/lib/domains/procurement/procurement-queries', () => ({
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

describe('MCP entity tools', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  let supabase: typeof mocks.mockSupabaseClient;
  const extra = makeAuthExtra();

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    supabase = mocks.mockSupabaseClient;
    // Register only the category under test: entity relationships.
    const { registerEntityTools } = await import('@/lib/mcp/tools/entities');
    await registerEntityTools(mockServer.server as never);
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
            source_document_id: 'item-001',
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
            source_document_id: string;
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
        source_document_id: 'item-001',
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
});
