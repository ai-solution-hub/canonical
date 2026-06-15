import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// ID-71.9 (B-INV-30 / M30 / OQ-5 / M37) — ONE faceted `whats_in_my_queue`
// outcome. Content-review and governance-review collapse into ONE queue
// concept distinguished by a `facet` (content_quality | governance | all),
// NOT two separate queue outcomes. The new read is a GREENFIELD surface OVER
// the already-merged `lib/attention.ts` producer substrate.
//
//   - facet?: 'content_quality' | 'governance' | 'all' (default 'all')
//   - content-quality + governance items are reachable through the SAME
//     queue concept (one entry, one facet param).
//   - `source_document_change` (AttentionItem.type) is scoped OUT of v1 —
//     it has NO producer, so no facet may resolve to an empty producer.
//   - declares an outputSchema (M37 forward standard).
//
// The fragmented queue reads MUST NOT be registered any longer:
//   get_governance_queue (governance.ts)
//   get_review_queue, get_assignments_for_user (review.ts)
//   get_dashboard_summary (dashboard.ts)
//
// The /review + /api/governance/review ROUTE layer is UNCHANGED (OQ-5) — this
// test asserts ONLY the MCP surface; no route module is imported or touched.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // The faceted queue reads attention source counts via the dashboard module
  // (fetchUnifiedDashboardData) then runs the lib/attention.ts producers.
  const unified = {
    attention_sources: {
      governance_review_count: 4,
      stale_content_count: 6,
      expired_content_count: 2,
      quality_flag_count: 3,
      unverified_count: 1,
      expiring_cert_count: 0,
      expiring_content_date_count: 0,
      unread_notification_count: 0,
      coverage_gap_count: 5,
      unclassified_count: 2,
    },
    active_bids: [],
    user_role: 'admin',
    errors: [],
  };

  return {
    createMcpClient: vi.fn().mockReturnValue({ from: vi.fn(), rpc: vi.fn() }),
    getMcpUserRole: vi.fn().mockResolvedValue('admin'),
    fetchUnifiedDashboardData: vi.fn().mockResolvedValue(unified),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: vi.fn().mockResolvedValue('admin'),
}));

vi.mock('@/lib/dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dashboard')>();
  return {
    ...actual,
    fetchUnifiedDashboardData: mocks.fetchUnifiedDashboardData,
  };
});

interface QueueItem {
  type: string;
  facet: string;
  severity: string;
}
interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: { items: QueueItem[]; facet: string; total: number };
  isError?: boolean;
}

async function buildServer() {
  const mockServer = createMockMcpServer();
  const { registerReviewTools } = await import('@/lib/mcp/tools/review');
  await registerReviewTools(
    mockServer.server as unknown as Parameters<typeof registerReviewTools>[0],
  );
  return mockServer;
}

async function buildQueueServers() {
  const mockServer = createMockMcpServer();
  const server = mockServer.server as unknown as Parameters<
    typeof import('@/lib/mcp/tools/review').registerReviewTools
  >[0];
  const { registerReviewTools } = await import('@/lib/mcp/tools/review');
  const { registerGovernanceTools } =
    await import('@/lib/mcp/tools/governance');
  const { registerDashboardTools } = await import('@/lib/mcp/tools/dashboard');
  await registerReviewTools(server);
  await registerGovernanceTools(server);
  await registerDashboardTools(server);
  return mockServer;
}

// ---------------------------------------------------------------------------
// Registration + consolidation
// ---------------------------------------------------------------------------

describe('whats_in_my_queue — registration (B-INV-30)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildServer();
  });

  it('registers a single whats_in_my_queue entry with read-only annotations', () => {
    const tool = mockServer.getTool('whats_in_my_queue');
    expect(tool).toBeDefined();
    const annotations = tool!.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
  });

  it('exposes a facet param (content_quality | governance | all)', () => {
    const tool = mockServer.getTool('whats_in_my_queue');
    const schema = tool!.config.inputSchema as Record<string, unknown>;
    expect(Object.keys(schema)).toContain('facet');
  });

  it('declares an outputSchema (M37 forward standard for new entries)', () => {
    const tool = mockServer.getTool('whats_in_my_queue');
    expect(tool!.config.outputSchema).toBeDefined();
  });
});

describe('whats_in_my_queue — retires the fragmented queue reads (B-INV-30)', () => {
  let mockServer: Awaited<ReturnType<typeof buildQueueServers>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildQueueServers();
  });

  it.each([
    'get_governance_queue',
    'get_review_queue',
    'get_assignments_for_user',
    'get_dashboard_summary',
  ])('no longer registers %s', (name) => {
    expect(mockServer.getTool(name)).toBeUndefined();
  });

  it('keeps create_review_assignment (the write tool, not a queue read)', () => {
    expect(mockServer.getTool('create_review_assignment')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Faceted contract (B-INV-30, OQ-5)
// ---------------------------------------------------------------------------

describe('whats_in_my_queue — facet behaviour (B-INV-30)', () => {
  let mockServer: Awaited<ReturnType<typeof buildServer>>;
  const extra = { authInfo: { token: 'test' } };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = await buildServer();
  });

  it('content-quality and governance items are reachable through the SAME queue concept (facet=all)', async () => {
    const handler = mockServer.getHandler('whats_in_my_queue')!;
    const result = (await handler({ facet: 'all' }, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    const items = result.structuredContent!.items;
    const facetsPresent = new Set(items.map((i) => i.facet));
    expect(facetsPresent.has('content_quality')).toBe(true);
    expect(facetsPresent.has('governance')).toBe(true);
  });

  it('facet=governance returns only governance items', async () => {
    const handler = mockServer.getHandler('whats_in_my_queue')!;
    const result = (await handler(
      { facet: 'governance' },
      extra,
    )) as ToolResult;

    const items = result.structuredContent!.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.facet === 'governance')).toBe(true);
  });

  it('facet=content_quality returns only content-quality items', async () => {
    const handler = mockServer.getHandler('whats_in_my_queue')!;
    const result = (await handler(
      { facet: 'content_quality' },
      extra,
    )) as ToolResult;

    const items = result.structuredContent!.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.facet === 'content_quality')).toBe(true);
  });

  it('never emits source_document_change (scoped OUT of v1 — no producer)', async () => {
    const handler = mockServer.getHandler('whats_in_my_queue')!;
    const result = (await handler({ facet: 'all' }, extra)) as ToolResult;

    const items = result.structuredContent!.items;
    expect(items.some((i) => i.type === 'source_document_change')).toBe(false);
  });

  it('the facet enum does not admit source_document_change', () => {
    const tool = mockServer.getTool('whats_in_my_queue')!;
    const schema = tool.config.inputSchema as { facet: { _def?: unknown } };
    // The facet Zod enum, when parsed, must reject source_document_change.
    const facetSchema = schema.facet as unknown as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(facetSchema.safeParse('source_document_change').success).toBe(false);
    expect(facetSchema.safeParse('governance').success).toBe(true);
    expect(facetSchema.safeParse('content_quality').success).toBe(true);
    expect(facetSchema.safeParse('all').success).toBe(true);
  });
});
