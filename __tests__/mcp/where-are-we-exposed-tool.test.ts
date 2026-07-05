import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// ID-71.8 (B-INV-4 / B-INV-29 / M29 / M4 / M37) — ONE `where_are_we_exposed`
// outcome consolidates the prior exposure / freshness / coverage / quality /
// certification reads into a four-layer consumption framing:
//
//   data you have → how you could use it today → the gaps →
//   the opportunities
//
// ID-131.19 (S450 Wave 1, owner-ruled): the former "its quality" layer (fed
// solely by the `get_quality_issue_counts` RPC) is TRIMMED, not re-pointed —
// that RPC was dropped at M6 and quality-flag needs are already covered
// elsewhere via the get_items_with_quality_flags re-point in lib/reorient.ts.
//
// Gaps surface first-class suggested resolutions (B-INV-4: "Draft content for
// X" / "Discuss options for Y"); `suggest_content_creation` is KEPT as the
// callable resolution affordance the gaps/opportunities layers reference.
//
// The 8 retired exposure reads MUST NOT be registered any longer:
//   get_expiring_content, get_freshness_report (dashboard.ts)
//   get_coverage_gaps, audit_content, get_quality_summary,
//   get_quality_briefing, get_quality_actions (quality.ts)
//   get_certification_status (entities.ts)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // RPC dispatch by name — the four-layer aggregator calls several RPCs.
  // ID-131.19: `get_quality_issue_counts` was dropped at M6 — deliberately
  // NOT stubbed here; a fall-through call would hit `default` and prove the
  // handler no longer depends on it.
  const rpcMock = vi.fn((name: string) => {
    switch (name) {
      case 'get_freshness_breakdown':
        return Promise.resolve({
          data: [
            { freshness: 'fresh', count: 40 },
            { freshness: 'aging', count: 10 },
            { freshness: 'stale', count: 6 },
            { freshness: 'expired', count: 4 },
          ],
          error: null,
        });
      default:
        return Promise.resolve({ data: [], error: null });
    }
  });

  // Generic table chain — taxonomy + content_items reads for the gaps layer
  // and the use-today (certification/entity) layer.
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    const passthrough = ['select', 'eq', 'is', 'not', 'in', 'order', 'lte'];
    for (const m of passthrough) {
      chain[m] = vi.fn(() => chain);
    }
    // Resolve the query when awaited (PostgrestBuilder is thenable).
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return chain;
  }

  const tableRows: Record<string, unknown[]> = {
    taxonomy_domains: [{ id: 'd1', name: 'compliance', display_order: 1 }],
    taxonomy_subtopics: [
      { id: 's1', name: 'iso-27001', domain_id: 'd1', display_order: 1 },
      { id: 's2', name: 'gdpr', domain_id: 'd1', display_order: 2 },
    ],
    content_items: [
      {
        primary_domain: 'compliance',
        primary_subtopic: 'iso-27001',
        freshness: 'fresh',
      },
    ],
    coverage_targets: [],
    entity_relationships: [
      { source_entity: 'acme ltd', target_entity: 'ISO 27001' },
    ],
    entity_mentions: [
      {
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        entity_type_override: null,
        metadata: { expiry_date: '2030-01-01' },
        content_item_id: 'c1',
      },
    ],
  };

  const mockSupabaseClient = {
    from: vi.fn((table: string) => makeChain(tableRows[table] ?? [])),
    rpc: rpcMock,
  };

  return {
    mockSupabaseClient,
    rpcMock,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserRole: vi.fn().mockResolvedValue('admin'),
    generateContentSuggestions: vi.fn().mockResolvedValue([
      {
        title: 'Create a GDPR data-retention policy',
        domain: 'compliance',
        subtopic: 'gdpr',
        priority: 'high',
        suggestion_type: 'empty_subtopic',
        suggested_content_type: 'policy',
        related_template: null,
        item_count: 0,
        freshness_breakdown: null,
        description: 'No content covers GDPR data retention.',
      },
    ]),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: mocks.getMcpUserRole,
}));

vi.mock('@/lib/content/content-suggestions', () => ({
  generateContentSuggestions: mocks.generateContentSuggestions,
}));

vi.mock('@/lib/certification-status', () => ({
  deriveExpiryStatus: vi.fn().mockReturnValue('valid'),
}));

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function buildServer() {
  const mockServer = createMockMcpServer();
  const { registerDashboardTools } = await import('@/lib/mcp/tools/dashboard');
  await registerDashboardTools(
    mockServer.server as unknown as Parameters<
      typeof registerDashboardTools
    >[0],
  );
  return mockServer;
}

async function buildAllExposureServers() {
  const mockServer = createMockMcpServer();
  const server = mockServer.server as unknown as Parameters<
    typeof import('@/lib/mcp/tools/dashboard').registerDashboardTools
  >[0];
  const { registerDashboardTools } = await import('@/lib/mcp/tools/dashboard');
  const { registerQualityTools } = await import('@/lib/mcp/tools/quality');
  const { registerEntityTools } = await import('@/lib/mcp/tools/entities');
  await registerDashboardTools(server);
  await registerQualityTools(server);
  await registerEntityTools(server);
  return mockServer;
}

// ---------------------------------------------------------------------------
// Registration + consolidation
// ---------------------------------------------------------------------------

describe('where_are_we_exposed — registration (B-INV-29)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildServer();
  });

  it('registers a single where_are_we_exposed entry with read-only annotations', () => {
    const tool = mockServer.getTool('where_are_we_exposed');
    expect(tool).toBeDefined();
    const annotations = tool!.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(false);
  });

  it('declares an outputSchema (M37 forward standard for new entries)', () => {
    const tool = mockServer.getTool('where_are_we_exposed');
    expect(tool!.config.outputSchema).toBeDefined();
  });
});

describe('where_are_we_exposed — retires the 8 exposure reads (B-INV-29)', () => {
  let mockServer: Awaited<ReturnType<typeof buildAllExposureServers>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildAllExposureServers();
  });

  it.each([
    'get_expiring_content',
    'get_freshness_report',
    'get_coverage_gaps',
    'audit_content',
    'get_quality_summary',
    'get_quality_briefing',
    'get_quality_actions',
    'get_certification_status',
  ])('no longer registers %s', (name) => {
    expect(mockServer.getTool(name)).toBeUndefined();
  });

  it('keeps suggest_content_creation as the resolution affordance (B-INV-4)', () => {
    expect(mockServer.getTool('suggest_content_creation')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Four-layer contract (B-INV-4) — trimmed to four post-ID-131.19
// ---------------------------------------------------------------------------

describe('where_are_we_exposed — four-layer structure (B-INV-4)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildServer();
  });

  it('returns the four layers in order: data → use-today → gaps → opportunities', async () => {
    const handler = mockServer.getHandler('where_are_we_exposed')!;
    const result = (await handler({}, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    const layers = sc.layers as Array<{ key: string }>;
    expect(layers.map((l) => l.key)).toEqual([
      'data',
      'use_today',
      'gaps',
      'opportunities',
    ]);
  });

  it('never calls the dropped get_quality_issue_counts RPC (ID-131.19 trim)', async () => {
    const handler = mockServer.getHandler('where_are_we_exposed')!;
    await handler({}, extra);

    expect(mocks.rpcMock).not.toHaveBeenCalledWith('get_quality_issue_counts');
  });

  it('surfaces at least one suggested-resolution affordance on the gaps/opportunities layers (B-INV-4)', async () => {
    const handler = mockServer.getHandler('where_are_we_exposed')!;
    const result = (await handler({}, extra)) as ToolResult;

    const sc = result.structuredContent as Record<string, unknown>;
    const layers = sc.layers as Array<{
      key: string;
      resolutions?: Array<{ tool: string; prompt: string }>;
    }>;
    const withResolutions = layers.filter(
      (l) => Array.isArray(l.resolutions) && l.resolutions.length > 0,
    );
    expect(withResolutions.length).toBeGreaterThanOrEqual(1);
    const allResolutions = withResolutions.flatMap((l) => l.resolutions!);
    // Resolution affordance references the kept suggest_content_creation tool.
    expect(
      allResolutions.some((r) => r.tool === 'suggest_content_creation'),
    ).toBe(true);
  });

  it('renders the four layers as ordered markdown sections, with no quality-issue leg (ID-131.19)', async () => {
    const handler = mockServer.getHandler('where_are_we_exposed')!;
    const result = (await handler({}, extra)) as ToolResult;

    const md = result.content[0].text;
    const dataIdx = md.indexOf('Data you have');
    const useTodayIdx = md.indexOf('How you could use it today');
    const gapsIdx = md.indexOf('The gaps');
    expect(dataIdx).toBeGreaterThanOrEqual(0);
    expect(dataIdx).toBeLessThan(useTodayIdx);
    expect(useTodayIdx).toBeLessThan(gapsIdx);

    // Honest trim — no residual "its quality" section or quality-issue facts.
    expect(md).not.toContain('## Its quality');
    expect(md).not.toContain('open quality issue');
  });
});
