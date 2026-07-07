/**
 * get_reorientation — owned-items tombstone/archived_at filter (BL-406, S450
 * follow-up to BL-398). Pins that the owned-items query backing the
 * "Content Ownership" section excludes BOTH archived AND tombstoned
 * (admission_status='tombstoned', GDPR erasure per ID-138 {138.5} DR-023)
 * source_documents — mirroring the established idiom in
 * app/api/review/queue/route.ts (BL-398, S450).
 *
 * No prior suite exercised get_reorientation's ownership-summary query
 * behaviour: tools-reorient.test.ts covers the DIFFERENT `show_reorient_me`
 * app-trigger tool (lib/mcp/tools/apps.ts), and where-are-we-exposed-tool.test.ts
 * covers the OTHER dashboard.ts tool. This new minimal file mirrors the
 * established per-tool test file convention (e.g. where-are-we-exposed-tool.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

interface SourceDocRow {
  id: string;
  archived_at: string | null;
  admission_status: string;
}
interface FacetRow {
  source_document_id: string;
  freshness: string;
}

const mocks = vi.hoisted(() => ({
  fetchReorientData: vi.fn(),
  resolveDisplayNames: vi.fn(),
  createMcpClient: vi.fn(),
  getMcpUserId: vi.fn().mockReturnValue('user-123'),
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
}));

vi.mock('@/lib/reorient', () => ({
  fetchReorientData: mocks.fetchReorientData,
  resolveDisplayNames: mocks.resolveDisplayNames,
}));

vi.mock('@/lib/mcp/formatters', () => ({
  formatReorientation: vi.fn().mockReturnValue('# Reorientation Briefing'),
  formatWhereAreWeExposed: vi.fn().mockReturnValue(''),
  truncateResponse: vi.fn((text: string) => text),
}));

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const baseReorientData = {
  last_active_at: '2026-03-01T10:00:00Z',
  last_active_relative: '10 days ago',
  urgent: [],
  team_changes: [],
  my_recent_work: [],
  bid_summary: [],
  counts: {
    unread_notifications: 0,
    pending_reviews: 0,
    stale_or_expired: 0,
    quality_flags: 0,
  },
  generated_at: '2026-03-11T10:00:00Z',
  user_display_name: 'Liam',
  has_display_name: true,
  errors: [],
};

// Builds a source_documents chain that applies REAL filter predicates
// against an in-memory fixture, so the assertion below pins actual
// filtering behaviour rather than merely that a method was called.
function makeSourceDocumentsChain(rows: SourceDocRow[]) {
  let filtered = rows;
  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn((_col: string, ids: string[]) => {
      filtered = filtered.filter((r) => ids.includes(r.id));
      return chain;
    }),
    is: vi.fn((col: string, val: null) => {
      if (col === 'archived_at') {
        filtered = filtered.filter((r) => r.archived_at === val);
      }
      return chain;
    }),
    neq: vi.fn((col: string, val: string) => {
      if (col === 'admission_status') {
        filtered = filtered.filter((r) => r.admission_status !== val);
      }
      return chain;
    }),
    then: (resolve: (v: { data: SourceDocRow[]; error: null }) => unknown) =>
      resolve({ data: filtered, error: null }),
  };
  return chain;
}

function makeRecordLifecycleChain(rows: FacetRow[]) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (v: { data: FacetRow[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  return chain;
}

describe('get_reorientation — owned-items tombstone/archived_at filter (BL-406)', () => {
  const extra = { authInfo: { token: 'test' } };
  const FACET_ROWS: FacetRow[] = [
    { source_document_id: 'sd-fresh', freshness: 'fresh' },
    { source_document_id: 'sd-tombstoned', freshness: 'stale' },
  ];
  const SD_ROWS: SourceDocRow[] = [
    { id: 'sd-fresh', archived_at: null, admission_status: 'admitted' },
    // Not archived, but tombstoned (GDPR erasure, ID-138 {138.5} DR-023) —
    // must be excluded from the owned-items count same as an archived row.
    {
      id: 'sd-tombstoned',
      archived_at: null,
      admission_status: 'tombstoned',
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getMcpUserId.mockReturnValue('user-123');
    mocks.getMcpUserRole.mockResolvedValue('editor');
    mocks.fetchReorientData.mockResolvedValue(baseReorientData);
    mocks.resolveDisplayNames.mockResolvedValue(new Map());

    const mockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'record_lifecycle') {
          return makeRecordLifecycleChain(FACET_ROWS);
        }
        if (table === 'source_documents') {
          return makeSourceDocumentsChain(SD_ROWS);
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    mocks.createMcpClient.mockReturnValue(mockSupabaseClient);
  });

  it('excludes a tombstoned-but-not-archived owned source_document from owned_items', async () => {
    const mockServer = createMockMcpServer();
    const { registerDashboardTools } =
      await import('@/lib/mcp/tools/dashboard');
    await registerDashboardTools(mockServer.server as never);

    const handler = mockServer.getHandler('get_reorientation')!;
    const result = (await handler({}, extra)) as ToolResult;

    expect(result.isError).toBeUndefined();
    const ownership = (
      result.structuredContent as {
        ownership?: { owned_items: number; stale_owned: number };
      }
    ).ownership;

    // Only sd-fresh survives the archived_at + admission_status filter —
    // sd-tombstoned (admission_status='tombstoned') must be excluded even
    // though its archived_at is null.
    expect(ownership).toBeDefined();
    expect(ownership!.owned_items).toBe(1);
    expect(ownership!.stale_owned).toBe(0);
  });
});
