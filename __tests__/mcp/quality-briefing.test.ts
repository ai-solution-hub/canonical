import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(resolvedValue));
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
vi.mock('@/lib/ai/embed', () => ({ generateEmbedding: vi.fn() }));
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
  BID_DASHBOARD_HTML: '',
  REORIENT_ME_HTML: '',
}));

// ---------------------------------------------------------------------------
// Mock McpServer
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
type ResourceHandler = (...args: unknown[]) => Promise<unknown>;

function createMockMcpServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  const resources: Record<string, { handler: ResourceHandler }> = {};

  return {
    tools,
    resources,
    registerTool(name: string, _config: Record<string, unknown>, handler: ToolHandler) {
      tools[name] = { handler };
    },
    // Handle both static resource (4 args) and template resource (4 args with template)
    registerResource(
      name: string,
      _uriOrTemplate: unknown,
      _metadata: unknown,
      handler: ResourceHandler,
    ) {
      resources[name] = { handler };
    },
    getHandler(name: string): ToolHandler | undefined {
      return tools[name]?.handler;
    },
    getResourceHandler(name: string): ResourceHandler | undefined {
      return resources[name]?.handler;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: formatQualityBriefing
// ---------------------------------------------------------------------------

describe('formatQualityBriefing', () => {
  it('formats a complete briefing with all 6 sections', async () => {
    const { formatQualityBriefing } = await import('@/lib/mcp/formatters/briefing');

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
          ai_summary: null,
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
    const { formatQualityBriefing } = await import('@/lib/mcp/formatters/briefing');

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
    const { formatQualityBriefing } = await import('@/lib/mcp/formatters/briefing');

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
          ai_summary: 'Has summary',
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
// Tests: get_quality_briefing tool
// ---------------------------------------------------------------------------

describe('get_quality_briefing tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset from() to default empty-data chain after clearAllMocks
    mocks.resetFrom();
    mockServer = createMockMcpServer();
    const { registerQualityTools } = await import('@/lib/mcp/tools/quality');
    await registerQualityTools(mockServer as unknown as Parameters<typeof registerQualityTools>[0]);
  });

  it('registers the get_quality_briefing tool', () => {
    expect(mockServer.tools['get_quality_briefing']).toBeDefined();
  });

  it('returns briefing with all 6 sections when data exists', async () => {
    const handler = mockServer.getHandler('get_quality_briefing')!;

    // Mock .from() to return different data based on the table name
    const fromCallIndex = { value: 0 };
    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'content_items') {
        const callNum = fromCallIndex.value++;
        if (callNum === 0) {
          // below-threshold query
          return mocks.createChain({
            data: [{
              id: 'item-1', title: 'Low Quality', suggested_title: null,
              primary_domain: 'Compliance', primary_subtopic: 'GDPR',
              quality_score: 20, freshness: 'expired', ai_summary: null,
              classification_confidence: 0.3,
            }],
            error: null,
          });
        } else if (callNum === 1) {
          // score drops query
          return mocks.createChain({
            data: [{
              id: 'item-2', title: 'Dropped', suggested_title: null,
              primary_domain: 'Operations', quality_score: 30,
              previous_quality_score: 60,
            }],
            error: null,
          });
        } else {
          // freshness transitions query
          return mocks.createChain({
            data: [{
              id: 'item-3', title: 'Staling', suggested_title: null,
              primary_domain: 'Security', freshness: 'stale',
              previous_freshness: 'ageing',
            }],
            error: null,
          });
        }
      }

      if (tableName === 'notifications') {
        return mocks.createChain({
          data: [{
            id: 'notif-1', type: 'quality_flag', message: 'Test flag',
            created_at: '2026-03-20T10:00:00Z', entity_id: 'item-1',
          }],
          error: null,
        });
      }

      if (tableName === 'entity_mentions') {
        return mocks.createChain({
          data: [{
            canonical_name: 'ISO 9001', entity_type: 'certification',
            metadata: { expiry_date: '2020-01-01T00:00:00Z' },
          }],
          error: null,
        });
      }

      if (tableName === 'governance_config') {
        return mocks.createChain({
          data: [{ domain: 'Compliance', quality_score_threshold: 50 }],
          error: null,
        });
      }

      return mocks.createChain({ data: [], error: null });
    });

    const result = await handler({}, extra) as {
      content: Array<{ text: string }>;
      structuredContent: Record<string, unknown>;
    };

    // Should have markdown content
    expect(result.content[0].text).toContain('# Quality Briefing');
    expect(result.content[0].text).toContain('Items Below Quality Threshold');
    expect(result.content[0].text).toContain('Quality Score Drops');
    expect(result.content[0].text).toContain('Freshness Transitions');
    expect(result.content[0].text).toContain('Outstanding Quality Flags');
    expect(result.content[0].text).toContain('Coverage Alerts');
    expect(result.content[0].text).toContain('Certification Warnings');

    // Should have structured content
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent.generated_at).toBeDefined();
  });

  it('returns empty briefing for empty database', async () => {
    const handler = mockServer.getHandler('get_quality_briefing')!;

    // Explicitly ensure from() returns empty data (reset already done in beforeEach)
    const result = await handler({}, extra) as {
      content: Array<{ text: string }>;
      structuredContent: Record<string, unknown>;
    };

    expect(result.content[0].text).toContain('# Quality Briefing');
    expect(result.content[0].text).toContain('No items currently below the quality threshold.');
    expect(result.content[0].text).toContain('No quality score drops detected.');

    // Structured content should have empty arrays
    const sc = result.structuredContent;
    expect(sc.below_threshold).toEqual([]);
    expect(sc.score_drops).toEqual([]);
    expect(sc.freshness_transitions).toEqual([]);
    expect(sc.quality_flags).toEqual([]);
    expect(sc.coverage_alerts).toEqual([]);
    expect(sc.certification_warnings).toEqual([]);
  });

  it('filters by domain when provided', async () => {
    const handler = mockServer.getHandler('get_quality_briefing')!;

    // Track eq calls to verify domain filter is applied
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

    await handler({ domain: 'Compliance' }, extra);

    // Should have domain filter eq calls for the 3 content_items queries
    const domainFilters = eqCalls.filter(([col, val]) => col === 'primary_domain' && val === 'Compliance');
    expect(domainFilters.length).toBeGreaterThanOrEqual(3);
  });

  it('uses threshold parameter when provided', async () => {
    const handler = mockServer.getHandler('get_quality_briefing')!;

    // Return items with various scores
    const fromCallIndex = { value: 0 };
    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'content_items' && fromCallIndex.value === 0) {
        fromCallIndex.value++;
        return mocks.createChain({
          data: [
            {
              id: 'item-1', title: 'Score 55', suggested_title: null,
              primary_domain: 'Ops', primary_subtopic: null,
              quality_score: 55, freshness: 'fresh', ai_summary: 'Yes',
              classification_confidence: 0.8,
            },
            {
              id: 'item-2', title: 'Score 25', suggested_title: null,
              primary_domain: 'Ops', primary_subtopic: null,
              quality_score: 25, freshness: 'stale', ai_summary: null,
              classification_confidence: 0.3,
            },
          ],
          error: null,
        });
      }
      return mocks.createChain({ data: [], error: null });
    });

    // With threshold 60, item with score 55 should be below threshold
    const result = await handler({ threshold: 60 }, extra) as {
      content: Array<{ text: string }>;
      structuredContent: { below_threshold: Array<{ quality_score: number }> };
    };

    const belowThreshold = result.structuredContent.below_threshold;
    // Both items (55 and 25) are below threshold of 60
    expect(belowThreshold.length).toBe(2);
    expect(belowThreshold.some((item: { quality_score: number }) => item.quality_score === 55)).toBe(true);
    expect(belowThreshold.some((item: { quality_score: number }) => item.quality_score === 25)).toBe(true);
  });

  it('excludes archived items (query uses is archived_at null)', async () => {
    const handler = mockServer.getHandler('get_quality_briefing')!;

    const isCalls: Array<[string, unknown]> = [];
    mocks.mockSupabaseClient.from.mockImplementation(() => {
      const chain = mocks.createChain({ data: [], error: null });
      const originalIs = chain.is as (...a: unknown[]) => unknown;
      chain.is = vi.fn((...args: unknown[]) => {
        isCalls.push(args as [string, unknown]);
        return originalIs(...args);
      });
      return chain;
    });

    await handler({}, extra);

    // All content_items queries should filter archived_at IS NULL
    const archivedFilters = isCalls.filter(([col]) => col === 'archived_at');
    expect(archivedFilters.length).toBeGreaterThanOrEqual(3);
    for (const [, val] of archivedFilters) {
      expect(val).toBeNull();
    }
  });

  it('handles error gracefully', async () => {
    const handler = mockServer.getHandler('get_quality_briefing')!;

    // Make first query throw
    mocks.mockSupabaseClient.from.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const result = await handler({}, extra) as {
      content: Array<{ text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Quality briefing failed');
    expect(result.content[0].text).toContain('Database connection failed');
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
    await registerResources(mockServer as unknown as Parameters<typeof registerResources>[0]);
  });

  it('registers the quality_briefing resource', () => {
    expect(mockServer.resources['quality_briefing']).toBeDefined();
  });

  it('returns JSON content with all sections', async () => {
    const handler = mockServer.getResourceHandler('quality_briefing');
    if (!handler) {
      throw new Error('quality_briefing resource not registered');
    }

    const result = await handler(
      new URL('kb://quality-briefing'),
      extra,
    ) as { contents: Array<{ mimeType: string; text: string }> };

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

  it('handles errors gracefully', async () => {
    // Make all queries fail
    mocks.mockSupabaseClient.from.mockImplementation(() => {
      throw new Error('Connection refused');
    });

    const handler = mockServer.getResourceHandler('quality_briefing');
    if (!handler) {
      throw new Error('quality_briefing resource not registered');
    }

    const result = await handler(
      new URL('kb://quality-briefing'),
      extra,
    ) as { contents: Array<{ mimeType: string; text: string }> };

    expect(result.contents[0].mimeType).toBe('text/plain');
    expect(result.contents[0].text).toContain('Error generating quality briefing');
  });
});
