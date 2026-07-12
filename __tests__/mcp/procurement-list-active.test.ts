/**
 * Tests for MCP tool #3: list_active_procurement.
 *
 * ID-145 {145.21} DR-056 re-key: the tool KEEPS its name but its underlying
 * read moves workspace -> form_instances (`workspaces`/`procurement_workspaces`
 * are wholesale-deleted for procurement, W1e {145.6}). This is a dedicated
 * file (rather than folding into mcp-tools-entity.test.ts /
 * mcp-app-trigger-tools.test.ts) because those files fully replace
 * `@/lib/dashboard` with a bare `vi.fn()` stub that has no
 * `getDeadlineUrgency`/`getDaysUntilDeadline` — this tool's handler needs
 * the real (pure, side-effect-free) implementations of both.
 *
 * Strategy: Create a mock McpServer that captures registered tool handlers
 * via registerTool(), then call the handler directly with mock auth and
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

// `@/lib/dashboard` is used ONLY for its two pure, side-effect-free date
// helpers here (getDeadlineUrgency / getDaysUntilDeadline) — importOriginal
// keeps them real rather than stubbing the whole module (which would break
// list_active_procurement's sort/label logic).
vi.mock('@/lib/dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dashboard')>();
  return actual;
});

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

describe('list_active_procurement', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  let supabase: typeof mocks.mockSupabaseClient;
  const extra = makeAuthExtra();

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    supabase = mocks.mockSupabaseClient;
    const { registerProcurementTools } =
      await import('@/lib/mcp/tools/procurement');
    await registerProcurementTools(mockServer.server as never);
  });

  it('queries form_instances (not workspaces) and returns form-scoped data', async () => {
    const handler = mockServer.getHandler('list_active_procurement')!;
    expect(handler).toBeDefined();

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'form-001',
              name: 'NHS Digital Transformation',
              issuing_organisation: 'NHS England',
              deadline: '2026-08-01',
              workflow_state: 'drafting',
            },
          ],
          error: null,
        }),
      ),
    };
    supabase.from.mockReturnValue(mockChain);
    supabase.rpc.mockResolvedValueOnce({
      data: [
        {
          workspace_id: 'form-001',
          total_questions: 5,
          strong_match_count: 2,
          partial_match_count: 1,
          needs_sme_count: 1,
          no_content_count: 1,
          unmatched_count: 0,
          drafted_count: 2,
          complete_count: 1,
        },
      ],
      error: null,
    });

    const result = (await handler({}, extra)) as {
      content: Array<{ text: string }>;
      structuredContent: {
        total_count: number;
        bids: Array<{
          id: string;
          name: string;
          buyer: string | null;
          status: string;
          deadline: string | null;
          total_questions: number;
          answered_questions: number;
          approved_questions: number;
        }>;
      };
    };

    expect(supabase.from).toHaveBeenCalledWith('form_instances');
    expect(supabase.from).not.toHaveBeenCalledWith('workspaces');
    expect(supabase.rpc).toHaveBeenCalledWith('get_form_question_stats_batch', {
      p_project_ids: ['form-001'],
    });

    expect(result.structuredContent.total_count).toBe(1);
    expect(result.structuredContent.bids).toHaveLength(1);
    expect(result.structuredContent.bids[0]).toMatchObject({
      id: 'form-001',
      name: 'NHS Digital Transformation',
      buyer: 'NHS England',
      status: 'drafting',
      deadline: '2026-08-01',
      total_questions: 5,
      answered_questions: 3,
      approved_questions: 1,
    });
    expect(result.content[0].text).toContain('# Active Procurements');
  });

  it('excludes terminal-workflow-state forms (won/lost/withdrawn)', async () => {
    const handler = mockServer.getHandler('list_active_procurement')!;

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'form-active',
              name: 'Active Form',
              issuing_organisation: 'Buyer A',
              deadline: null,
              workflow_state: 'drafting',
            },
            {
              id: 'form-won',
              name: 'Won Form',
              issuing_organisation: 'Buyer B',
              deadline: null,
              workflow_state: 'won',
            },
            {
              id: 'form-lost',
              name: 'Lost Form',
              issuing_organisation: 'Buyer C',
              deadline: null,
              workflow_state: 'lost',
            },
            {
              id: 'form-withdrawn',
              name: 'Withdrawn Form',
              issuing_organisation: 'Buyer D',
              deadline: null,
              workflow_state: 'withdrawn',
            },
          ],
          error: null,
        }),
      ),
    };
    supabase.from.mockReturnValue(mockChain);
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result = (await handler({}, extra)) as {
      structuredContent: {
        total_count: number;
        bids: Array<{ id: string }>;
      };
    };

    expect(result.structuredContent.total_count).toBe(1);
    expect(result.structuredContent.bids).toEqual([
      expect.objectContaining({ id: 'form-active' }),
    ]);
    // No non-terminal forms -> the batch stats RPC is only called with the
    // surviving id.
    expect(supabase.rpc).toHaveBeenCalledWith('get_form_question_stats_batch', {
      p_project_ids: ['form-active'],
    });
  });

  it('returns an empty list without calling the stats RPC when no forms are active', async () => {
    const handler = mockServer.getHandler('list_active_procurement')!;

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      ),
    };
    supabase.from.mockReturnValue(mockChain);

    const result = (await handler({}, extra)) as {
      content: Array<{ text: string }>;
      structuredContent: { total_count: number; bids: unknown[] };
    };

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(result.structuredContent.total_count).toBe(0);
    expect(result.structuredContent.bids).toEqual([]);
    expect(result.content[0].text).toContain('No active procurements found');
  });
});
