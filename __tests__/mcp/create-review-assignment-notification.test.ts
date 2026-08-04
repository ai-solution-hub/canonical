/**
 * create_review_assignment — reviewer notification dispatch (id-369 F1 class).
 *
 * The assignee notification row is for ANOTHER user, and the
 * `notifications_insert` RLS policy only allows `user_id = auth.uid()` — so
 * an insert on the RLS-scoped MCP client is denied every time, in-band as
 * `{ error }`. These tests pin that the insert rides the SERVICE client
 * (S496 precedent, lib/mcp/tools/governance.ts) and that a denied insert
 * stays visible in the result without aborting the assignment.
 *
 * Uses the same mock-server pattern as governance-queue-tools.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  checkMcpRole: vi.fn(),
  createMcpClient: vi.fn(),
  getMcpUserId: vi.fn(),
  getMcpUserRole: vi.fn(),
  createServiceClient: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createServiceClient: mocks.createServiceClient,
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: mocks.createNotification,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { registerReviewTools } from '@/lib/mcp/tools/review';
import {
  createMockMcpServer,
  type MockToolRegistration,
} from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Supabase chain builder (same shape as governance-queue-tools.test.ts)
// ---------------------------------------------------------------------------

type QueryResolver = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

function chain(resolve: QueryResolver) {
  const c: Record<string, unknown> = {};
  const methods = [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'or',
    'gte',
    'lte',
    'order',
    'range',
    'limit',
  ];
  for (const m of methods) c[m] = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue(resolve);
  c.maybeSingle = vi.fn().mockResolvedValue(resolve);
  c.then = vi.fn((ok: (v: unknown) => void) => ok(resolve));
  return c;
}

const MOCK_EXTRA = {
  authInfo: {
    token: 'test-bearer-token',
    extra: { userId: 'user-admin-001', role: 'admin' },
  },
  signal: new AbortController().signal,
  sendNotification: vi.fn(),
  _meta: undefined,
  requestId: 'test-req-1',
  sendElicitationRequest: vi.fn(),
};

async function callTool(
  tool: MockToolRegistration,
  args: Record<string, unknown>,
): Promise<{
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  return (await tool.handler(args, MOCK_EXTRA)) as {
    content: Array<{ text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVIEWER_ID = '22222222-2222-4222-8222-222222222222';

const serviceClientSentinel = { __client: 'service' };

function buildMcpClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'source_documents') {
        return chain({ data: null, error: null, count: 3 });
      }
      if (table === 'review_assignments') {
        return chain({ data: { id: 'assignment-1' }, error: null });
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  };
}

const baseArgs = {
  reviewer_id: REVIEWER_ID,
  filter_domains: [],
  filter_content_types: [],
  filter_freshness: [],
};

describe('create_review_assignment — assignee notification (id-369 F1 class)', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  let mcpClient: ReturnType<typeof buildMcpClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkMcpRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('user-admin-001');
    mocks.getMcpUserRole.mockResolvedValue('admin');
    mcpClient = buildMcpClient();
    mocks.createMcpClient.mockReturnValue(mcpClient);
    mocks.createServiceClient.mockReturnValue(serviceClientSentinel);
    mocks.createNotification.mockResolvedValue({ error: null });

    mockServer = createMockMcpServer();
    await registerReviewTools(mockServer.server);
  });

  it('notifies the assignee via the service client, never the MCP caller client', async () => {
    const tool = mockServer.getTool('create_review_assignment')!;
    const res = await callTool(tool, baseArgs);

    expect(res.isError).toBeUndefined();
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);

    const [params] = mocks.createNotification.mock.calls[0];
    expect(params.userId).toBe(REVIEWER_ID);
    // The load-bearing pin: the cross-user insert rides the service client.
    // On the RLS-scoped MCP client the notifications_insert policy denies
    // it and the assignee is silently never notified.
    expect(params.supabase).toBe(serviceClientSentinel);
    expect(params.supabase).not.toBe(mcpClient);

    expect(res.structuredContent?.notification_sent).toBe(true);
    expect(res.structuredContent?.notification_error).toBeNull();
  });

  it('keeps the assignment and reports the failure when the notification insert is denied', async () => {
    mocks.createNotification.mockResolvedValueOnce({
      error: { message: 'new row violates row-level security policy' },
    });

    const tool = mockServer.getTool('create_review_assignment')!;
    const res = await callTool(tool, baseArgs);

    // The assignment itself succeeded — notification failure must not
    // abort it (best-effort by declared design)…
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.id).toBe('assignment-1');
    // …but the failure stays visible in the result.
    expect(res.structuredContent?.notification_sent).toBe(false);
    expect(res.structuredContent?.notification_error).toContain(
      'row-level security',
    );
  });
});
