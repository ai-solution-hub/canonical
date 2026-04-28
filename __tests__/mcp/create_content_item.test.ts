/**
 * MCP `create_content_item` — S205 WP-A Phase 1 (WP-A1 + WP-A2).
 *
 * Covers:
 *   - WP-A1: typed-column persistence (source_url / source_file /
 *     source_document_id) — spec §3.1 AC1.1, AC1.2.
 *   - WP-A1: legacy `source_document` arg → Zod rejection with
 *     replacement-field hint — spec §3.1 AC1.5, AC1.7.
 *   - WP-A2: `recordPipelineRun()` called with pipeline_name
 *     `'mcp_create_content_item'` for success / partial-failure / draft —
 *     spec §3.2 AC2.1–2.5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
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
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );
    return chain;
  };

  const chain = createChain();

  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    _chain: chain,
  };

  return {
    mockSupabaseClient,
    chain,
    createMcpClient: vi.fn().mockReturnValue(mockSupabaseClient),
    getMcpUserId: vi
      .fn()
      .mockReturnValue('a0000000-0000-4000-8000-000000000001'),
    checkMcpRole: vi.fn(),
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
    classifyContent: vi.fn().mockResolvedValue(undefined),
    generateSummary: vi.fn().mockResolvedValue(undefined),
    recordPipelineRun: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/mcp/tools/shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp/tools/shared')>(
    '@/lib/mcp/tools/shared',
  );
  return {
    ...actual,
    getGenerateEmbedding: vi.fn().mockResolvedValue(mocks.generateEmbedding),
    getClassifyContent: vi.fn().mockResolvedValue(mocks.classifyContent),
    getGenerateSummary: vi.fn().mockResolvedValue(mocks.generateSummary),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mocks.mockSupabaseClient),
}));

vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: vi.fn().mockResolvedValue({ errors: [] }),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn().mockReturnValue({
    suggestedLayer: 'capability',
    reason: '',
    confidence: 'high',
  }),
}));

vi.mock('@/lib/guide-section-mapping', () => ({
  suggestGuideSections: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: mocks.recordPipelineRun,
}));

// Import after mocks
import { registerContentTools } from '@/lib/mcp/tools/content';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface RegisteredTool {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, extra: any) => Promise<any>;
}

function createTestServer(): {
  server: McpServer;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        config: RegisteredTool['config'],
        handler: RegisteredTool['handler'],
      ) => {
        tools.set(name, { name, config, handler });
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
  extra: {
    userId: 'a0000000-0000-4000-8000-000000000001',
    role: 'editor',
  },
};

const NEW_ITEM_ID = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
const SOURCE_DOC_ID = 'b2c3d4e5-f6a7-4890-9bcd-ef0123456789';

const LONG_CONTENT =
  'This is sufficiently long markdown content that exceeds the 50-character minimum for dedup hash checks. It describes our organisation capability.';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Find the content_items insert from the shared `chain.insert` mock.
 * The handler issues two inserts via the shared chain — first into
 * `content_items` (which carries `content_type`), then into
 * `content_history` (which does not). Indexing by `[0]` is brittle if the
 * order ever changes (e.g., a pre-insert audit row is added). Filter by
 * the `content_type` field to make the lookup order-independent.
 *
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
function findContentItemsInsert(insertMock: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mock: { calls: any[][] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = insertMock.mock.calls.find((args: any[]) => {
    const payload = args?.[0];
    return (
      payload != null &&
      typeof payload === 'object' &&
      'content_type' in payload
    );
  });
  return call?.[0];
}

describe('MCP create_content_item — S205 WP-A1 typed provenance', () => {
  let createTool: RegisteredTool['handler'];
  let createConfig: RegisteredTool['config'];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-register default implementations cleared by clearAllMocks
    mocks.mockSupabaseClient.from.mockReturnValue(mocks.chain);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: [], error: null });
    mocks.chain.select.mockReturnValue(mocks.chain);
    mocks.chain.insert.mockReturnValue(mocks.chain);
    mocks.chain.update.mockReturnValue(mocks.chain);
    mocks.chain.eq.mockReturnValue(mocks.chain);

    const { server, tools } = createTestServer();
    await registerContentTools(server);
    const tool = tools.get('create_content_item');
    if (!tool) throw new Error('create_content_item not registered');
    createTool = tool.handler;
    createConfig = tool.config;

    // Default: editor role
    mocks.checkMcpRole.mockResolvedValue('editor');

    // Default insert returns the new item
    mocks.chain.single.mockResolvedValue({
      data: {
        id: NEW_ITEM_ID,
        title: 'New Item',
        content_type: 'capability',
      },
      error: null,
    });

    mocks.recordPipelineRun.mockResolvedValue(undefined);
  });

  describe('typed-column persistence (1.1-AC1, 1.1-AC2)', () => {
    it('persists source_url to the typed column when provided', async () => {
      const result = await createTool(
        {
          title: 'Source URL Item',
          content: LONG_CONTENT,
          content_type: 'capability',
          source_url: 'https://example.com/docs/page',
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeFalsy();
      const insertCall = findContentItemsInsert(mocks.chain.insert);
      expect(insertCall.source_url).toBe('https://example.com/docs/page');
      expect(insertCall.source_file).toBeUndefined();
      expect(insertCall.source_document_id).toBeUndefined();
      // Legacy metadata.source_document must not be written.
      expect(insertCall.metadata?.source_document).toBeUndefined();
      // Structured response surfaces the typed value.
      expect(result.structuredContent.source_url).toBe(
        'https://example.com/docs/page',
      );
      expect(result.structuredContent.source_file).toBeNull();
      expect(result.structuredContent.source_document_id).toBeNull();
    });

    it('persists source_file to the typed column when provided', async () => {
      const result = await createTool(
        {
          title: 'Source File Item',
          content: LONG_CONTENT,
          content_type: 'capability',
          source_file: 'docs/handbook/section-3.md',
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeFalsy();
      const insertCall = findContentItemsInsert(mocks.chain.insert);
      expect(insertCall.source_file).toBe('docs/handbook/section-3.md');
      expect(insertCall.source_url).toBeUndefined();
      expect(insertCall.source_document_id).toBeUndefined();
      expect(insertCall.metadata?.source_document).toBeUndefined();
      expect(result.structuredContent.source_file).toBe(
        'docs/handbook/section-3.md',
      );
    });

    it('persists source_document_id to the typed column when provided', async () => {
      const result = await createTool(
        {
          title: 'Source Doc Lineage',
          content: LONG_CONTENT,
          content_type: 'capability',
          source_document_id: SOURCE_DOC_ID,
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeFalsy();
      const insertCall = findContentItemsInsert(mocks.chain.insert);
      expect(insertCall.source_document_id).toBe(SOURCE_DOC_ID);
      expect(insertCall.source_url).toBeUndefined();
      expect(insertCall.source_file).toBeUndefined();
      expect(insertCall.metadata?.source_document).toBeUndefined();
      expect(result.structuredContent.source_document_id).toBe(SOURCE_DOC_ID);
    });

    // S207 WP-A4 (Plan Task 3.2): typed ingest_source column. Read by
    // ensure_v1_history_at_commit() trigger to set
    // content_history.change_reason='initial_ingest'.
    it('writes ingest_source="mcp_create" to the content_items insert payload', async () => {
      const result = await createTool(
        {
          title: 'Ingest Source MCP',
          content: LONG_CONTENT,
          content_type: 'capability',
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeFalsy();
      const insertCall = findContentItemsInsert(mocks.chain.insert);
      expect(insertCall.ingest_source).toBe('mcp_create');
    });
  });

  describe('legacy source_document arg rejection (1.1-AC3)', () => {
    it('Zod schema rejects source_document with a helpful replacement-field message', () => {
      // The MCP SDK builds `z.object(inputSchema)` on the registered shape.
      // We re-construct the same z.object and parse a payload containing
      // `source_document` to assert the boundary error surfaces.
      const schema = z.object(createConfig.inputSchema);

      const parsed = schema.safeParse({
        title: 'Legacy Caller',
        content: LONG_CONTENT,
        content_type: 'capability',
        source_document: 'old/file/path.md',
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        const sourceDocumentIssue = issues.find((i) =>
          i.path.includes('source_document'),
        );
        expect(sourceDocumentIssue).toBeDefined();
        // Error message MUST advertise the three replacement fields.
        const message = sourceDocumentIssue!.message;
        expect(message).toContain('source_url');
        expect(message).toContain('source_file');
        expect(message).toContain('source_document_id');
      }
    });

    it('Zod schema accepts the three typed replacements', () => {
      const schema = z.object(createConfig.inputSchema);

      // source_url
      expect(
        schema.safeParse({
          title: 'a',
          content: LONG_CONTENT,
          content_type: 'capability',
          source_url: 'https://example.com',
        }).success,
      ).toBe(true);

      // source_file
      expect(
        schema.safeParse({
          title: 'a',
          content: LONG_CONTENT,
          content_type: 'capability',
          source_file: 'path/to/file.md',
        }).success,
      ).toBe(true);

      // source_document_id (UUID v4)
      expect(
        schema.safeParse({
          title: 'a',
          content: LONG_CONTENT,
          content_type: 'capability',
          source_document_id: SOURCE_DOC_ID,
        }).success,
      ).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // S206 WP-A Phase 2 — content_owner_id default + admin override
  // ───────────────────────────────────────────────────────────────────

  describe('content_owner_id default + admin override (S206 AC3.1, AC3.3, AC3.8)', () => {
    const SERVICE_USER_UUID = 'a0000000-0000-4000-8000-000000000001';
    const OTHER_OWNER_UUID = '11111111-2222-4333-8444-555555555555';

    it('defaults content_owner_id to MCP caller userId (editor)', async () => {
      const result = await createTool(
        {
          title: 'Owner Default',
          content: LONG_CONTENT,
          content_type: 'capability',
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeFalsy();
      const insertCall = findContentItemsInsert(mocks.chain.insert);
      expect(insertCall.content_owner_id).toBe(SERVICE_USER_UUID);
      expect(insertCall.created_by).toBe(SERVICE_USER_UUID);
    });

    it('admin override: explicit content_owner_id is respected when caller is admin', async () => {
      mocks.checkMcpRole.mockResolvedValue('admin');

      const result = await createTool(
        {
          title: 'Admin Override',
          content: LONG_CONTENT,
          content_type: 'capability',
          content_owner_id: OTHER_OWNER_UUID,
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeFalsy();
      const insertCall = findContentItemsInsert(mocks.chain.insert);
      expect(insertCall.content_owner_id).toBe(OTHER_OWNER_UUID);
      expect(insertCall.created_by).toBe(SERVICE_USER_UUID);
    });

    it('non-admin override is silent-forced: explicit content_owner_id ignored for editor', async () => {
      // checkMcpRole defaults to 'editor' in beforeEach
      const result = await createTool(
        {
          title: 'Silent Force',
          content: LONG_CONTENT,
          content_type: 'capability',
          content_owner_id: OTHER_OWNER_UUID,
        },
        { authInfo: MOCK_AUTH_INFO },
      );

      expect(result.isError).toBeFalsy();
      const insertCall = findContentItemsInsert(mocks.chain.insert);
      expect(insertCall.content_owner_id).toBe(SERVICE_USER_UUID);
    });

    it('Zod schema accepts an optional content_owner_id UUID', () => {
      const schema = z.object(createConfig.inputSchema);

      expect(
        schema.safeParse({
          title: 'a',
          content: LONG_CONTENT,
          content_type: 'capability',
          content_owner_id: OTHER_OWNER_UUID,
        }).success,
      ).toBe(true);
    });

    it('Zod schema rejects a non-UUID content_owner_id', () => {
      const schema = z.object(createConfig.inputSchema);

      expect(
        schema.safeParse({
          title: 'a',
          content: LONG_CONTENT,
          content_type: 'capability',
          content_owner_id: 'not-a-uuid',
        }).success,
      ).toBe(false);
    });
  });
});

describe('MCP create_content_item — S205 WP-A2 pipeline_runs', () => {
  let createTool: RegisteredTool['handler'];

  beforeEach(async () => {
    vi.clearAllMocks();

    mocks.mockSupabaseClient.from.mockReturnValue(mocks.chain);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: [], error: null });
    mocks.chain.select.mockReturnValue(mocks.chain);
    mocks.chain.insert.mockReturnValue(mocks.chain);
    mocks.chain.update.mockReturnValue(mocks.chain);
    mocks.chain.eq.mockReturnValue(mocks.chain);

    const { server, tools } = createTestServer();
    await registerContentTools(server);
    const tool = tools.get('create_content_item');
    if (!tool) throw new Error('create_content_item not registered');
    createTool = tool.handler;

    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.chain.single.mockResolvedValue({
      data: {
        id: NEW_ITEM_ID,
        title: 'New Item',
        content_type: 'capability',
      },
      error: null,
    });
    mocks.recordPipelineRun.mockResolvedValue(undefined);
  });

  it('records a pipeline_run with status="completed" on the success path (1.1-AC5/6/7/8)', async () => {
    await createTool(
      {
        title: 'Successful Create',
        content: LONG_CONTENT,
        content_type: 'capability',
        source_file: 'docs/spec.md',
        batch_tag: 'reorient-2026-04',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    // Exactly one call to recordPipelineRun for the success path.
    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.pipelineName).toBe('mcp_create_content_item');
    expect(call.status).toBe('completed');
    expect(call.itemsProcessed).toBe(1);
    expect(call.itemsCreated).toEqual([NEW_ITEM_ID]);
    expect(call.errorMessage).toBeNull();
    expect(call.result).toMatchObject({
      source_url: null,
      source_file: 'docs/spec.md',
      source_document_id: null,
      batch_tag: 'reorient-2026-04',
      dedup_status: 'clean',
      skipped_reason: null,
    });
  });

  it('records status="completed_with_errors" when AI sub-steps throw (1.1-AC7)', async () => {
    // Make classifyContent throw so the warnings array becomes non-empty.
    mocks.classifyContent.mockRejectedValueOnce(
      new Error('classification timed out'),
    );

    await createTool(
      {
        title: 'Partial Failure Create',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.status).toBe('completed_with_errors');
    expect(call.errorMessage).toContain('classification timed out');
    expect(call.itemsCreated).toEqual([NEW_ITEM_ID]);
  });

  it('records status="failed" when content_items insert fails', async () => {
    // Force the insert .single() to return an error.
    mocks.chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'duplicate key value violates unique constraint' },
    });

    const result = await createTool(
      {
        title: 'Insert Failure',
        content: LONG_CONTENT,
        content_type: 'capability',
        source_url: 'https://example.com/x',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.pipelineName).toBe('mcp_create_content_item');
    expect(call.status).toBe('failed');
    expect(call.itemsCreated).toBeNull();
    expect(call.errorMessage).toContain('duplicate key value');
    expect(call.result).toMatchObject({
      source_url: 'https://example.com/x',
      source_file: null,
      source_document_id: null,
      dedup_status: 'clean',
      skipped_reason: null,
    });
  });

  // S207 WP4 (OPS-38): The pre-success failed-insert branch previously used
  // the RLS-scoped `supabase` client which cannot write `pipeline_runs`
  // (RLS policy `pipeline_runs_insert` requires editor+; admin-only). Editor
  // callers hitting this branch silently lost the audit row. The fix mirrors
  // S206 WP4 auth-fail and outer-catch patterns by lazy-importing
  // `createServiceClient`. This test asserts the service-role client (NOT
  // the RLS-scoped MCP client) is passed to recordPipelineRun.
  it('uses service-role client (not RLS-scoped) for pre-success failed-insert pipeline_runs (OPS-38)', async () => {
    // Distinct service-role client mock so we can verify the right client
    // is passed. The default mock in the file aliases createServiceClient
    // to the same instance as createMcpClient — re-mock here for this test.
    const distinctServiceClient = {
      from: vi.fn(),
      rpc: vi.fn(),
      __isServiceRoleMarker: true,
    };
    const serverModule = await import('@/lib/supabase/server');
    const createServiceClientMock = vi.mocked(serverModule.createServiceClient);
    createServiceClientMock.mockReturnValueOnce(
      distinctServiceClient as unknown as ReturnType<
        typeof serverModule.createServiceClient
      >,
    );

    // Force the insert .single() to return an error so the pre-success
    // failed-insert branch fires.
    mocks.chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'rls policy violation' },
    });

    const result = await createTool(
      {
        title: 'Pre-Success Insert Failure',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.status).toBe('failed');
    // Service-role client used — NOT the RLS-scoped MCP client.
    expect(call.supabase).toBe(distinctServiceClient);
    expect(call.supabase).not.toBe(mocks.mockSupabaseClient);
    expect(createServiceClientMock).toHaveBeenCalled();
  });

  it('records skipped_reason="draft" on the draft branch (1.1-AC9)', async () => {
    await createTool(
      {
        title: 'Draft Create',
        content: LONG_CONTENT,
        content_type: 'capability',
        publication_status: 'draft',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.status).toBe('completed');
    expect(call.result).toMatchObject({
      skipped_reason: 'draft',
    });
    // Draft branch skips the AI sub-steps entirely → no warnings.
    expect(call.errorMessage).toBeNull();
  });

  // S206 WP4 (S205 verifier deferral M-2): AC2.1 mandates pipeline_runs on
  // ALL invocation paths — these two cases close the auth-fail and
  // outer-catch gaps left open by S205.
  it('records status="failed" with phase="auth_check" on auth-fail (S206 WP4)', async () => {
    // Force the role check to deny.
    mocks.checkMcpRole.mockResolvedValueOnce(null);

    const result = await createTool(
      {
        title: 'Denied Caller',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    // Single emission — the auth-fail short-circuits before the success path.
    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.pipelineName).toBe('mcp_create_content_item');
    expect(call.status).toBe('failed');
    expect(call.errorMessage).toBe('permission_denied');
    expect(call.itemsProcessed).toBe(0);
    expect(call.itemsCreated).toBeNull();
    expect(call.result).toMatchObject({
      phase: 'auth_check',
      auth_info_present: true,
    });
  });

  it('records status="failed" with phase="handler_catch_all" on outer catch (S206 WP4)', async () => {
    // Force checkMcpRole to throw AFTER returning a successful resolve so
    // execution enters the try-block and a later operation throws. The
    // simplest reliable trigger: make checkMcpRole itself throw — control
    // is inside the outer try, so the throw lands in the outer catch
    // (not the auth-fail return path, which only fires on null).
    mocks.checkMcpRole.mockRejectedValueOnce(new Error('role lookup blew up'));

    const result = await createTool(
      {
        title: 'Catch-All Caller',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    // Outer text surfaces the original error message.
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Failed to create item');
    expect(text).toContain('role lookup blew up');

    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.pipelineName).toBe('mcp_create_content_item');
    expect(call.status).toBe('failed');
    expect(call.errorMessage).toBe('role lookup blew up');
    expect(call.itemsProcessed).toBe(0);
    expect(call.itemsCreated).toBeNull();
    expect(call.result).toMatchObject({
      phase: 'handler_catch_all',
    });
  });
});
