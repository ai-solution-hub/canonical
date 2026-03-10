/**
 * Tests for MCP App trigger tools #22-23:
 *   22. show_coverage_matrix — Aggregates coverage data for interactive matrix
 *   23. show_bid_dashboard — Aggregates bid data for interactive dashboard
 *
 * Strategy: Create a mock McpServer that captures registered tool handlers
 * via registerTool(), then call the handlers directly with mock auth and
 * Supabase clients.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CoverageMatrixData, BidDashboardData } from '@/lib/mcp/formatters';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted above const declarations
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const chainMethods = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    // Terminator: make chain awaitable
    then: vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    ),
  };

  // All chainable methods return the chain
  for (const key of ['select', 'eq', 'neq', 'order', 'limit'] as const) {
    chainMethods[key].mockReturnValue(chainMethods);
  }

  const mockSupabaseClient = {
    rpc: vi.fn(),
    from: vi.fn().mockReturnValue(chainMethods),
    _chain: chainMethods,
  };

  return {
    mockSupabaseClient,
    chainMethods,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi.fn().mockReturnValue('user-123'),
    getMcpUserRole: vi.fn().mockResolvedValue('editor'),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
    fetchDashboardData: vi.fn(),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

// Mock lazy-loaded modules
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));
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
  fetchDashboardData: mocks.fetchDashboardData,
}));
vi.mock('@/lib/bid-queries', () => ({
  getBidDetail: vi.fn(),
  getBidQuestion: vi.fn(),
}));
vi.mock('@/lib/reorient', () => ({
  getReorientData: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock McpServer that captures registered tool handlers
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  name: string;
  config: Record<string, unknown>;
  handler: ToolHandler;
}

function createMockMcpServer() {
  const tools: Record<string, RegisteredTool> = {};

  return {
    tools,
    registerTool(name: string, config: Record<string, unknown>, handler: ToolHandler) {
      tools[name] = { name, config, handler };
    },
    getHandler(name: string): ToolHandler | undefined {
      return tools[name]?.handler;
    },
  };
}

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

const baseDashboardData = {
  freshness_summary: { fresh: 100, aging: 30, stale: 15, expired: 5 },
  needs_attention: {
    expired_content_count: 5,
    stale_content_count: 15,
    governance_review_count: 0,
    quality_flag_count: 3,
    unverified_count: 0,
  },
  active_bids: [],
  recent_activity: [],
  unread_notification_count: 0,
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MCP App trigger tools #22-23', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  let supabase: typeof mocks.mockSupabaseClient;
  const extra = makeAuthExtra();

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    supabase = mocks.mockSupabaseClient;

    // Reset chain methods
    for (const key of ['select', 'eq', 'neq', 'order', 'limit'] as const) {
      mocks.chainMethods[key].mockReturnValue(mocks.chainMethods);
    }
    mocks.chainMethods.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );
    supabase.from.mockReturnValue(mocks.chainMethods);

    // Default dashboard data
    mocks.fetchDashboardData.mockResolvedValue({ ...baseDashboardData });

    // Import and register tools
    const { registerTools } = await import('@/lib/mcp/tools');
    await registerTools(mockServer as never);
  });

  // ─────────────────────────────────────────
  // 22. show_coverage_matrix
  // ─────────────────────────────────────────

  describe('show_coverage_matrix', () => {
    it('returns structured CoverageMatrixData with correct shape', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;
      expect(handler).toBeDefined();

      const result = await handler({}, extra) as {
        content: Array<{ type: string; text: string }>;
        structuredContent: CoverageMatrixData;
      };

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('# Coverage Matrix');

      // Verify data shape
      const data = result.structuredContent;
      expect(data).toHaveProperty('total_items');
      expect(data).toHaveProperty('freshness');
      expect(data.freshness).toHaveProperty('fresh');
      expect(data.freshness).toHaveProperty('aging');
      expect(data.freshness).toHaveProperty('stale');
      expect(data.freshness).toHaveProperty('expired');
      expect(data).toHaveProperty('domains');
      expect(data).toHaveProperty('quality');
      expect(data).toHaveProperty('gaps');
    });

    it('computes total items from freshness summary', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        freshness_summary: { fresh: 50, aging: 20, stale: 10, expired: 5 },
      });

      const result = await handler({}, extra) as {
        structuredContent: CoverageMatrixData;
      };

      expect(result.structuredContent.total_items).toBe(85);
      expect(result.structuredContent.freshness).toEqual({
        fresh: 50,
        aging: 20,
        stale: 10,
        expired: 5,
      });
    });

    it('builds domain breakdown from content_items and taxonomy', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;
      let fromCallCount = 0;

      // Configure from() to return different data based on call order:
      // 1st call: content_items
      // 2nd call: taxonomy_domains
      // 3rd call: taxonomy_subtopics
      // 4th call: ingestion_quality_log
      supabase.from.mockImplementation((table: string) => {
        fromCallCount++;
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: vi.fn(),
        };

        if (table === 'content_items') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { primary_domain: 'Security', primary_subtopic: 'Pen Testing', freshness: 'fresh' },
                { primary_domain: 'Security', primary_subtopic: 'Pen Testing', freshness: 'aging' },
                { primary_domain: 'Security', primary_subtopic: 'Incident Response', freshness: 'stale' },
                { primary_domain: 'Compliance', primary_subtopic: null, freshness: 'fresh' },
              ],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_domains') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { id: 'd1', name: 'Security', display_order: 1 },
                { id: 'd2', name: 'Compliance', display_order: 2 },
              ],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_subtopics') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { id: 's1', name: 'Pen Testing', domain_id: 'd1', display_order: 1 },
                { id: 's2', name: 'Incident Response', domain_id: 'd1', display_order: 2 },
                { id: 's3', name: 'GDPR', domain_id: 'd2', display_order: 1 },
              ],
              error: null,
            }),
          );
        } else if (table === 'ingestion_quality_log') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { flag_type: 'thin_content', severity: 'warning' },
                { flag_type: 'thin_content', severity: 'warning' },
              ],
              error: null,
            }),
          );
        }

        return chain;
      });

      const result = await handler({}, extra) as {
        structuredContent: CoverageMatrixData;
      };

      const domains = result.structuredContent.domains;
      expect(domains.length).toBeGreaterThan(0);

      // Find Security domain
      const security = domains.find(d => d.name === 'Security');
      expect(security).toBeDefined();
      expect(security!.total_items).toBe(3);
      expect(security!.fresh).toBe(1);
      expect(security!.aging).toBe(1);
      expect(security!.stale).toBe(1);

      // Check subtopics
      const penTesting = security!.subtopics.find(s => s.name === 'Pen Testing');
      expect(penTesting).toBeDefined();
      expect(penTesting!.total_items).toBe(2);
      expect(penTesting!.fresh).toBe(1);
      expect(penTesting!.aging).toBe(1);
    });

    it('computes coverage gaps correctly — empty subtopic', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      supabase.from.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: vi.fn(),
        };

        if (table === 'content_items') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null }),
          );
        } else if (table === 'taxonomy_domains') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [{ id: 'd1', name: 'Security', display_order: 1 }],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_subtopics') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { id: 's1', name: 'Empty Subtopic', domain_id: 'd1', display_order: 1 },
              ],
              error: null,
            }),
          );
        } else {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null }),
          );
        }

        return chain;
      });

      const result = await handler({}, extra) as {
        structuredContent: CoverageMatrixData;
      };

      const gaps = result.structuredContent.gaps;
      // Domain with 0 items
      const domainGap = gaps.find(g => g.domain === 'Security' && g.subtopic === null);
      expect(domainGap).toBeDefined();
      expect(domainGap!.issue).toBe('empty');

      // Subtopic with 0 items
      const subtopicGap = gaps.find(g => g.subtopic === 'Empty Subtopic');
      expect(subtopicGap).toBeDefined();
      expect(subtopicGap!.issue).toBe('empty');
      expect(subtopicGap!.item_count).toBe(0);
    });

    it('computes coverage gaps correctly — thin subtopic', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      supabase.from.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: vi.fn(),
        };

        if (table === 'content_items') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { primary_domain: 'Security', primary_subtopic: 'Thin Area', freshness: 'fresh' },
                { primary_domain: 'Security', primary_subtopic: 'Thin Area', freshness: 'fresh' },
              ],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_domains') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [{ id: 'd1', name: 'Security', display_order: 1 }],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_subtopics') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { id: 's1', name: 'Thin Area', domain_id: 'd1', display_order: 1 },
              ],
              error: null,
            }),
          );
        } else {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null }),
          );
        }

        return chain;
      });

      const result = await handler({}, extra) as {
        structuredContent: CoverageMatrixData;
      };

      const gaps = result.structuredContent.gaps;
      const thinGap = gaps.find(g => g.subtopic === 'Thin Area');
      expect(thinGap).toBeDefined();
      expect(thinGap!.issue).toBe('thin');
      expect(thinGap!.item_count).toBe(2);
    });

    it('computes coverage gaps correctly — stale-only subtopic', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      supabase.from.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: vi.fn(),
        };

        if (table === 'content_items') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { primary_domain: 'Security', primary_subtopic: 'Old Area', freshness: 'stale' },
                { primary_domain: 'Security', primary_subtopic: 'Old Area', freshness: 'stale' },
                { primary_domain: 'Security', primary_subtopic: 'Old Area', freshness: 'expired' },
              ],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_domains') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [{ id: 'd1', name: 'Security', display_order: 1 }],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_subtopics') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { id: 's1', name: 'Old Area', domain_id: 'd1', display_order: 1 },
              ],
              error: null,
            }),
          );
        } else {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null }),
          );
        }

        return chain;
      });

      const result = await handler({}, extra) as {
        structuredContent: CoverageMatrixData;
      };

      const gaps = result.structuredContent.gaps;
      const staleGap = gaps.find(g => g.subtopic === 'Old Area');
      expect(staleGap).toBeDefined();
      expect(staleGap!.issue).toBe('stale_only');
      expect(staleGap!.item_count).toBe(3);
    });

    it('skips gap computation when include_gaps is false', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      supabase.from.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: vi.fn(),
        };

        if (table === 'taxonomy_domains') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [{ id: 'd1', name: 'Security', display_order: 1 }],
              error: null,
            }),
          );
        } else if (table === 'taxonomy_subtopics') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [{ id: 's1', name: 'Empty', domain_id: 'd1', display_order: 1 }],
              error: null,
            }),
          );
        } else {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null }),
          );
        }

        return chain;
      });

      const result = await handler({ include_gaps: false }, extra) as {
        structuredContent: CoverageMatrixData;
      };

      expect(result.structuredContent.gaps).toEqual([]);
    });

    it('includes quality issue counts from ingestion_quality_log', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      supabase.from.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: vi.fn(),
        };

        if (table === 'ingestion_quality_log') {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({
              data: [
                { flag_type: 'thin_content', severity: 'warning' },
                { flag_type: 'thin_content', severity: 'warning' },
                { flag_type: 'missing_summary', severity: 'info' },
              ],
              error: null,
            }),
          );
        } else {
          chain.then.mockImplementation((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null }),
          );
        }

        return chain;
      });

      const result = await handler({ include_gaps: false }, extra) as {
        structuredContent: CoverageMatrixData;
      };

      expect(result.structuredContent.quality.total_flagged).toBe(3);
      expect(result.structuredContent.quality.by_issue_type).toEqual({
        thin_content: 2,
        missing_summary: 1,
      });
    });

    it('returns Markdown text in content', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      const result = await handler({}, extra) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('# Coverage Matrix');
      expect(result.content[0].text).toContain('**Total items:**');
    });

    it('returns error response when an exception occurs', async () => {
      const handler = mockServer.getHandler('show_coverage_matrix')!;

      mocks.fetchDashboardData.mockRejectedValue(new Error('Connection refused'));

      const result = await handler({}, extra) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Coverage matrix failed');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });

  // ─────────────────────────────────────────
  // 23. show_bid_dashboard
  // ─────────────────────────────────────────

  describe('show_bid_dashboard', () => {
    const sampleBids = [
      {
        id: 'bid-001',
        name: 'NHS Digital Transformation',
        buyer: 'NHS England',
        status: 'active',
        deadline: '2026-04-15',
        days_until_deadline: 37,
        total_questions: 25,
        answered_questions: 18,
        approved_questions: 12,
      },
      {
        id: 'bid-002',
        name: 'MoD Cyber Security',
        buyer: null,
        status: 'drafting',
        deadline: '2026-03-01',
        days_until_deadline: -8,
        total_questions: 40,
        answered_questions: 10,
        approved_questions: 5,
      },
    ];

    it('returns structured BidDashboardData with correct shape', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;
      expect(handler).toBeDefined();

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: sampleBids,
      });

      const result = await handler({}, extra) as {
        content: Array<{ type: string; text: string }>;
        structuredContent: BidDashboardData;
      };

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('# Bid Dashboard');

      const data = result.structuredContent;
      expect(data).toHaveProperty('offset');
      expect(data).toHaveProperty('count');
      expect(data).toHaveProperty('total_count');
      expect(data).toHaveProperty('has_more');
      expect(data).toHaveProperty('bids');
      expect(data.offset).toBe(0);
      expect(data.count).toBe(2);
      expect(data.total_count).toBe(2);
      expect(data.has_more).toBe(false);
    });

    it('maps active_bids to bid list with correct fields', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: sampleBids,
      });

      const result = await handler({}, extra) as {
        structuredContent: BidDashboardData;
      };

      const bids = result.structuredContent.bids;
      expect(bids).toHaveLength(2);

      expect(bids[0]).toEqual({
        id: 'bid-001',
        name: 'NHS Digital Transformation',
        buyer: 'NHS England',
        status: 'active',
        deadline: '2026-04-15',
        days_until_deadline: 37,
        total_questions: 25,
        answered_questions: 18,
        approved_questions: 12,
      });

      expect(bids[1].buyer).toBeNull();
    });

    it('returns empty bids array when no active bids', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: [],
      });

      const result = await handler({}, extra) as {
        content: Array<{ text: string }>;
        structuredContent: BidDashboardData;
      };

      expect(result.structuredContent.bids).toEqual([]);
      expect(result.structuredContent.count).toBe(0);
      expect(result.structuredContent.total_count).toBe(0);
      expect(result.content[0].text).toContain('No active bids found');
    });

    it('fetches focused bid detail when bid_id is provided', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: sampleBids,
      });

      // Mock workspace lookup for focused bid
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'bid-001',
            name: 'NHS Digital Transformation',
            description: 'A digital transformation bid for NHS England.',
            domain_metadata: {
              buyer: 'NHS England',
              status: 'active',
              deadline: '2026-04-15',
              reference_number: 'NHS-DT-2026',
            },
          },
          error: null,
        }),
      };
      supabase.from.mockReturnValue(mockChain);

      // Mock RPC for question stats
      supabase.rpc.mockResolvedValueOnce({
        data: [{
          total_questions: 25,
          strong_match_count: 10,
          partial_match_count: 8,
          needs_sme_count: 3,
          no_content_count: 2,
          unmatched_count: 2,
          drafted_count: 15,
          complete_count: 12,
        }],
        error: null,
      });

      const result = await handler({ bid_id: 'bid-001' }, extra) as {
        structuredContent: BidDashboardData & { focused_bid_detail: Record<string, unknown> };
      };

      expect(result.structuredContent.focused_bid_detail).toBeDefined();
      expect(result.structuredContent.focused_bid_detail.name).toBe('NHS Digital Transformation');
      expect(result.structuredContent.focused_bid_detail.buyer).toBe('NHS England');
      expect(result.structuredContent.focused_bid_detail.reference_number).toBe('NHS-DT-2026');
      expect(result.structuredContent.focused_bid_detail.question_stats).toBeDefined();
    });

    it('does not include focused_bid_detail when bid_id is omitted', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: sampleBids,
      });

      const result = await handler({}, extra) as {
        structuredContent: BidDashboardData;
      };

      expect(result.structuredContent.focused_bid_detail).toBeUndefined();
    });

    it('handles focused bid not found gracefully', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: sampleBids,
      });

      // Mock workspace lookup returning null
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };
      supabase.from.mockReturnValue(mockChain);

      const result = await handler({ bid_id: 'nonexistent-id' }, extra) as {
        structuredContent: BidDashboardData;
      };

      // Should still return bids but no focused detail
      expect(result.structuredContent.bids).toHaveLength(2);
      expect(result.structuredContent.focused_bid_detail).toBeUndefined();
    });

    it('returns Markdown text in content array', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: sampleBids,
      });

      const result = await handler({}, extra) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('# Bid Dashboard');
      expect(result.content[0].text).toContain('NHS Digital Transformation');
    });

    it('returns error response when an exception occurs', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockRejectedValue(new Error('Database timeout'));

      const result = await handler({}, extra) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Bid dashboard failed');
      expect(result.content[0].text).toContain('Database timeout');
    });

    it('preserves null buyer in bid data', async () => {
      const handler = mockServer.getHandler('show_bid_dashboard')!;

      mocks.fetchDashboardData.mockResolvedValue({
        ...baseDashboardData,
        active_bids: [{
          id: 'bid-003',
          name: 'Unnamed Bid',
          buyer: null,
          status: 'draft',
          deadline: null,
          days_until_deadline: null,
          total_questions: 0,
          answered_questions: 0,
          approved_questions: 0,
        }],
      });

      const result = await handler({}, extra) as {
        structuredContent: BidDashboardData;
      };

      expect(result.structuredContent.bids[0].buyer).toBeNull();
      expect(result.structuredContent.bids[0].deadline).toBeNull();
    });
  });
});
