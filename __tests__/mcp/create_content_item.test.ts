/**
 * MCP `create_content_item` — ID-71.16 write-to-canonical-store create-leg.
 *
 * Behaviour-first (test-philosophy.md) assertions of the provenance-routed
 * create-leg that REPLACES the prior direct `content_items.insert`
 * (PRODUCT.md §OQ-1 Option A — RATIFIED FILE-BACKED, OQ-71.16-1; B-INV-6 +
 * B-INV-12):
 *
 *   - URL branch (args.source_url present) routes through the existing
 *     `reference_ingest` RPC (B-25: signature unchanged) — the same evidence-pair
 *     seam app/api/ingest/url/route.ts uses. No direct content_items.insert.
 *   - Source-less branch (no source_url) writes the markdown `content` arg AS A
 *     FILE into the cocoindex source-binding folder via `stageAndWalk`
 *     (lib/upload/folder-drop.ts — the same primitive folder-drop {56.12} uses);
 *     the pipeline then re-derives source_documents(storage_path)+content_items.
 *     No direct content_items.insert; the response carries the source_file
 *     correlation key + a "materialising via pipeline" (eventually-consistent)
 *     status, NOT a synchronous row id.
 *   - Auth (editor+), dedup (checkExactDuplicate), and recordPipelineRun audit
 *     semantics are preserved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockMcpServer,
  type MockToolHandler,
} from '@/__tests__/helpers/mcp-server';

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
    // reference_ingest returns the minted evidence-pair row(s).
    rpc: vi.fn().mockResolvedValue({
      data: [
        {
          reference_id: 'ref00000-0000-4000-8000-000000000001',
          source_document_id: 'sd000000-0000-4000-8000-000000000001',
          title: 'Ref Title',
          summary: null,
          source_url: 'https://example.com/docs/page',
          primary_domain: null,
          primary_subtopic: null,
          already_existed: false,
        },
      ],
      error: null,
    }),
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
    classifyText: vi.fn().mockResolvedValue({
      primary_domain: 'operations',
      primary_subtopic: 'process',
    }),
    recordPipelineRun: vi.fn().mockResolvedValue(undefined),
    checkExactDuplicate: vi
      .fn()
      .mockResolvedValue({ isDuplicate: false, existingId: undefined }),
    resolveDedupStamp: vi.fn().mockReturnValue({ dedup_status: 'clean' }),
    stageAndWalk: vi.fn().mockResolvedValue({
      destPath: 'agent-create/some-title.md',
      stageRequestId: 'req-123',
      sourceFile: 'some-title.md',
    }),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: vi.fn().mockResolvedValue('editor'),
  checkMcpRole: mocks.checkMcpRole,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mocks.mockSupabaseClient),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: mocks.recordPipelineRun,
}));

vi.mock('@/lib/dedup/content-dedup', () => ({
  checkExactDuplicate: mocks.checkExactDuplicate,
  resolveDedupStamp: mocks.resolveDedupStamp,
}));

// The create-leg's source-less branch stages the markdown content as a file.
vi.mock('@/lib/upload/folder-drop', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/upload/folder-drop')
  >('@/lib/upload/folder-drop');
  return {
    ...actual,
    stageAndWalk: mocks.stageAndWalk,
  };
});

// The URL branch derives an embedding + classification before calling
// reference_ingest (mirrors app/api/ingest/url/route.ts).
vi.mock('@/lib/ai/embed', () => ({
  MAX_EMBEDDING_CHARS: 24_000,
}));

vi.mock('@/lib/ai/classify', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/ai/classify')>(
      '@/lib/ai/classify',
    );
  return {
    ...actual,
    classifyText: mocks.classifyText,
  };
});

vi.mock('@/lib/mcp/tools/shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp/tools/shared')>(
    '@/lib/mcp/tools/shared',
  );
  return {
    ...actual,
    getGenerateEmbedding: vi.fn().mockResolvedValue(mocks.generateEmbedding),
  };
});

// Import after mocks
import { registerContentTools } from '@/lib/mcp/tools/content';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const MOCK_AUTH_INFO = {
  token: 'test-token',
  clientId: 'test-client',
  scopes: ['read', 'write'],
  extra: {
    userId: 'a0000000-0000-4000-8000-000000000001',
    role: 'editor',
  },
};

const LONG_CONTENT =
  'This is sufficiently long markdown content that exceeds the 50-character minimum for dedup hash checks. It describes our organisation capability.';

/**
 * The handler MUST NOT issue a direct content_items insert any more — the
 * canonical store (reference_ingest for URLs, stageAndWalk for source-less
 * creates) owns row materialisation. Assert the insert mock never carried a
 * content_items payload (a payload with a `content_type` field).
 */
function assertNoContentItemsInsert(insertMock: {
  mock: { calls: unknown[][] };
}): void {
  const contentItemsInsert = insertMock.mock.calls.find((args) => {
    const payload = args?.[0];
    return (
      payload != null &&
      typeof payload === 'object' &&
      'content_type' in (payload as Record<string, unknown>)
    );
  });
  expect(contentItemsInsert).toBeUndefined();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function buildCreateTool(): Promise<MockToolHandler> {
  const mockServer = createMockMcpServer();
  await registerContentTools(mockServer.server);
  const tool = mockServer.getTool('create_content_item');
  if (!tool) throw new Error('create_content_item not registered');
  return tool.handler;
}

describe('MCP create_content_item — URL branch routes via reference_ingest', () => {
  let createTool: MockToolHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockSupabaseClient.from.mockReturnValue(mocks.chain);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({
      data: [
        {
          reference_id: 'ref00000-0000-4000-8000-000000000001',
          source_document_id: 'sd000000-0000-4000-8000-000000000001',
          title: 'Ref Title',
          summary: null,
          source_url: 'https://example.com/docs/page',
          primary_domain: null,
          primary_subtopic: null,
          already_existed: false,
        },
      ],
      error: null,
    });
    mocks.chain.select.mockReturnValue(mocks.chain);
    mocks.chain.insert.mockReturnValue(mocks.chain);
    mocks.chain.update.mockReturnValue(mocks.chain);
    mocks.chain.eq.mockReturnValue(mocks.chain);
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.checkExactDuplicate.mockResolvedValue({
      isDuplicate: false,
      existingId: undefined,
    });
    mocks.resolveDedupStamp.mockReturnValue({ dedup_status: 'clean' });
    mocks.recordPipelineRun.mockResolvedValue(undefined);
    createTool = await buildCreateTool();
  });

  it('calls reference_ingest (not a direct insert) when source_url is provided', async () => {
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
    // reference_ingest is the seam; no direct content_items.insert.
    expect(mocks.mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'reference_ingest',
      expect.anything(),
    );
    assertNoContentItemsInsert(mocks.chain.insert);
  });

  it('passes the unaltered reference_ingest arg shape (B-25 RPC signature)', async () => {
    await createTool(
      {
        title: 'Source URL Item',
        content: LONG_CONTENT,
        content_type: 'capability',
        source_url: 'https://example.com/docs/page',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    const rpcCall = mocks.mockSupabaseClient.rpc.mock.calls.find(
      (c) => c[0] === 'reference_ingest',
    );
    expect(rpcCall).toBeDefined();
    const args = rpcCall![1] as Record<string, unknown>;
    // The 12 required positional params of the reference_ingest signature must
    // all be present (p_op_id / p_extraction_metadata are DEFAULTed). Asserting
    // the key set guards against an accidental signature drift (B-25).
    for (const key of [
      'p_source_url',
      'p_title',
      'p_body',
      'p_summary',
      'p_primary_domain',
      'p_primary_subtopic',
      'p_embedding',
      'p_published_at',
      'p_filename',
      'p_mime_type',
      'p_file_size',
      'p_content_hash',
    ]) {
      expect(args).toHaveProperty(key);
    }
    // The pasted content is the reference body; the source_url the seed.
    expect(args.p_source_url).toBe('https://example.com/docs/page');
    expect(args.p_body).toBe(LONG_CONTENT);
  });

  it('surfaces the minted reference id in the response', async () => {
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
    expect(result.structuredContent.id).toBe(
      'ref00000-0000-4000-8000-000000000001',
    );
    expect(result.structuredContent.source_url).toBe(
      'https://example.com/docs/page',
    );
  });
});

describe('MCP create_content_item — source-less branch stages a file via stageAndWalk', () => {
  let createTool: MockToolHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockSupabaseClient.from.mockReturnValue(mocks.chain);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: [], error: null });
    mocks.chain.select.mockReturnValue(mocks.chain);
    mocks.chain.insert.mockReturnValue(mocks.chain);
    mocks.chain.update.mockReturnValue(mocks.chain);
    mocks.chain.eq.mockReturnValue(mocks.chain);
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.checkExactDuplicate.mockResolvedValue({
      isDuplicate: false,
      existingId: undefined,
    });
    mocks.resolveDedupStamp.mockReturnValue({ dedup_status: 'clean' });
    mocks.recordPipelineRun.mockResolvedValue(undefined);
    mocks.stageAndWalk.mockResolvedValue({
      destPath: 'agent-create/source-less-create.md',
      stageRequestId: 'req-123',
      sourceFile: 'source-less-create.md',
    });
    createTool = await buildCreateTool();
  });

  it('writes the content as a file via stageAndWalk and issues no direct insert', async () => {
    const result = await createTool(
      {
        title: 'Source-less Create',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();
    expect(mocks.stageAndWalk).toHaveBeenCalledTimes(1);
    assertNoContentItemsInsert(mocks.chain.insert);
    // reference_ingest is the URL-only branch — not used for source-less.
    expect(mocks.mockSupabaseClient.rpc).not.toHaveBeenCalledWith(
      'reference_ingest',
      expect.anything(),
    );
  });

  it('stages UTF-8 bytes of the content under an agent-create/ markdown file', async () => {
    await createTool(
      {
        title: 'Source-less Create',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    const input = mocks.stageAndWalk.mock.calls[0][0] as {
      bytes: Uint8Array;
      filename: string;
      destPath: string;
      contentType?: string;
    };
    // Bytes are the UTF-8 encoding of the markdown content.
    expect(new TextDecoder().decode(input.bytes)).toBe(LONG_CONTENT);
    // Filename is a slug of the title with a .md extension.
    expect(input.filename).toMatch(/\.md$/);
    expect(input.filename).toContain('source-less-create');
    // destPath lives under the distinct agent-create/ corpus subdir (POSIX).
    expect(input.destPath.startsWith('agent-create/')).toBe(true);
    expect(input.destPath.endsWith(input.filename)).toBe(true);
    expect(input.contentType).toBe('text/markdown');
  });

  it('returns the source_file correlation key + an eventually-consistent status (no synchronous row id)', async () => {
    const result = await createTool(
      {
        title: 'Source-less Create',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();
    // The correlation key the caller polls on (mirrors folder-drop status).
    expect(result.structuredContent.source_file).toBe('source-less-create.md');
    // No synchronous content_items row id — the pipeline materialises it.
    expect(result.structuredContent.id ?? null).toBeNull();
    // The status communicates eventual consistency.
    expect(String(result.structuredContent.status)).toMatch(/materiali/i);
  });

  it('routes source_file-only and source_document_id-only creates through stageAndWalk too', async () => {
    await createTool(
      {
        title: 'File Provenance',
        content: LONG_CONTENT,
        content_type: 'capability',
        source_file: 'docs/handbook/section-3.md',
      },
      { authInfo: MOCK_AUTH_INFO },
    );
    expect(mocks.stageAndWalk).toHaveBeenCalledTimes(1);
    assertNoContentItemsInsert(mocks.chain.insert);
  });
});

describe('MCP create_content_item — preserved cross-cutting semantics', () => {
  let createTool: MockToolHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockSupabaseClient.from.mockReturnValue(mocks.chain);
    mocks.mockSupabaseClient.rpc.mockResolvedValue({ data: [], error: null });
    mocks.chain.select.mockReturnValue(mocks.chain);
    mocks.chain.insert.mockReturnValue(mocks.chain);
    mocks.chain.update.mockReturnValue(mocks.chain);
    mocks.chain.eq.mockReturnValue(mocks.chain);
    mocks.checkMcpRole.mockResolvedValue('editor');
    mocks.checkExactDuplicate.mockResolvedValue({
      isDuplicate: false,
      existingId: undefined,
    });
    mocks.resolveDedupStamp.mockReturnValue({ dedup_status: 'clean' });
    mocks.recordPipelineRun.mockResolvedValue(undefined);
    mocks.stageAndWalk.mockResolvedValue({
      destPath: 'agent-create/preserved.md',
      stageRequestId: 'req-123',
      sourceFile: 'preserved.md',
    });
    createTool = await buildCreateTool();
  });

  it('refuses a non-editor caller (auth preserved) and emits a failed pipeline_run', async () => {
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
    expect(mocks.stageAndWalk).not.toHaveBeenCalled();
    expect(mocks.mockSupabaseClient.rpc).not.toHaveBeenCalledWith(
      'reference_ingest',
      expect.anything(),
    );
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.status).toBe('failed');
    expect(call.errorMessage).toBe('permission_denied');
  });

  it('runs the exact-duplicate dedup check before staging', async () => {
    await createTool(
      {
        title: 'Dedup Check',
        content: LONG_CONTENT,
        content_type: 'capability',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(mocks.checkExactDuplicate).toHaveBeenCalledWith(
      mocks.mockSupabaseClient,
      LONG_CONTENT,
    );
  });

  it('records a completed pipeline_run for the source-less success path', async () => {
    await createTool(
      {
        title: 'Audit Source-less',
        content: LONG_CONTENT,
        content_type: 'capability',
        batch_tag: 'agent-2026-06',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(mocks.recordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mocks.recordPipelineRun.mock.calls[0][0];
    expect(call.pipelineName).toBe('mcp_create_content_item');
    expect(call.status).toBe('completed');
    expect(call.result).toMatchObject({ batch_tag: 'agent-2026-06' });
  });
});
