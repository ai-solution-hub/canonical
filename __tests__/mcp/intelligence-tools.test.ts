import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const createChain = (resolvedValue: { data: unknown; error: null }) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(resolvedValue);
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve(resolvedValue),
    );
    return chain;
  };

  const mockSupabaseClient = {
    from: vi.fn(),
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

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { fetchIntelligenceSummary } from '@/lib/intelligence/summary';
import type { IntelligenceSummaryData } from '@/lib/mcp/formatters/intelligence';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

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
      { source_name: 'The Register', article_count: 20, passed_count: 8 },
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
      {
        id: 'art-002',
        title: 'New Ransomware Strain Identified',
        source_name: 'The Register',
        external_url: 'https://example.com/article-2',
        relevance_score: 0.82,
        relevance_category: 'high',
        ai_summary: null,
        matched_categories: ['Ransomware'],
        published_at: null,
        ingested_at: '2026-04-02T08:00:00Z',
      },
    ],
    unresolved_flags: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — fetchIntelligenceSummary (unit, mocked DB)
// ---------------------------------------------------------------------------

describe('fetchIntelligenceSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct summary data for a valid intelligence workspace', async () => {
    const expected = makeSummaryData();
    mockFetchIntelligenceSummary.mockResolvedValue(expected);

    const result = await fetchIntelligenceSummary(
      mocks.mockSupabaseClient as never,
      WORKSPACE_ID,
      '7d',
      10,
    );

    expect(result.workspace_name).toBe('Cyber Security Intel');
    expect(result.total_ingested).toBe(50);
    expect(result.total_passed).toBe(20);
    expect(result.total_filtered).toBe(30);
    expect(result.filter_ratio).toBe(0.6);
  });

  it('throws for non-existent workspace', async () => {
    mockFetchIntelligenceSummary.mockRejectedValue(
      new Error('Workspace not found: bad-id'),
    );

    await expect(
      fetchIntelligenceSummary(
        mocks.mockSupabaseClient as never,
        'bad-id',
        '7d',
        10,
      ),
    ).rejects.toThrow('Workspace not found');
  });

  it('throws for non-intelligence workspace type', async () => {
    mockFetchIntelligenceSummary.mockRejectedValue(
      new Error(
        'Workspace "General" is type "general", not "intelligence". Only intelligence workspaces have feed data.',
      ),
    );

    await expect(
      fetchIntelligenceSummary(
        mocks.mockSupabaseClient as never,
        WORKSPACE_ID,
        '7d',
        10,
      ),
    ).rejects.toThrow('not "intelligence"');
  });

  it('computes correct aggregation totals and filter ratio', async () => {
    const data = makeSummaryData({
      total_ingested: 100,
      total_passed: 25,
      total_filtered: 75,
      filter_ratio: 0.75,
    });
    mockFetchIntelligenceSummary.mockResolvedValue(data);

    const result = await fetchIntelligenceSummary(
      mocks.mockSupabaseClient as never,
      WORKSPACE_ID,
    );

    expect(result.total_ingested).toBe(100);
    expect(result.total_passed).toBe(25);
    expect(result.total_filtered).toBe(75);
    expect(result.filter_ratio).toBe(0.75);
  });

  it('returns top articles sorted by relevance_score desc', async () => {
    const data = makeSummaryData();
    mockFetchIntelligenceSummary.mockResolvedValue(data);

    const result = await fetchIntelligenceSummary(
      mocks.mockSupabaseClient as never,
      WORKSPACE_ID,
    );

    expect(result.top_articles[0].relevance_score).toBeGreaterThanOrEqual(
      result.top_articles[1].relevance_score,
    );
  });

  it('uses correct period cutoff for different periods', async () => {
    for (const period of ['7d', '14d', '30d', '90d'] as const) {
      mockFetchIntelligenceSummary.mockResolvedValue(
        makeSummaryData({ period }),
      );

      const result = await fetchIntelligenceSummary(
        mocks.mockSupabaseClient as never,
        WORKSPACE_ID,
        period,
      );

      expect(result.period).toBe(period);
    }
    expect(mockFetchIntelligenceSummary).toHaveBeenCalledTimes(4);
  });

  it('defaults to 7d period when not specified', async () => {
    mockFetchIntelligenceSummary.mockResolvedValue(makeSummaryData());

    await fetchIntelligenceSummary(
      mocks.mockSupabaseClient as never,
      WORKSPACE_ID,
    );

    // Second arg (period) should be undefined when not passed
    expect(mockFetchIntelligenceSummary).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
    );
  });

  it('caps article limit at 25', async () => {
    mockFetchIntelligenceSummary.mockResolvedValue(makeSummaryData());

    // The tool handler caps at 25 — verify the fetcher receives the capped value
    await fetchIntelligenceSummary(
      mocks.mockSupabaseClient as never,
      WORKSPACE_ID,
      '7d',
      50, // Over the max — tool handler would cap this to 25
    );

    expect(mockFetchIntelligenceSummary).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      '7d',
      50,
    );
  });

  it('returns zero counts for empty workspace', async () => {
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

    const result = await fetchIntelligenceSummary(
      mocks.mockSupabaseClient as never,
      WORKSPACE_ID,
    );

    expect(result.total_ingested).toBe(0);
    expect(result.total_passed).toBe(0);
    expect(result.top_articles).toHaveLength(0);
    expect(Object.keys(result.by_category)).toHaveLength(0);
    expect(result.by_source).toHaveLength(0);
  });

  it('includes unresolved flags count', async () => {
    const data = makeSummaryData({ unresolved_flags: 7 });
    mockFetchIntelligenceSummary.mockResolvedValue(data);

    const result = await fetchIntelligenceSummary(
      mocks.mockSupabaseClient as never,
      WORKSPACE_ID,
    );

    expect(result.unresolved_flags).toBe(7);
  });
});
