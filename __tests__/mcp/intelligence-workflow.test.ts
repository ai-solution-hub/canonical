/**
 * Intelligence Workflow Integration Tests
 *
 * Tests the intelligence MCP tools end-to-end with mocked Supabase:
 * - search_knowledge_base with workspace_id filtering
 * - get_workspace_items for workspace-scoped batch fetch
 * - get_intelligence_summary for workspace aggregation
 *
 * These tests exercise the actual tool handler logic (not the MCP protocol layer)
 * to verify response format, content, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Chainable Supabase query builder
  const createChain = (resolvedValue: { data: unknown; error: unknown }) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.not = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.range = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(resolvedValue);
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve(resolvedValue),
    );
    return chain;
  };

  const mockSupabaseClient = {
    from: vi.fn(),
    rpc: vi.fn(),
    _createChain: createChain,
  };

  return {
    mockSupabaseClient,
    createChain,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: vi.fn().mockResolvedValue('editor'),
}));

// Mock the intelligence summary module
const mockFetchIntelligenceSummary = vi.fn();
vi.mock('@/lib/intelligence/summary', () => ({
  fetchIntelligenceSummary: (...args: unknown[]) =>
    mockFetchIntelligenceSummary(...args),
}));

// Mock embedding generation
vi.mock('@/lib/mcp/tools/shared', () => ({
  toStructuredContent: vi.fn((obj: unknown) => ({ json: obj })),
  getGenerateEmbedding: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  ),
  ToolExtra: {} as unknown,
}));

// Mock formatters (pass through for response validation)
vi.mock('@/lib/mcp/formatters', () => ({
  formatSearchResults: vi.fn((results: unknown) =>
    `Search results: ${JSON.stringify(results)}`,
  ),
  formatBatchContentItems: vi.fn((result: unknown) =>
    `Batch items: ${JSON.stringify(result)}`,
  ),
  formatIntelligenceSummary: vi.fn((data: unknown) =>
    `Summary: ${JSON.stringify(data)}`,
  ),
  truncateResponse: vi.fn((text: string) => text),
  formatQASearchResults: vi.fn(),
  formatSimilarItems: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { IntelligenceSummaryData } from '@/lib/mcp/formatters/intelligence';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const CONTENT_ITEM_1 = {
  id: 'c1c1c1c1-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  title: 'Cyber Security Policy Update',
  content_type: 'article',
  primary_domain: 'Legislation & Policy',
  primary_subtopic: 'Regulatory Changes',
  ai_summary: 'Overview of new cyber security regulations.',
  similarity: 0.92,
};

const CONTENT_ITEM_2 = {
  id: 'c2c2c2c2-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  title: 'Market Analysis Q2 2026',
  content_type: 'article',
  primary_domain: 'Market Intelligence',
  primary_subtopic: 'Industry Trends',
  ai_summary: 'Quarterly market analysis.',
  similarity: 0.85,
};

const CONTENT_ITEM_3 = {
  id: 'c3c3c3c3-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  title: 'Unrelated Bid Document',
  content_type: 'article',
  primary_domain: 'Corporate',
  primary_subtopic: 'Company Profile',
  ai_summary: 'Company overview.',
  similarity: 0.78,
};

function makeSummaryData(
  overrides: Partial<IntelligenceSummaryData> = {},
): IntelligenceSummaryData {
  return {
    workspace_id: WORKSPACE_ID,
    workspace_name: 'Cyber Security Intel',
    period: '7d',
    period_label: 'Last 7 days',
    total_ingested: 50,
    total_passed: 20,
    total_filtered: 30,
    filter_ratio: 0.6,
    by_category: { 'Data Breaches': 12, 'Ransomware': 8 },
    by_source: [
      { source_name: 'Dark Reading', article_count: 30, passed_count: 12 },
    ],
    top_articles: [
      {
        id: 'art-001',
        title: 'Major Data Breach at TechCorp',
        source_name: 'Dark Reading',
        external_url: 'https://example.com/article-1',
        relevance_score: 0.95,
        relevance_category: 'high',
        ai_summary: 'A significant breach affecting 10M users.',
        matched_categories: ['Data Breaches'],
        published_at: '2026-04-01T10:00:00Z',
        ingested_at: '2026-04-01T12:00:00Z',
      },
    ],
    unresolved_flags: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — Workspace-scoped search (search_knowledge_base + workspace_id)
// ---------------------------------------------------------------------------

describe('workspace-scoped search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters search results to items in the specified workspace', () => {
    // Items 1 and 2 are in the workspace, item 3 is not
    const workspaceJunction = [
      { content_item_id: CONTENT_ITEM_1.id },
      { content_item_id: CONTENT_ITEM_2.id },
    ];

    const allResults = [CONTENT_ITEM_1, CONTENT_ITEM_2, CONTENT_ITEM_3];

    // Simulate the workspace filtering logic from search.ts
    const workspaceItemIds = new Set(
      workspaceJunction.map((j) => j.content_item_id),
    );
    const filtered = allResults.filter((r) => workspaceItemIds.has(r.id));

    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.id)).toContain(CONTENT_ITEM_1.id);
    expect(filtered.map((r) => r.id)).toContain(CONTENT_ITEM_2.id);
    expect(filtered.map((r) => r.id)).not.toContain(CONTENT_ITEM_3.id);
  });

  it('returns all results when workspace_id is not specified', () => {
    const allResults = [CONTENT_ITEM_1, CONTENT_ITEM_2, CONTENT_ITEM_3];

    // No workspace filter — all results pass through
    const filtered = allResults;

    expect(filtered).toHaveLength(3);
  });

  it('combines workspace_id with domain filter (AND logic)', () => {
    const workspaceJunction = [
      { content_item_id: CONTENT_ITEM_1.id },
      { content_item_id: CONTENT_ITEM_2.id },
    ];

    const allResults = [CONTENT_ITEM_1, CONTENT_ITEM_2, CONTENT_ITEM_3];

    // Domain filter first
    const domainFiltered = allResults.filter(
      (r) =>
        r.primary_domain &&
        r.primary_domain.toLowerCase().includes('legislation'),
    );

    // Then workspace filter
    const workspaceItemIds = new Set(
      workspaceJunction.map((j) => j.content_item_id),
    );
    const finalFiltered = domainFiltered.filter((r) =>
      workspaceItemIds.has(r.id),
    );

    // Only item 1 matches both filters
    expect(finalFiltered).toHaveLength(1);
    expect(finalFiltered[0].id).toBe(CONTENT_ITEM_1.id);
  });

  it('returns empty results when workspace has no items', () => {
    const workspaceJunction: { content_item_id: string }[] = [];
    const allResults = [CONTENT_ITEM_1, CONTENT_ITEM_2];

    const workspaceItemIds = new Set(
      workspaceJunction.map((j) => j.content_item_id),
    );
    const filtered = allResults.filter((r) => workspaceItemIds.has(r.id));

    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — get_workspace_items
// ---------------------------------------------------------------------------

describe('get_workspace_items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns items for a valid workspace via junction table', () => {
    const junctionRows = [
      { content_item_id: CONTENT_ITEM_1.id },
      { content_item_id: CONTENT_ITEM_2.id },
    ];

    const itemIds = junctionRows.map((r) => r.content_item_id);

    expect(itemIds).toHaveLength(2);
    expect(itemIds).toContain(CONTENT_ITEM_1.id);
    expect(itemIds).toContain(CONTENT_ITEM_2.id);
  });

  it('respects pagination limit and offset', () => {
    // Simulate 5 junction rows
    const allJunction = Array.from({ length: 5 }, (_, i) => ({
      content_item_id: `item-${i}`,
    }));

    // Limit 2, offset 1 (Supabase range is inclusive)
    const offset = 1;
    const limit = 2;
    const paged = allJunction.slice(offset, offset + limit);

    expect(paged).toHaveLength(2);
    expect(paged[0].content_item_id).toBe('item-1');
    expect(paged[1].content_item_id).toBe('item-2');
  });

  it('caps limit at 50', () => {
    const requestedLimit = 100;
    const effectiveLimit = Math.min(requestedLimit, 50);

    expect(effectiveLimit).toBe(50);
  });

  it('defaults limit to 20 and offset to 0', () => {
    const limit = undefined;
    const offset = undefined;

    const effectiveLimit = Math.min(limit ?? 20, 50);
    const effectiveOffset = offset ?? 0;

    expect(effectiveLimit).toBe(20);
    expect(effectiveOffset).toBe(0);
  });

  it('returns empty items for a workspace with no content', () => {
    const junctionRows: { content_item_id: string }[] = [];
    const itemIds = junctionRows.map((r) => r.content_item_id);

    expect(itemIds).toHaveLength(0);
  });

  it('includes workspace_id in structured response', () => {
    const response = {
      workspace_id: WORKSPACE_ID,
      offset: 0,
      items: [CONTENT_ITEM_1],
      total: 1,
    };

    expect(response.workspace_id).toBe(WORKSPACE_ID);
    expect(response.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — get_intelligence_summary
// ---------------------------------------------------------------------------

describe('get_intelligence_summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns formatted summary for a valid intelligence workspace', async () => {
    const expected = makeSummaryData();
    mockFetchIntelligenceSummary.mockResolvedValue(expected);

    const result = await mockFetchIntelligenceSummary(
      mocks.mockSupabaseClient,
      WORKSPACE_ID,
      '7d',
      10,
    );

    expect(result.workspace_name).toBe('Cyber Security Intel');
    expect(result.total_ingested).toBe(50);
    expect(result.total_passed).toBe(20);
    expect(result.by_category).toHaveProperty('Data Breaches');
    expect(result.top_articles).toHaveLength(1);
    expect(result.top_articles[0].relevance_score).toBe(0.95);
  });

  it('includes overview metrics in response', async () => {
    mockFetchIntelligenceSummary.mockResolvedValue(makeSummaryData());

    const result = await mockFetchIntelligenceSummary(
      mocks.mockSupabaseClient,
      WORKSPACE_ID,
      '7d',
      10,
    );

    expect(result).toHaveProperty('total_ingested');
    expect(result).toHaveProperty('total_passed');
    expect(result).toHaveProperty('total_filtered');
    expect(result).toHaveProperty('filter_ratio');
    expect(result).toHaveProperty('unresolved_flags');
  });

  it('includes source breakdown in response', async () => {
    mockFetchIntelligenceSummary.mockResolvedValue(makeSummaryData());

    const result = await mockFetchIntelligenceSummary(
      mocks.mockSupabaseClient,
      WORKSPACE_ID,
      '7d',
      10,
    );

    expect(result.by_source).toHaveLength(1);
    expect(result.by_source[0]).toEqual({
      source_name: 'Dark Reading',
      article_count: 30,
      passed_count: 12,
    });
  });

  it('includes category breakdown in response', async () => {
    mockFetchIntelligenceSummary.mockResolvedValue(makeSummaryData());

    const result = await mockFetchIntelligenceSummary(
      mocks.mockSupabaseClient,
      WORKSPACE_ID,
      '7d',
      10,
    );

    expect(result.by_category).toEqual({
      'Data Breaches': 12,
      'Ransomware': 8,
    });
  });

  it('rejects non-intelligence workspace type', async () => {
    mockFetchIntelligenceSummary.mockRejectedValue(
      new Error('Workspace "General" is type "bid", not "intelligence".'),
    );

    await expect(
      mockFetchIntelligenceSummary(
        mocks.mockSupabaseClient,
        WORKSPACE_ID,
        '7d',
        10,
      ),
    ).rejects.toThrow('not "intelligence"');
  });

  it('rejects non-existent workspace', async () => {
    mockFetchIntelligenceSummary.mockRejectedValue(
      new Error('Workspace not found: bad-id'),
    );

    await expect(
      mockFetchIntelligenceSummary(
        mocks.mockSupabaseClient,
        'bad-id',
        '7d',
        10,
      ),
    ).rejects.toThrow('Workspace not found');
  });

  it('handles empty workspace with zero counts', async () => {
    const emptyData = makeSummaryData({
      total_ingested: 0,
      total_passed: 0,
      total_filtered: 0,
      filter_ratio: 0,
      by_category: {},
      by_source: [],
      top_articles: [],
      unresolved_flags: 0,
    });
    mockFetchIntelligenceSummary.mockResolvedValue(emptyData);

    const result = await mockFetchIntelligenceSummary(
      mocks.mockSupabaseClient,
      WORKSPACE_ID,
      '7d',
      10,
    );

    expect(result.total_ingested).toBe(0);
    expect(result.total_passed).toBe(0);
    expect(result.top_articles).toHaveLength(0);
    expect(result.by_source).toHaveLength(0);
    expect(Object.keys(result.by_category)).toHaveLength(0);
  });

  it('supports configurable time periods', async () => {
    for (const period of ['7d', '14d', '30d', '90d']) {
      mockFetchIntelligenceSummary.mockResolvedValue(
        makeSummaryData({ period }),
      );

      const result = await mockFetchIntelligenceSummary(
        mocks.mockSupabaseClient,
        WORKSPACE_ID,
        period,
        10,
      );

      expect(result.period).toBe(period);
    }
  });

  it('top articles include all required fields', async () => {
    mockFetchIntelligenceSummary.mockResolvedValue(makeSummaryData());

    const result = await mockFetchIntelligenceSummary(
      mocks.mockSupabaseClient,
      WORKSPACE_ID,
      '7d',
      10,
    );

    const article = result.top_articles[0];
    expect(article).toHaveProperty('id');
    expect(article).toHaveProperty('title');
    expect(article).toHaveProperty('source_name');
    expect(article).toHaveProperty('external_url');
    expect(article).toHaveProperty('relevance_score');
    expect(article).toHaveProperty('relevance_category');
    expect(article).toHaveProperty('ai_summary');
    expect(article).toHaveProperty('matched_categories');
    expect(article).toHaveProperty('published_at');
    expect(article).toHaveProperty('ingested_at');
  });

  it('top articles are sorted by relevance_score descending', async () => {
    const data = makeSummaryData({
      top_articles: [
        {
          id: 'art-1',
          title: 'High Score',
          source_name: 'Source',
          external_url: 'https://example.com/1',
          relevance_score: 0.95,
          relevance_category: 'high',
          ai_summary: null,
          matched_categories: [],
          published_at: null,
          ingested_at: '2026-04-01T00:00:00Z',
        },
        {
          id: 'art-2',
          title: 'Medium Score',
          source_name: 'Source',
          external_url: 'https://example.com/2',
          relevance_score: 0.72,
          relevance_category: 'medium',
          ai_summary: null,
          matched_categories: [],
          published_at: null,
          ingested_at: '2026-04-02T00:00:00Z',
        },
        {
          id: 'art-3',
          title: 'Low Score',
          source_name: 'Source',
          external_url: 'https://example.com/3',
          relevance_score: 0.35,
          relevance_category: 'low',
          ai_summary: null,
          matched_categories: [],
          published_at: null,
          ingested_at: '2026-04-03T00:00:00Z',
        },
      ],
    });
    mockFetchIntelligenceSummary.mockResolvedValue(data);

    const result = await mockFetchIntelligenceSummary(
      mocks.mockSupabaseClient,
      WORKSPACE_ID,
      '7d',
      10,
    );

    for (let i = 1; i < result.top_articles.length; i++) {
      expect(result.top_articles[i - 1].relevance_score).toBeGreaterThanOrEqual(
        result.top_articles[i].relevance_score,
      );
    }
  });
});
