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

  it('displays suggested_title as the item name when title is null', async () => {
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

  it('restricts the freshness section query to the requested domain', async () => {
    // ID-131 (G-MCP-REPOINT): only the freshness leg is domain-filterable
    // now (below_threshold/score_drops are retired — see below). The
    // domain `.eq()` lands on the source_documents query, which only runs
    // when record_lifecycle has at least one matching facet row.
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    const eqCalls: Array<[string, string]> = [];
    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'record_lifecycle') {
        return mocks.createChain({
          data: [
            {
              source_document_id: 'sd-1',
              freshness: 'stale',
              previous_freshness: 'fresh',
            },
          ],
          error: null,
        });
      }
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
    expect(domainFilters.length).toBeGreaterThanOrEqual(1);
  });

  it('below_threshold is always empty — quality_score has no typed home post-ID-131', async () => {
    // content_items.quality_score had no successor on source_documents or
    // the record_lifecycle facet (derived-not-stored, BI-11/20) — the leg
    // is retired rather than re-pointed. `threshold` is accordingly a no-op.
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    const result = await fetchQualityBriefingData(
      mocks.mockSupabaseClient as never,
      { threshold: 60 },
    );

    expect(result.below_threshold).toEqual([]);
  });

  it('score_drops is always empty — quality_score has no typed home post-ID-131', async () => {
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    const result = await fetchQualityBriefingData(
      mocks.mockSupabaseClient as never,
    );

    expect(result.score_drops).toEqual([]);
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
    // ID-131 (G-MCP-REPOINT): freshness/previous_freshness now come from
    // the record_lifecycle facet; title/domain context is joined from
    // source_documents by source_document_id.
    const { fetchQualityBriefingData } = await import('@/lib/mcp/tools/shared');

    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'record_lifecycle') {
        return mocks.createChain({
          data: [
            {
              source_document_id: 'sd-changed',
              freshness: 'stale',
              previous_freshness: 'fresh',
            },
            {
              source_document_id: 'sd-same',
              freshness: 'stale',
              previous_freshness: 'stale',
            },
          ],
          error: null,
        });
      }
      if (tableName === 'source_documents') {
        return mocks.createChain({
          data: [
            {
              id: 'sd-changed',
              suggested_title: 'Changed',
              primary_domain: 'Security',
              archived_at: null,
            },
            {
              id: 'sd-same',
              suggested_title: 'Unchanged',
              primary_domain: 'Security',
              archived_at: null,
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

    // Only the item where freshness actually changed should be included
    expect(result.freshness_transitions.length).toBe(1);
    expect(result.freshness_transitions[0].id).toBe('sd-changed');
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
    // ID-131 (G-MCP-REPOINT): below_threshold can no longer be populated
    // (quality_score has no typed home, BI-11/20) — populate the
    // freshness_transitions leg instead (record_lifecycle facet joined to
    // source_documents) to exercise the same "populated data renders in
    // markdown" behaviour.
    const handler = mockServer.getResourceHandler('quality_briefing');
    if (!handler) throw new Error('quality_briefing resource not registered');

    mocks.mockSupabaseClient.from.mockImplementation((tableName: string) => {
      if (tableName === 'record_lifecycle') {
        return mocks.createChain({
          data: [
            {
              source_document_id: 'item-stale',
              freshness: 'stale',
              previous_freshness: 'fresh',
            },
          ],
          error: null,
        });
      }
      if (tableName === 'source_documents') {
        return mocks.createChain({
          data: [
            {
              id: 'item-stale',
              suggested_title: 'Ageing Access Policy',
              primary_domain: 'Security',
              archived_at: null,
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
    expect(parsed.freshness_transitions).toHaveLength(1);
    expect(parsed.freshness_transitions[0].id).toBe('item-stale');
    expect(parsed.formatted).toContain('Ageing Access Policy');
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
