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
 *     (lib/upload/folder-drop.ts — the same primitive folder-drop {56.12} uses),
 *     DI'd with the authed, checkMcpRole-gated MCP client (bl-402); the
 *     pipeline then re-derives content_items linkage from the
 *     synchronously-minted source_documents(storage_path) row. No direct
 *     content_items.insert; the response surfaces the real
 *     `sourceDocumentId` (known synchronously) + the source_file correlation
 *     key + a "materialising via pipeline" status for the still-pending
 *     linked content item (bl-402).
 *   - Auth (editor+) and recordPipelineRun audit semantics are preserved.
 *     The on-ingest dedup pre-check (checkExactDuplicate) was retired under
 *     ID-131.15 (G-DEDUP legacy dedup-family retirement, S446) — see
 *     content-create-dedup.test.ts for the dedup-retirement coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VALID_CONTENT_TYPES } from '@/lib/validation/schemas';
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
    stageAndWalk: vi.fn().mockResolvedValue({
      destPath: 'agent-create/some-title.md',
      stageRequestId: 'req-123',
      sourceFile: 'some-title.md',
      sourceDocumentId: 'sd900000-0000-4000-8000-000000000001',
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
    mocks.recordPipelineRun.mockResolvedValue(undefined);
    createTool = await buildCreateTool();
  });

  it('calls reference_ingest (not a direct insert) when source_url is provided', async () => {
    const result = await createTool(
      {
        title: 'Source URL Item',
        content: LONG_CONTENT,
        content_type: 'article',
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
        content_type: 'article',
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
        content_type: 'article',
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
    mocks.recordPipelineRun.mockResolvedValue(undefined);
    mocks.stageAndWalk.mockResolvedValue({
      destPath: 'agent-create/source-less-create.md',
      stageRequestId: 'req-123',
      sourceFile: 'source-less-create.md',
      sourceDocumentId: 'sd200000-0000-4000-8000-000000000001',
    });
    createTool = await buildCreateTool();
  });

  it('writes the content as a file via stageAndWalk and issues no direct insert', async () => {
    const result = await createTool(
      {
        title: 'Source-less Create',
        content: LONG_CONTENT,
        content_type: 'article',
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
    // bl-402: the authed, checkMcpRole-gated MCP client is DI'd into
    // stageAndWalk (least privilege) rather than left to fall back to an
    // internally-created service-role client.
    const stageInput = mocks.stageAndWalk.mock.calls[0][0] as {
      supabase?: unknown;
    };
    expect(stageInput.supabase).toBe(mocks.mockSupabaseClient);
  });

  it('stages UTF-8 bytes of the content under an agent-create/ markdown file', async () => {
    await createTool(
      {
        title: 'Source-less Create',
        content: LONG_CONTENT,
        content_type: 'article',
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

  it('surfaces the synchronously-minted sourceDocumentId + the source_file correlation key (bl-402)', async () => {
    const result = await createTool(
      {
        title: 'Source-less Create',
        content: LONG_CONTENT,
        content_type: 'article',
      },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();
    // The correlation key the caller polls on (mirrors folder-drop status).
    expect(result.structuredContent.source_file).toBe('source-less-create.md');
    // bl-402: stageAndWalk's M2 resolver mints the source_documents identity
    // SYNCHRONOUSLY — surfaced as `id` (no more stale `null`).
    expect(result.structuredContent.id).toBe(
      'sd200000-0000-4000-8000-000000000001',
    );
    expect(result.structuredContent.source_document_id).toBe(
      'sd200000-0000-4000-8000-000000000001',
    );
    // The linked content item still materialises via the ingest walk.
    expect(String(result.structuredContent.status)).toMatch(/materiali/i);
  });

  it('routes source_file-only and source_document_id-only creates through stageAndWalk too', async () => {
    await createTool(
      {
        title: 'File Provenance',
        content: LONG_CONTENT,
        content_type: 'article',
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
    mocks.recordPipelineRun.mockResolvedValue(undefined);
    mocks.stageAndWalk.mockResolvedValue({
      destPath: 'agent-create/preserved.md',
      stageRequestId: 'req-123',
      sourceFile: 'preserved.md',
      sourceDocumentId: 'sd300000-0000-4000-8000-000000000001',
    });
    createTool = await buildCreateTool();
  });

  it('refuses a non-editor caller (auth preserved) and emits a failed pipeline_run', async () => {
    mocks.checkMcpRole.mockResolvedValueOnce(null);

    const result = await createTool(
      {
        title: 'Denied Caller',
        content: LONG_CONTENT,
        content_type: 'article',
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

  it('records a completed pipeline_run for the source-less success path', async () => {
    await createTool(
      {
        title: 'Audit Source-less',
        content: LONG_CONTENT,
        content_type: 'article',
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

// ---------------------------------------------------------------------------
// content_type enum parity (ID-133 BI-3 stay-set) — 4th enforcement surface.
// content.ts hardcodes its own content_type z.enum (an MCP tool input
// schema, decoupled from lib/validation/schemas.ts by design) rather than
// importing VALID_CONTENT_TYPES, which is exactly how it silently drifted
// to a 14-value list (8 BI-3-retired values, missing `document`) while the
// other enforcement surfaces (lib/validation/schemas.ts,
// lib/validation/ingest-schemas.ts, lib/extraction/content-type-detect.ts,
// lib/taxonomy/taxonomy.ts) + scripts/cocoindex_pipeline/prompts.py stayed
// correct. This test pins the two lists together so a 4th drift fails CI
// instead of shipping silently.
// ---------------------------------------------------------------------------
describe('MCP create_content_item — content_type enum parity (ID-133 BI-3 stay-set)', () => {
  it('input schema content_type enum matches the live BI-3 stay-set exactly', async () => {
    const mockServer = createMockMcpServer();
    await registerContentTools(mockServer.server);
    const tool = mockServer.getTool('create_content_item');
    if (!tool) throw new Error('create_content_item not registered');

    const schema = tool.config.inputSchema as {
      content_type: { options: string[] };
    };
    expect([...schema.content_type.options].sort()).toEqual(
      [...VALID_CONTENT_TYPES].sort(),
    );
  });
});
