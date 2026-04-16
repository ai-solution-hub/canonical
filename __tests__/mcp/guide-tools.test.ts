/**
 * Unit tests for guide MCP tools (list_guides, get_guide, create_guide, update_guide).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const createChain = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
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
    getMcpUserId: vi.fn().mockReturnValue('a0000000-0000-4000-8000-000000000001'),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { registerGuideTools } from '@/lib/mcp/tools/guides';

// ---------------------------------------------------------------------------
// Test harness — capture registered tools
// ---------------------------------------------------------------------------

interface RegisteredTool {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => Promise<any>;
}

function createTestServer(): {
  server: McpServer;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: RegisteredTool['handler']) => {
        tools.set(name, { name, handler });
        return { enabled: true };
      },
    ),
  } as unknown as McpServer;
  return { server, tools };
}

const MOCK_AUTH_INFO = {
  token: 'test-token',
  clientId: 'test-client',
  scopes: ['read', 'write'],
  extra: { userId: 'a0000000-0000-4000-8000-000000000001', role: 'editor' },
};

const GUIDE_UUID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const SECTION_UUID = 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Guide MCP tools', () => {
  let tools: Map<string, RegisteredTool>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const harness = createTestServer();
    tools = harness.tools;
    await registerGuideTools(harness.server);

    // Reset chain defaults
    mocks.chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );
    mocks.chain.single.mockResolvedValue({ data: null, error: null });
    mocks.checkMcpRole.mockResolvedValue('editor');
  });

  // -------------------------------------------------------------------------
  // list_guides
  // -------------------------------------------------------------------------

  describe('list_guides', () => {
    it('returns a formatted list of published guides with section counts', async () => {
      // Mock guides query
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: GUIDE_UUID,
              name: 'Cyber Security',
              slug: 'cyber-security',
              guide_type: 'sector',
              domain_filter: 'Cyber Security',
              is_published: true,
              display_order: 0,
            },
          ],
          error: null,
        }),
      );

      // Mock section count query (tryQuery path — resolves to {data, error})
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { guide_id: GUIDE_UUID },
            { guide_id: GUIDE_UUID },
            { guide_id: GUIDE_UUID },
          ],
          error: null,
        }),
      );

      const handler = tools.get('list_guides')!.handler;
      const result = await handler(
        { published_only: true, limit: 50 },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Cyber Security');
      expect(result.structuredContent.count).toBe(1);
      expect(result.structuredContent.guides[0].section_count).toBe(3);
    });

    it('returns empty result when no guides exist', async () => {
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

      const handler = tools.get('list_guides')!.handler;
      const result = await handler(
        { published_only: true, limit: 50 },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('No guides found');
      expect(result.structuredContent.count).toBe(0);
    });

    it('filters by guide_type when provided', async () => {
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

      const handler = tools.get('list_guides')!.handler;
      await handler(
        { guide_type: 'sector', published_only: true, limit: 50 },
        { authInfo: MOCK_AUTH_INFO },
      );

      // Verify eq was called with guide_type filter
      expect(mocks.chain.eq).toHaveBeenCalledWith('guide_type', 'sector');
    });
  });

  // -------------------------------------------------------------------------
  // get_guide
  // -------------------------------------------------------------------------

  describe('get_guide', () => {
    it('returns guide detail by id', async () => {
      mocks.chain.single.mockResolvedValueOnce({
        data: {
          id: GUIDE_UUID,
          name: 'Cyber Security',
          slug: 'cyber-security',
          description: 'Sector intelligence guide',
          guide_type: 'sector',
          domain_filter: 'Cyber Security',
          icon: null,
          color: null,
          display_order: 0,
          is_published: true,
          created_at: '2026-04-01T10:00:00Z',
          updated_at: '2026-04-01T12:00:00Z',
        },
        error: null,
      });

      // Mock sections fetch (sb() path — uses .then)
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: SECTION_UUID,
              section_name: 'Overview',
              description: 'Sector overview',
              expected_layer: 'brief',
              subtopic_filter: null,
              content_type_filter: null,
              display_order: 0,
              is_required: true,
            },
          ],
          error: null,
        }),
      );

      const handler = tools.get('get_guide')!.handler;
      const result = await handler(
        { id: GUIDE_UUID },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Cyber Security');
      expect(result.content[0].text).toContain('Overview');
      expect(result.structuredContent.sections).toHaveLength(1);
    });

    it('returns guide detail by slug', async () => {
      mocks.chain.single.mockResolvedValueOnce({
        data: {
          id: GUIDE_UUID,
          name: 'Cyber Security',
          slug: 'cyber-security',
          description: null,
          guide_type: 'sector',
          domain_filter: null,
          icon: null,
          color: null,
          display_order: 0,
          is_published: true,
          created_at: null,
          updated_at: null,
        },
        error: null,
      });

      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

      const handler = tools.get('get_guide')!.handler;
      const result = await handler(
        { slug: 'cyber-security' },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.slug).toBe('cyber-security');
    });

    it('returns error when guide not found', async () => {
      mocks.chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Row not found', code: 'PGRST116' },
      });

      const handler = tools.get('get_guide')!.handler;
      const result = await handler(
        { id: GUIDE_UUID },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('returns error when both id and slug are provided', async () => {
      const handler = tools.get('get_guide')!.handler;
      const result = await handler(
        { id: GUIDE_UUID, slug: 'cyber-security' },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not both');
    });

    it('returns error when neither id nor slug is provided', async () => {
      const handler = tools.get('get_guide')!.handler;
      const result = await handler({}, { authInfo: MOCK_AUTH_INFO });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('id or slug');
    });
  });

  // -------------------------------------------------------------------------
  // create_guide
  // -------------------------------------------------------------------------

  describe('create_guide', () => {
    it('creates a guide without sections', async () => {
      mocks.chain.single.mockResolvedValueOnce({
        data: {
          id: GUIDE_UUID,
          name: 'New Guide',
          slug: 'new-guide',
          guide_type: 'custom',
          is_published: false,
        },
        error: null,
      });

      const handler = tools.get('create_guide')!.handler;
      const result = await handler(
        {
          name: 'New Guide',
          slug: 'new-guide',
          guide_type: 'custom',
          display_order: 0,
          is_published: false,
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Guide Created');
      expect(result.structuredContent.id).toBe(GUIDE_UUID);
      expect(result.structuredContent.section_count).toBe(0);
    });

    it('creates a guide with sections', async () => {
      // Guide insert
      mocks.chain.single.mockResolvedValueOnce({
        data: {
          id: GUIDE_UUID,
          name: 'New Guide',
          slug: 'new-guide',
          guide_type: 'sector',
          is_published: false,
        },
        error: null,
      });

      // Sections insert (tryQuery path — uses .then)
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

      const handler = tools.get('create_guide')!.handler;
      const result = await handler(
        {
          name: 'New Guide',
          slug: 'new-guide',
          guide_type: 'sector',
          display_order: 0,
          is_published: false,
          sections: [
            {
              section_name: 'Overview',
              display_order: 0,
              is_required: true,
            },
            {
              section_name: 'Threats',
              display_order: 1,
              is_required: false,
            },
          ],
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.section_count).toBe(2);
    });

    it('returns error on slug collision (23505)', async () => {
      mocks.chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'duplicate key value', code: '23505' },
      });

      const handler = tools.get('create_guide')!.handler;
      const result = await handler(
        {
          name: 'Duplicate Guide',
          slug: 'existing-slug',
          guide_type: 'custom',
          display_order: 0,
          is_published: false,
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('existing-slug');
      expect(result.content[0].text).toContain('already exists');
    });

    it('returns error when role is denied', async () => {
      mocks.checkMcpRole.mockResolvedValueOnce(null);

      const handler = tools.get('create_guide')!.handler;
      const result = await handler(
        {
          name: 'Forbidden Guide',
          slug: 'forbidden',
          guide_type: 'custom',
          display_order: 0,
          is_published: false,
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
    });

    it('returns warning when section insert fails', async () => {
      // Guide insert succeeds
      mocks.chain.single.mockResolvedValueOnce({
        data: {
          id: GUIDE_UUID,
          name: 'New Guide',
          slug: 'new-guide',
          guide_type: 'custom',
          is_published: false,
        },
        error: null,
      });

      // Section insert fails (tryQuery resolves with error)
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'FK violation' } }),
      );

      const handler = tools.get('create_guide')!.handler;
      const result = await handler(
        {
          name: 'New Guide',
          slug: 'new-guide',
          guide_type: 'custom',
          display_order: 0,
          is_published: false,
          sections: [
            {
              section_name: 'Overview',
              display_order: 0,
              is_required: true,
            },
          ],
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      // Guide still created, but warning about sections
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Guide Created');
      expect(result.content[0].text).toContain('Warnings');
      expect(result.structuredContent.section_count).toBe(0);
      expect(result.structuredContent.warnings).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // update_guide
  // -------------------------------------------------------------------------

  describe('update_guide', () => {
    it('updates guide metadata', async () => {
      // Update query returns rows
      mocks.chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      // Simulate select returning data after update (for 0-row check)
      mocks.chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: GUIDE_UUID }], error: null }),
      );

      // Override: make select().eq().select() chain return the updated rows
      // The update().eq().select() chain resolves via the chain's methods
      // For this test, we mock the update path to return 1 row
      mocks.mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'guides') {
          const guideChain = mocks.createChain();
          guideChain.update = vi.fn().mockReturnValue(guideChain);
          guideChain.eq = vi.fn().mockReturnValue(guideChain);
          guideChain.select = vi.fn().mockReturnValue(guideChain);
          guideChain.then = vi.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [{ id: GUIDE_UUID }], error: null }),
          );
          guideChain.single = vi.fn().mockResolvedValue({
            data: { name: 'Updated Guide' },
            error: null,
          });
          return guideChain;
        }
        return mocks.chain;
      });

      const handler = tools.get('update_guide')!.handler;
      const result = await handler(
        {
          id: GUIDE_UUID,
          fields: { name: 'Updated Guide' },
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Guide Updated');
      expect(result.structuredContent.updated_fields).toContain('name');
    });

    it('returns error when guide not found (0-row update)', async () => {
      mocks.mockSupabaseClient.from.mockImplementation(() => {
        const guideChain = mocks.createChain();
        guideChain.update = vi.fn().mockReturnValue(guideChain);
        guideChain.eq = vi.fn().mockReturnValue(guideChain);
        guideChain.select = vi.fn().mockReturnValue(guideChain);
        guideChain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return guideChain;
      });

      const handler = tools.get('update_guide')!.handler;
      const result = await handler(
        {
          id: GUIDE_UUID,
          fields: { name: 'Ghost Guide' },
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('returns error on slug conflict during rename', async () => {
      mocks.mockSupabaseClient.from.mockImplementation(() => {
        const guideChain = mocks.createChain();
        guideChain.update = vi.fn().mockReturnValue(guideChain);
        guideChain.eq = vi.fn().mockReturnValue(guideChain);
        guideChain.select = vi.fn().mockReturnValue(guideChain);
        guideChain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'duplicate key', code: '23505' } }),
        );
        return guideChain;
      });

      const handler = tools.get('update_guide')!.handler;
      const result = await handler(
        {
          id: GUIDE_UUID,
          fields: { slug: 'taken-slug' },
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('already exists');
    });

    it('returns error when role is denied', async () => {
      mocks.checkMcpRole.mockResolvedValueOnce(null);

      const handler = tools.get('update_guide')!.handler;
      const result = await handler(
        {
          id: GUIDE_UUID,
          fields: { name: 'Forbidden' },
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
    });
  });
});
