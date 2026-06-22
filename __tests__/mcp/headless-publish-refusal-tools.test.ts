/**
 * ID-71.23 — Wave 3, B-INV-6 (M6).
 *
 * Tool-level behaviour tests for the publication human-gate guard wired into
 * the two publication-status transition tools:
 *   - `update_governance_status` (status: 'publish')
 *   - `update_publication_status` (new_status: 'published')
 *
 * A HEADLESS agent attempting to publish is REFUSED at the surface and routed
 * to the human gate (B-INV-6). A HUMAN actor is unaffected — the publish
 * proceeds through the existing role-gated path. A headless agent's
 * propose-write (status: 'draft' / new_status: 'draft') is NOT refused — that
 * is the allowed propose-only path.
 *
 * The actor module (`@/lib/mcp/actor`) is the REAL implementation (pure logic)
 * — not mocked — so this proves the guard end-to-end through the tool.
 *
 * Spec: PRODUCT.md B-INV-6 (HC-2); TECH.md M6.
 *
 * Pattern mirrors __tests__/mcp/update-publication-status.test.ts: hoisted
 * mocks for auth + supabase/safe, then the real governance tool registration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — set BEFORE imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  checkMcpRole: vi.fn(),
  createMcpClient: vi.fn(),
  getMcpUserId: vi.fn(),
  getMcpUserRole: vi.fn(),
  sb: vi.fn(),
  tryQuery: vi.fn(),
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/supabase/safe', () => ({
  sb: mocks.sb,
  tryQuery: mocks.tryQuery,
  isOk: (r: { ok: boolean }) => r.ok,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: vi.fn() })),
  createClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { registerGovernanceTools } from '@/lib/mcp/tools/governance';
import {
  createMockMcpServer,
  type MockToolRegistration,
} from '@/__tests__/helpers/mcp-server';

const TEST_USER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const TEST_ITEM_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

/** Build a tool-call `extra` for a given actor posture. */
function extraFor(actorType: 'human' | 'headless') {
  return {
    authInfo: {
      token: 'test-bearer-token',
      clientId: 'mcp-client',
      scopes: [],
      extra: { userId: TEST_USER_ID, role: 'admin', actorType },
    },
    signal: new AbortController().signal,
    sendNotification: vi.fn(),
    _meta: undefined,
    requestId: 'test-req-1',
    sendElicitationRequest: vi.fn(),
  };
}

async function getTools(): Promise<Record<string, MockToolRegistration>> {
  const mockServer = createMockMcpServer();
  await registerGovernanceTools(mockServer.server);
  const byName: Record<string, MockToolRegistration> = {};
  for (const t of mockServer.toolList) byName[t.name] = t;
  return byName;
}

type ToolResult = {
  content: Array<{ text: string }>;
  isError?: boolean;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default wiring: admin role, valid client. The guard must fire BEFORE any
  // of this is consulted for a headless publish, so for the refusal tests the
  // DB is never touched — but we wire it so the human/draft control cases
  // would proceed past the guard.
  mocks.checkMcpRole.mockResolvedValue('admin');
  mocks.getMcpUserId.mockReturnValue(TEST_USER_ID);
  mocks.getMcpUserRole.mockResolvedValue('admin');
  mocks.createMcpClient.mockReturnValue({ from: vi.fn() });
});

// ---------------------------------------------------------------------------
// update_governance_status — publish branch
// ---------------------------------------------------------------------------

describe('update_governance_status — publish refused for headless actor (B-INV-6)', () => {
  it('refuses a headless agent attempting to publish, routed to the human gate', async () => {
    const tools = await getTools();
    const result = (await tools.update_governance_status.handler(
      { item_ids: [TEST_ITEM_ID], status: 'publish' },
      extraFor('headless'),
    )) as ToolResult;

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text.toLowerCase()).toContain('human');
    expect(text.toLowerCase()).toMatch(/publish|publication/);
    // Refused at the SURFACE — the DB role check / client is never consulted
    // for the publish (the guard short-circuits before any DB work).
    expect(mocks.createMcpClient).not.toHaveBeenCalled();
  });

  it('does NOT refuse a headless agent setting items to draft (propose-write is allowed)', async () => {
    const tools = await getTools();
    // The draft branch proceeds past the guard into DB work. We assert the
    // guard did NOT short-circuit: createMcpClient IS consulted (the tool
    // entered its normal body) rather than returning the publish refusal.
    mocks.tryQuery.mockResolvedValue({ ok: true, data: null });
    const result = (await tools.update_governance_status.handler(
      { item_ids: [TEST_ITEM_ID], status: 'draft' },
      extraFor('headless'),
    )) as ToolResult;

    const text = result.content[0]?.text ?? '';
    expect(text.toLowerCase()).not.toContain('a headless agent cannot publish');
    expect(mocks.createMcpClient).toHaveBeenCalled();
  });

  it('does NOT refuse a human actor attempting to publish (proceeds to role-gated path)', async () => {
    const tools = await getTools();
    mocks.tryQuery.mockResolvedValue({ ok: true, data: null });
    await tools.update_governance_status.handler(
      { item_ids: [TEST_ITEM_ID], status: 'publish' },
      extraFor('human'),
    );
    // The human publish proceeds into the tool body (DB client consulted),
    // i.e. the guard did not refuse it.
    expect(mocks.createMcpClient).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// update_publication_status — published transition
// ---------------------------------------------------------------------------

describe('update_publication_status — publish refused for headless actor (B-INV-6)', () => {
  it('refuses a headless agent transitioning an item to published', async () => {
    const tools = await getTools();
    const result = (await tools.update_publication_status.handler(
      { item_id: TEST_ITEM_ID, new_status: 'published' },
      extraFor('headless'),
    )) as ToolResult;

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text.toLowerCase()).toContain('human');
    expect(text.toLowerCase()).toMatch(/publish|publication/);
    expect(mocks.createMcpClient).not.toHaveBeenCalled();
  });

  it('does NOT refuse a headless agent transitioning an item to draft (propose-write)', async () => {
    const tools = await getTools();
    mocks.tryQuery.mockResolvedValue({
      ok: true,
      data: {
        id: TEST_ITEM_ID,
        publication_status: 'in_review',
      },
    });
    const result = (await tools.update_publication_status.handler(
      { item_id: TEST_ITEM_ID, new_status: 'draft' },
      extraFor('headless'),
    )) as ToolResult;

    const text = result.content[0]?.text ?? '';
    expect(text.toLowerCase()).not.toContain('a headless agent cannot publish');
    expect(mocks.createMcpClient).toHaveBeenCalled();
  });

  it('does NOT refuse a human actor transitioning an item to published', async () => {
    const tools = await getTools();
    mocks.tryQuery.mockResolvedValue({
      ok: true,
      data: {
        id: TEST_ITEM_ID,
        publication_status: 'in_review',
      },
    });
    await tools.update_publication_status.handler(
      { item_id: TEST_ITEM_ID, new_status: 'published' },
      extraFor('human'),
    );
    expect(mocks.createMcpClient).toHaveBeenCalled();
  });
});
