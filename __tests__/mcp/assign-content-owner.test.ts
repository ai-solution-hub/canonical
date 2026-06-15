/**
 * Tests for the assign_content_owner MCP tool.
 *
 * Verifies:
 *   - Assigning owner to items calls the RPC correctly
 *   - Max 50 items limit is enforced by Zod schema (not tested here — schema-level)
 *   - Permission check: admin only
 *   - Error handling for RPC failures
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock setup — must be before imports
// ---------------------------------------------------------------------------

const { mockCreateMcpClient, mockGetMcpUserId, mockCheckMcpRole } = vi.hoisted(
  () => ({
    mockCreateMcpClient: vi.fn(),
    mockGetMcpUserId: vi.fn(),
    mockCheckMcpRole: vi.fn(),
  }),
);

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mockCreateMcpClient,
  getMcpUserId: mockGetMcpUserId,
  checkMcpRole: mockCheckMcpRole,
  createMcpUserClient: vi.fn(),
}));

vi.mock('@/lib/mcp/formatters', () => ({
  formatContentItem: vi.fn(() => 'formatted'),
  formatCreatedItem: vi.fn(() => 'created'),
  formatUpdatedItem: vi.fn(() => 'updated'),
  formatBatchContentItems: vi.fn(() => 'batch'),
  truncateResponse: vi.fn((s: string) => s),
  CHARACTER_LIMIT: 10000,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn(),
  };
});
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));
vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { registerContentTools } from '@/lib/mcp/tools/content';
import {
  createMockMcpServer,
  type MockToolRegistration,
} from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000099';
const ITEM_ID_1 = '00000000-0000-4000-8000-000000000010';
const ITEM_ID_2 = '00000000-0000-4000-8000-000000000011';

// Mutable container so the helper module-singleton pattern can stay —
// individual tests still call createMockMcpServer() in beforeEach which
// resets capture state. Re-assigned in beforeEach.
let mockServer: ReturnType<typeof createMockMcpServer>;

function getAssignOwnerTool(): MockToolRegistration | undefined {
  // ID-71.10 M32: assign_content_owner consolidated into `assign` (one-or-many).
  // The explicit `item_ids` path preserved here is the former assign_content_owner.
  return mockServer.getTool('assign');
}

function createMockExtra(
  authInfo = {
    token: 'test-token',
    extra: { userId: ADMIN_USER_ID, role: 'admin' },
  },
) {
  return { authInfo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assign_content_owner MCP tool', () => {
  let mockRpc: ReturnType<typeof vi.fn>;
  let mockSupabase: Record<string, unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRpc = vi.fn();
    mockSupabase = { rpc: mockRpc };

    mockCreateMcpClient.mockReturnValue(mockSupabase);
    mockGetMcpUserId.mockReturnValue(ADMIN_USER_ID);
    mockCheckMcpRole.mockResolvedValue('admin');

    mockServer = createMockMcpServer();
    await registerContentTools(mockServer.server);
  });

  it('registers the consolidated assign tool', () => {
    const tool = getAssignOwnerTool();
    expect(tool).toBeDefined();
    expect(tool!.config).toHaveProperty('title', 'Assign Content Owner');
    expect(tool!.config).toHaveProperty('annotations');
    const annotations = tool!.config.annotations as Record<string, boolean>;
    expect(annotations.readOnlyHint).toBe(false);
    // ID-71.10: merged tool covers the non-idempotent scope-filter path, so the
    // consolidated `assign` carries NON_IDEMPOTENT_WRITE_ANNOTATIONS.
    expect(annotations.idempotentHint).toBe(false);
    expect(annotations.destructiveHint).toBe(false);
  });

  it('assigns owner to items successfully', async () => {
    mockRpc.mockResolvedValue({ data: 2, error: null });

    const tool = getAssignOwnerTool()!;
    const result = await tool.handler(
      { item_ids: [ITEM_ID_1, ITEM_ID_2], owner_id: OWNER_ID },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(
      'Successfully assigned ownership of 2 items',
    );
    expect(result.content[0].text).toContain(OWNER_ID);

    // Verify RPC called correctly
    expect(mockRpc).toHaveBeenCalledWith('bulk_assign_content_owner', {
      p_item_ids: [ITEM_ID_1, ITEM_ID_2],
      p_owner_id: OWNER_ID,
      p_assigned_by: ADMIN_USER_ID,
    });

    // Verify structuredContent
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.action).toBe('assign_content_owner');
    expect(result.structuredContent!.updated).toBe(2);
    expect(result.structuredContent!.not_found).toBe(0);
  });

  it('reports not-found items when count differs', async () => {
    // Only 1 of 2 items updated
    mockRpc.mockResolvedValue({ data: 1, error: null });

    const tool = getAssignOwnerTool()!;
    const result = await tool.handler(
      { item_ids: [ITEM_ID_1, ITEM_ID_2], owner_id: OWNER_ID },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('1 item');
    expect(result.content[0].text).toContain('not found or unchanged');
    expect(result.structuredContent!.not_found).toBe(1);
  });

  it('rejects non-admin users', async () => {
    mockCheckMcpRole.mockResolvedValue(null);

    const tool = getAssignOwnerTool()!;
    const result = await tool.handler(
      { item_ids: [ITEM_ID_1], owner_id: OWNER_ID },
      createMockExtra({
        token: 'test-token',
        extra: { userId: 'editor-id', role: 'editor' },
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
    expect(result.content[0].text).toContain('admin role required');
  });

  it('handles RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

    const tool = getAssignOwnerTool()!;
    const result = await tool.handler(
      { item_ids: [ITEM_ID_1], owner_id: OWNER_ID },
      createMockExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to assign content owner');
    expect(result.content[0].text).toContain('RPC failed');
  });

  it('handles single item assignment', async () => {
    mockRpc.mockResolvedValue({ data: 1, error: null });

    const tool = getAssignOwnerTool()!;
    const result = await tool.handler(
      { item_ids: [ITEM_ID_1], owner_id: OWNER_ID },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(
      'Successfully assigned ownership of 1 item to',
    );
  });

  it('handles missing auth gracefully', async () => {
    mockCheckMcpRole.mockResolvedValue(null);

    const tool = getAssignOwnerTool()!;
    const result = await tool.handler(
      { item_ids: [ITEM_ID_1], owner_id: OWNER_ID },
      { authInfo: undefined },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
  });
});
