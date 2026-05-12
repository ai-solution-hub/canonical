/**
 * Unit tests for get_change_report MCP tool.
 *
 * Covers: registration annotations, role gate, empty state, happy path
 * with all three sections, domain filter, keyword filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const createChain = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.lt = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );
    return chain;
  };

  const chain = createChain();

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
    _createChain: createChain,
  };

  return {
    mockSupabaseClient,
    chain,
    createChain,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: vi.fn().mockReturnValue('a0000000-0000-4000-8000-000000000001'),
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { registerChangeReportTools } from '@/lib/mcp/tools/change-report';

// ---------------------------------------------------------------------------
// Test harness — uses canonical createMockMcpServer helper
// ---------------------------------------------------------------------------

const MOCK_AUTH_INFO = {
  token: 'test-token',
  clientId: 'test-client',
  scopes: ['read', 'write'],
  extra: { userId: 'a0000000-0000-4000-8000-000000000001', role: 'editor' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get_change_report MCP tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockServer = createMockMcpServer();
    await registerChangeReportTools(mockServer.server);

    // Reset chain defaults — all queries return empty by default
    mocks.chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );
    mocks.checkMcpRole.mockResolvedValue('editor');
  });

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  it('registers with READ_ONLY annotations', () => {
    const tool = mockServer.getTool('get_change_report');
    expect(tool).toBeDefined();
    expect(tool!.config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  // -------------------------------------------------------------------------
  // Role gate
  // -------------------------------------------------------------------------

  it('denies viewer role', async () => {
    mocks.checkMcpRole.mockResolvedValueOnce(null);

    const handler = mockServer.getTool('get_change_report')!.handler;
    const result = await handler(
      { period_days: 7 },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('returns friendly empty-state markdown when no changes', async () => {
    // All three queries return empty arrays (default mock behaviour)
    const handler = mockServer.getTool('get_change_report')!.handler;
    const result = await handler(
      { period_days: 7 },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Change Report');
    expect(result.content[0].text).toContain('No additions in this period');
    expect(result.content[0].text).toContain('No updates in this period');
    expect(result.content[0].text).toContain('No removals in this period');
    expect(result.structuredContent.additions.count).toBe(0);
    expect(result.structuredContent.updates.count).toBe(0);
    expect(result.structuredContent.removals.count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns additions, updates, and removals in structured content', async () => {
    // Mock three sequential .then calls (additions, updates, removals)
    let callCount = 0;
    mocks.chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++;
      if (callCount === 1) {
        // Additions
        return resolve({
          data: [
            {
              id: 'a1',
              title: 'New Article',
              primary_domain: 'Policy',
              content_type: 'article',
              created_at: '2026-04-20T10:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (callCount === 2) {
        // Updates
        return resolve({
          data: [
            {
              id: 'u1',
              title: 'Updated Guide',
              primary_domain: 'Cyber Security',
              content_type: 'guide',
              updated_at: '2026-04-19T14:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (callCount === 3) {
        // Removals
        return resolve({
          data: [
            {
              id: 'r1',
              title: 'Archived Doc',
              primary_domain: 'HR',
              content_type: 'document',
              archived_at: '2026-04-18T08:00:00Z',
            },
          ],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    });

    const handler = mockServer.getTool('get_change_report')!.handler;
    const result = await handler(
      { period_days: 14 },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeUndefined();

    // Markdown sections
    expect(result.content[0].text).toContain('Additions (1)');
    expect(result.content[0].text).toContain('New Article');
    expect(result.content[0].text).toContain('Updates (1)');
    expect(result.content[0].text).toContain('Updated Guide');
    expect(result.content[0].text).toContain('Removals (1)');
    expect(result.content[0].text).toContain('Archived Doc');

    // Structured content
    expect(result.structuredContent.period_days).toBe(14);
    expect(result.structuredContent.additions.count).toBe(1);
    expect(result.structuredContent.additions.items[0].id).toBe('a1');
    expect(result.structuredContent.updates.count).toBe(1);
    expect(result.structuredContent.updates.items[0].id).toBe('u1');
    expect(result.structuredContent.removals.count).toBe(1);
    expect(result.structuredContent.removals.items[0].id).toBe('r1');
  });

  // -------------------------------------------------------------------------
  // Domain filter
  // -------------------------------------------------------------------------

  it('applies domain filter to all three queries', async () => {
    const handler = mockServer.getTool('get_change_report')!.handler;
    await handler(
      { period_days: 7, domain: 'Cyber Security' },
      { authInfo: MOCK_AUTH_INFO },
    );

    // The .eq() method should be called with primary_domain for each of the
    // three queries (additions, updates, removals)
    const eqCalls = mocks.chain.eq.mock.calls.filter(
      (call: unknown[]) =>
        call[0] === 'primary_domain' && call[1] === 'Cyber Security',
    );
    expect(eqCalls.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Keywords filter
  // -------------------------------------------------------------------------

  it('applies keyword ILIKE filter to all three queries', async () => {
    const handler = mockServer.getTool('get_change_report')!.handler;
    await handler(
      { period_days: 7, keywords: ['cyber', 'policy'] },
      { authInfo: MOCK_AUTH_INFO },
    );

    // The .or() method should be called three times (once per query)
    const orCalls = mocks.chain.or.mock.calls;
    expect(orCalls.length).toBe(3);

    // Each .or() call should contain ILIKE patterns for both keywords
    for (const call of orCalls) {
      expect(call[0]).toContain('title.ilike.%cyber%');
      expect(call[0]).toContain('title.ilike.%policy%');
    }
  });

  // -------------------------------------------------------------------------
  // Structured content shape
  // -------------------------------------------------------------------------

  it('includes domain and keywords in structured content', async () => {
    const handler = mockServer.getTool('get_change_report')!.handler;
    const result = await handler(
      { period_days: 30, domain: 'Policy', keywords: ['GDPR'] },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.structuredContent.domain).toBe('Policy');
    expect(result.structuredContent.keywords).toEqual(['GDPR']);
    expect(result.structuredContent.period_days).toBe(30);
    expect(result.structuredContent.start_date).toBeDefined();
    expect(result.structuredContent.end_date).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // WP6 verify F-1: surface Supabase errors rather than masking them as "no changes"
  // -------------------------------------------------------------------------

  it('returns isError when any of the three queries fails', async () => {
    const handler = mockServer.getTool('get_change_report')!.handler;

    // Override `then` on the primary chain to simulate a DB failure.
    mocks.chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'connection refused' } }),
    );

    const result = await handler(
      { period_days: 7 },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('connection refused');
    // Confirms the user sees the DB error rather than a misleading "no changes"
    expect(result.content[0].text).not.toContain('No additions in this period');
  });

  // -------------------------------------------------------------------------
  // WP6 verify F-4: PostgREST metacharacter escaping in keywords
  // -------------------------------------------------------------------------

  it('strips PostgREST metacharacters (comma, parens, backslash) from keywords before interpolation', async () => {
    const handler = mockServer.getTool('get_change_report')!.handler;
    await handler(
      {
        period_days: 7,
        // Pathological keywords that would break the .or() filter syntax
        // if interpolated verbatim.
        keywords: ['Cyber,Security', 'Policy(v2)', 'rule\\1'],
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    const orCalls = mocks.chain.or.mock.calls;
    expect(orCalls.length).toBe(3);
    for (const call of orCalls) {
      const filter = call[0] as string;
      // Comma, parens, backslash must all be stripped from the interpolated
      // ILIKE patterns — otherwise they break PostgREST .or() syntax.
      expect(filter).toContain('title.ilike.%CyberSecurity%');
      expect(filter).toContain('title.ilike.%Policyv2%');
      expect(filter).toContain('title.ilike.%rule1%');
      // And the raw pathological strings must NOT leak into the filter.
      expect(filter).not.toMatch(/Cyber,Security/);
      expect(filter).not.toMatch(/Policy\(v2\)/);
    }
  });

  // -------------------------------------------------------------------------
  // WP6 verify F-2: Zod constraints on period_days (caught before the handler)
  // -------------------------------------------------------------------------

  it('rejects period_days > 90 at the Zod schema layer', () => {
    // Walk the registration to grab the inputSchema. Zod is the MCP SDK's
    // layer of defence; the handler never runs for out-of-range values.
    const config = mockServer.getTool('get_change_report')!.config as {
      inputSchema: {
        period_days: {
          safeParse: (v: unknown) => {
            success: boolean;
            error?: { issues: Array<{ code: string }> };
          };
        };
      };
    };
    const result = config.inputSchema.period_days.safeParse(91);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBeDefined();
  });

  it('rejects period_days < 1 at the Zod schema layer', () => {
    const config = mockServer.getTool('get_change_report')!.config as {
      inputSchema: {
        period_days: {
          safeParse: (v: unknown) => { success: boolean };
        };
      };
    };
    const result = config.inputSchema.period_days.safeParse(0);
    expect(result.success).toBe(false);
  });

  it('accepts period_days at the boundaries (1 and 90)', () => {
    const config = mockServer.getTool('get_change_report')!.config as {
      inputSchema: {
        period_days: {
          safeParse: (v: unknown) => { success: boolean };
        };
      };
    };
    expect(config.inputSchema.period_days.safeParse(1).success).toBe(true);
    expect(config.inputSchema.period_days.safeParse(90).success).toBe(true);
  });
});
