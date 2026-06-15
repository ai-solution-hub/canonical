import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatQualityBriefing } from '@/lib/mcp/formatters/briefing';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Build a chainable mock that supports .from().select().is().not().eq().order().limit()
  // Each chained call returns `this` until the promise is resolved.
  const createChain = (resolvedValue: { data: unknown[]; error: null }) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.not = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve(resolvedValue),
    );
    return chain;
  };

  const defaultChain = createChain({ data: [], error: null });

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(defaultChain),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    _chain: defaultChain,
    _createChain: createChain,
  };

  return {
    mockSupabaseClient,
    defaultChain,
    createChain,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
    /** Reset from() to default empty-data chain */
    resetFrom() {
      const fresh = createChain({ data: [], error: null });
      mockSupabaseClient.from.mockReturnValue(fresh);
      mockSupabaseClient._chain = fresh;
    },
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
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

// Mock ext-apps server (needed by registerResources for app resources)
vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppResource: vi.fn(),
  RESOURCE_MIME_TYPE: 'text/html',
}));

// Mock app-bundles (lazy loaded by registerResources)
vi.mock('@/lib/mcp/app-bundles', () => ({
  COVERAGE_MATRIX_HTML: '',
  FORM_DASHBOARD_HTML: '',
  REORIENT_ME_HTML: '',
}));

// ---------------------------------------------------------------------------
// Mock McpServer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests: formatQualityBriefing
// ---------------------------------------------------------------------------

describe('formatQualityBriefing', () => {
  it('formats a complete briefing with all 6 sections', async () => {
    const data = {
      below_threshold: [
        {
          id: 'item-1',
          title: 'Outdated Policy',
          suggested_title: null,
          primary_domain: 'Compliance',
          primary_subtopic: 'GDPR',
          quality_score: 25,
          freshness: 'expired',
          summary: null,
          classification_confidence: 0.4,
        },
      ],
      score_drops: [
        {
          id: 'item-2',
          title: null,
          suggested_title: 'Dropping Item',
          primary_domain: 'Operations',
          quality_score: 35,
          previous_quality_score: 70,
        },
      ],
      freshness_transitions: [
        {
          id: 'item-3',
          title: 'Ageing Article',
          suggested_title: null,
          primary_domain: 'Security',
          freshness: 'stale',
          previous_freshness: 'ageing',
        },
      ],
      quality_flags: [
        {
          id: 'flag-1',
          type: 'quality_flag',
          message: 'Low quality score detected',
          created_at: '2026-03-20T10:00:00Z',
          entity_id: 'item-1',
        },
      ],
      coverage_alerts: [
        {
          id: 'alert-1',
          type: 'coverage_alert',
          message: 'Zero fresh items in Compliance domain',
          created_at: '2026-03-19T08:00:00Z',
        },
      ],
      certification_warnings: [
        {
          canonical_name: 'ISO 27001',
          entity_type: 'certification',
          expiry_date: '2026-04-01T00:00:00Z',
          status: 'expiring_soon',
        },
      ],
      generated_at: '2026-03-22T12:00:00Z',
    };

    const result = formatQualityBriefing(data);

    // Check header
    expect(result).toContain('# Quality Briefing');
    expect(result).toContain('**Generated:**');

    // Check all 6 sections are present
    expect(result).toContain('## Items Below Quality Threshold');
    expect(result).toContain('## Quality Score Drops');
    expect(result).toContain('## Freshness Transitions');
    expect(result).toContain('## Outstanding Quality Flags');
    expect(result).toContain('## Coverage Alerts');
    expect(result).toContain('## Certification Warnings');

    // Check below-threshold item details
    expect(result).toContain('"Outdated Policy" (Score: 25)');
    expect(result).toContain('Compliance > GDPR');
    expect(result).toContain('freshness expired');
    expect(result).toContain('no summary');
    expect(result).toContain('low confidence (40%)');

    // Check score drop details
    expect(result).toContain('"Dropping Item"');
    expect(result).toContain('70 -> 35');
    expect(result).toContain('dropped 35 points');

    // Check freshness transition
    expect(result).toContain('"Ageing Article"');
    expect(result).toContain('ageing -> stale');

    // Check quality flag
    expect(result).toContain('Low quality score detected');

    // Check coverage alert
    expect(result).toContain('Zero fresh items in Compliance domain');

    // Check certification warning
    expect(result).toContain('ISO 27001');
    expect(result).toContain('EXPIRING SOON');
  });

  it('formats empty briefing with sensible defaults', async () => {
    const emptyData = {
      below_threshold: [],
      score_drops: [],
      freshness_transitions: [],
      quality_flags: [],
      coverage_alerts: [],
      certification_warnings: [],
      generated_at: '2026-03-22T12:00:00Z',
    };

    const result = formatQualityBriefing(emptyData);

    expect(result).toContain('# Quality Briefing');
    expect(result).toContain('No items currently below the quality threshold.');
    expect(result).toContain('No quality score drops detected.');
    expect(result).toContain('No freshness transitions detected.');
    expect(result).toContain('No outstanding quality flags.');
    expect(result).toContain('No active coverage alerts.');
    expect(result).toContain('No certification warnings.');
  });

  it('uses suggested_title when title is null', async () => {
    const data = {
      below_threshold: [
        {
          id: 'item-1',
          title: null,
          suggested_title: 'Suggested Name',
          primary_domain: 'Operations',
          primary_subtopic: null,
          quality_score: 15,
          freshness: 'fresh',
          summary: 'Has summary',
          classification_confidence: 0.9,
        },
      ],
      score_drops: [],
      freshness_transitions: [],
      quality_flags: [],
      coverage_alerts: [],
      certification_warnings: [],
      generated_at: '2026-03-22T12:00:00Z',
    };

    const result = formatQualityBriefing(data);
    expect(result).toContain('"Suggested Name"');
    // Domain without subtopic should show just domain
    expect(result).toContain('**Domain:** Operations');
  });
});

// ---------------------------------------------------------------------------
// Tests: fetchQualityBriefingData shared function
// ---------------------------------------------------------------------------

describe('fetchQualityBriefingData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetFrom();
  });

  it('returns all 6 data sections with empty database', async () => {
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');
    const result = await fetchQualityBriefingData(
      mocks.mockSupabaseClient as never,
    );

    expect(result.below_threshold).toEqual([]);
    expect(result.score_drops).toEqual([]);
    expect(result.freshness_transitions).toEqual([]);
    expect(result.quality_flags).toEqual([]);
    expect(result.coverage_alerts).toEqual([]);
    expect(result.certification_warnings).toEqual([]);
    expect(result.generated_at).toBeDefined();
  });

  it('applies domain filter when provided', async () => {
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    const eqCalls: Array<[string, string]> = [];
    mocks.mockSupabaseClient.from.mockImplementation(() => {
      const chain = mocks.createChain({ data: [], error: null });
      const originalEq = chain.eq as (...a: unknown[]) => unknown;
      chain.eq = vi.fn((...args: unknown[]) => {
        eqCalls.push(args as [string, string]);
        return originalEq(...args);
      });
      return chain;
    });

    await fetchQualityBriefingData(mocks.mockSupabaseClient as never, {
      domain: 'Security',
    });

    const domainFilters = eqCalls.filter(
      ([col, val]) => col === 'primary_domain' && val === 'Security',
    );
    expect(domainFilters.length).toBeGreaterThanOrEqual(3);
  });

  it('uses threshold override for below-threshold filtering', async () => {
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    const fromCallIndex = { value: 0 };
    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'content_items' && fromCallIndex.value === 0) {
        fromCallIndex.value++;
        return mocks.createChain({
          data: [
            {
              id: 'item-1',
              title: 'Score 55',
              suggested_title: null,
              primary_domain: 'Ops',
              primary_subtopic: null,
              quality_score: 55,
              freshness: 'fresh',
              summary: 'Yes',
              classification_confidence: 0.8,
            },
            {
              id: 'item-2',
              title: 'Score 25',
              suggested_title: null,
              primary_domain: 'Ops',
              primary_subtopic: null,
              quality_score: 25,
              freshness: 'stale',
              summary: null,
              classification_confidence: 0.3,
            },
          ],
          error: null,
        });
      }
      return mocks.createChain({ data: [], error: null });
    });

    const result = await fetchQualityBriefingData(
      mocks.mockSupabaseClient as never,
      { threshold: 60 },
    );

    expect(result.below_threshold.length).toBe(2);
    expect(
      result.below_threshold.some((item) => item.quality_score === 55),
    ).toBe(true);
    expect(
      result.below_threshold.some((item) => item.quality_score === 25),
    ).toBe(true);
  });

  it('processes score drops and sorts by magnitude', async () => {
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    const fromCallIndex = { value: 0 };
    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'content_items') {
        const callNum = fromCallIndex.value++;
        if (callNum === 1) {
          // score drops query (second content_items call)
          return mocks.createChain({
            data: [
              {
                id: 'item-a',
                title: 'Small Drop',
                suggested_title: null,
                primary_domain: 'Ops',
                quality_score: 60,
                previous_quality_score: 70,
              },
              {
                id: 'item-b',
                title: 'Big Drop',
                suggested_title: null,
                primary_domain: 'Ops',
                quality_score: 20,
                previous_quality_score: 80,
              },
            ],
            error: null,
          });
        }
      }
      return mocks.createChain({ data: [], error: null });
    });

    const result = await fetchQualityBriefingData(
      mocks.mockSupabaseClient as never,
    );

    expect(result.score_drops.length).toBe(2);
    // Big drop (60 points) should come first
    expect(result.score_drops[0].id).toBe('item-b');
    expect(result.score_drops[1].id).toBe('item-a');
  });

  it('deduplicates certification warnings by canonical_name', async () => {
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'entity_mentions') {
        return mocks.createChain({
          data: [
            {
              canonical_name: 'ISO 27001',
              entity_type: 'certification',
              metadata: { expiry_date: '2020-01-01T00:00:00Z' },
            },
            {
              canonical_name: 'ISO 27001',
              entity_type: 'certification',
              metadata: { expiry_date: '2020-06-01T00:00:00Z' },
            },
          ],
          error: null,
        });
      }
      return mocks.createChain({ data: [], error: null });
    });

    const result = await fetchQualityBriefingData(
      mocks.mockSupabaseClient as never,
    );

    // Should deduplicate — only 1 warning for ISO 27001
    expect(result.certification_warnings.length).toBe(1);
    expect(result.certification_warnings[0].canonical_name).toBe('ISO 27001');
  });

  it('filters out items where freshness has not changed', async () => {
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    const fromCallIndex = { value: 0 };
    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'content_items') {
        const callNum = fromCallIndex.value++;
        if (callNum === 2) {
          // freshness transitions query (third content_items call)
          return mocks.createChain({
            data: [
              {
                id: 'item-changed',
                title: 'Changed',
                suggested_title: null,
                primary_domain: 'Security',
                freshness: 'stale',
                previous_freshness: 'fresh',
              },
              {
                id: 'item-same',
                title: 'Unchanged',
                suggested_title: null,
                primary_domain: 'Security',
                freshness: 'stale',
                previous_freshness: 'stale',
              },
            ],
            error: null,
          });
        }
      }
      return mocks.createChain({ data: [], error: null });
    });

    const result = await fetchQualityBriefingData(
      mocks.mockSupabaseClient as never,
    );

    // Only the item where freshness actually changed should be included
    expect(result.freshness_transitions.length).toBe(1);
    expect(result.freshness_transitions[0].id).toBe('item-changed');
  });
});

// ---------------------------------------------------------------------------
// Tests: kb://quality-briefing resource
// ---------------------------------------------------------------------------

describe('kb://quality-briefing resource', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.resetFrom();
    mockServer = createMockMcpServer();
    const { registerResources } = await import('@/lib/mcp/resources');
    await registerResources(
      mockServer.server as unknown as Parameters<typeof registerResources>[0],
    );
  });

  it('registers the quality_briefing resource', () => {
    expect(mockServer.resources['quality_briefing']).toBeDefined();
  });

  it('returns JSON content with all sections', async () => {
    const handler = mockServer.getResourceHandler('quality_briefing');
    if (!handler) {
      throw new Error('quality_briefing resource not registered');
    }

    const result = (await handler(new URL('kb://quality-briefing'), extra)) as {
      contents: Array<{ mimeType: string; text: string }>;
    };

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const parsed = JSON.parse(result.contents[0].text);
    // Should have all 6 data sections + formatted + generated_at
    expect(parsed).toHaveProperty('below_threshold');
    expect(parsed).toHaveProperty('score_drops');
    expect(parsed).toHaveProperty('freshness_transitions');
    expect(parsed).toHaveProperty('quality_flags');
    expect(parsed).toHaveProperty('coverage_alerts');
    expect(parsed).toHaveProperty('certification_warnings');
    expect(parsed).toHaveProperty('formatted');
    expect(parsed).toHaveProperty('generated_at');

    // Formatted should be a markdown string
    expect(parsed.formatted).toContain('# Quality Briefing');
  });

  it('returns populated data with formatted markdown', async () => {
    const handler = mockServer.getResourceHandler('quality_briefing');
    if (!handler) throw new Error('quality_briefing resource not registered');

    // Mock populated data for below-threshold items
    const fromCallIndex = { value: 0 };
    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'content_items' && fromCallIndex.value === 0) {
        fromCallIndex.value++;
        return mocks.createChain({
          data: [
            {
              id: 'item-low',
              title: 'Low Quality Article',
              suggested_title: null,
              primary_domain: 'Security',
              primary_subtopic: 'access-control',
              quality_score: 25,
              freshness: 'expired',
              summary: null,
              classification_confidence: 0.4,
            },
          ],
          error: null,
        });
      }
      return mocks.createChain({ data: [], error: null });
    });

    const result = (await handler(new URL('kb://quality-briefing'), extra)) as {
      contents: Array<{ mimeType: string; text: string }>;
    };

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.below_threshold).toHaveLength(1);
    expect(parsed.below_threshold[0].id).toBe('item-low');
    expect(parsed.formatted).toContain('Low Quality Article');
  });

  it('handles errors gracefully', async () => {
    // Make all queries fail
    mocks.mockSupabaseClient.from.mockImplementation(() => {
      throw new Error('Connection refused');
    });

    const handler = mockServer.getResourceHandler('quality_briefing');
    if (!handler) {
      throw new Error('quality_briefing resource not registered');
    }

    const result = (await handler(new URL('kb://quality-briefing'), extra)) as {
      contents: Array<{ mimeType: string; text: string }>;
    };

    expect(result.contents[0].mimeType).toBe('text/plain');
    expect(result.contents[0].text).toContain(
      'Error generating quality briefing',
    );
  });
});
