/**
 * @vitest-environment jsdom
 *
 * EP2 §1.11 markdown-batch UI ingest — draft/final → publication_status
 * mapping (mock-API layer).
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §10.4 (mock layer subset).
 * Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T7 acceptance criterion (d).
 *
 * Asserts the actual INSERT payload that lands in `content_items` for each
 * draft/final precedence path:
 *   1. per-file override (`draft_or_final`)
 *   2. front-matter `draft: true` (overrides filename)
 *   3. front-matter `status: final|draft|published|live`
 *   4. filename heuristic ('-draft' / '-final' substring, case-insensitive)
 *
 * Also covers spec §9.2 invariants:
 *   - 'final' → 'in_review' (D-A baked in — NOT 'published')
 *   - 'unknown' → 'draft' (conservative)
 *   - `governance_review_status` field is OMITTED on every row (NULL by default).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

const fmMocks = vi.hoisted(() => ({
  parseMarkdownFrontMatter: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  };
});

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/dedup', () => ({
  checkExactDuplicate: vi.fn().mockResolvedValue({ isDuplicate: false }),
  resolveDedupStamp: vi.fn().mockReturnValue({ dedup_status: 'clean' }),
  normaliseTextForHash: vi
    .fn()
    .mockImplementation((s: string) => s.toLowerCase()),
}));

vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: vi.fn().mockResolvedValue({ stored: 1, errors: [] }),
}));

vi.mock('@/lib/extraction/markdown-front-matter', () => ({
  parseMarkdownFrontMatter: fmMocks.parseMarkdownFrontMatter,
}));

vi.mock('@/lib/extraction/markdown-title', () => ({
  extractMarkdownTitle: vi
    .fn()
    .mockImplementation(({ filename }: { filename: string }) => ({
      title: filename.replace(/\.md$/i, ''),
      provenance: 'filename' as const,
    })),
}));

vi.mock('@/lib/extraction/clean-mdx-tags', () => ({
  cleanMdxTags: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock('@/lib/extraction/diff-markers', () => ({
  detectDiffMarkers: vi.fn().mockReturnValue({
    gitConflictCount: 0,
    plusMinusLineCount: 0,
    warning: false,
  }),
}));

vi.mock('@/lib/pipeline/start-run', () => ({
  startPipelineRun: vi
    .fn()
    .mockImplementation(
      async (params: { id?: string }) => params.id ?? 'run-1',
    ),
}));

vi.mock('@/lib/pipeline/update-progress', () => ({
  updatePipelineProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/owner-default', () => ({
  resolveContentOwnerId: vi
    .fn()
    .mockImplementation(({ userId }: { userId: string }) => userId),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (s: { setContext: () => void }) => void) =>
    fn({ setContext: () => undefined }),
  ),
}));

import { POST } from '@/app/api/ingest/markdown/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CALLER_USER_ID = 'a0000000-0000-4000-8000-000000000aaa';

function createMockFile(content: string, name: string): File {
  const bytes = new TextEncoder().encode(content);
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'text/markdown',
  });
  return Object.create(File.prototype, {
    name: { value: name, writable: false },
    type: { value: 'text/markdown', writable: false },
    size: { value: bytes.length, writable: false },
    arrayBuffer: { value: () => blob.arrayBuffer(), writable: false },
  }) as File;
}

function buildBatchRequest(args: {
  phase: 'analyse' | 'import';
  files: File[];
  options?: object;
}): import('next/server').NextRequest {
  const req = createTestRequest('/api/ingest/markdown', {
    method: 'POST',
    body: {},
  });

  const formData = new FormData();
  formData.get = vi.fn((key: string) => {
    if (key === 'phase') return args.phase;
    if (key === 'options') {
      return args.options ? JSON.stringify(args.options) : null;
    }
    return null;
  }) as unknown as typeof formData.get;
  formData.getAll = vi.fn((key: string) => {
    if (key === 'files[]') return args.files;
    return [];
  }) as unknown as typeof formData.getAll;

  (req as unknown as { formData: () => Promise<FormData> }).formData = vi
    .fn()
    .mockResolvedValue(formData);

  return req;
}

function configureImportSuccess(perFileIds: string[]) {
  for (const id of perFileIds) {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id, title: `Item ${id}` },
      error: null,
    });
  }
}

function findContentItemsInsert(): Record<string, unknown> {
  const inserts = mockSupabase._chain.insert.mock.calls;
  const call = inserts.find(
    (c: unknown[]) =>
      typeof c[0] === 'object' &&
      c[0] !== null &&
      'publication_status' in (c[0] as Record<string, unknown>),
  );
  if (!call) throw new Error('content_items insert not found');
  return call[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: CALLER_USER_ID, email: 'e@test' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  const chainable = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // Default front-matter parser: no FM block.
  fmMocks.parseMarkdownFrontMatter.mockImplementation((c: string) => ({
    frontMatter: null,
    body: c,
  }));
});

// ---------------------------------------------------------------------------
// Tests — Spec §10.4 + Plan EP2-T7 (d)
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — draft/final → publication_status mapping', () => {
  it("override draft_or_final='draft' → publication_status='draft'", async () => {
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['id-draft']);

    const file = createMockFile('# Body\n\ncontent', 'foo.md');
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
      options: {
        per_file_overrides: [{ filename: 'foo.md', draft_or_final: 'draft' }],
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = findContentItemsInsert();
    expect(payload.publication_status).toBe('draft');
    expect(payload).not.toHaveProperty('governance_review_status');
  });

  it("override draft_or_final='final' → publication_status='in_review' (D-A mapping)", async () => {
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['id-final']);

    const file = createMockFile('# Body\n\ncontent', 'foo.md');
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
      options: {
        per_file_overrides: [{ filename: 'foo.md', draft_or_final: 'final' }],
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = findContentItemsInsert();
    expect(payload.publication_status).toBe('in_review');
    // Spec §9.2 — D-A guard: 'final' MUST NOT land in 'published'.
    expect(payload.publication_status).not.toBe('published');
    expect(payload).not.toHaveProperty('governance_review_status');
  });

  it("filename heuristic 'unknown' (no override, no front-matter) → publication_status='draft' (conservative)", async () => {
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['id-unknown']);

    // 'foo.md' has neither 'draft' nor 'final' substring → 'unknown'.
    const file = createMockFile('# Body\n\ncontent', 'foo.md');
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = findContentItemsInsert();
    expect(payload.publication_status).toBe('draft');
    expect(payload).not.toHaveProperty('governance_review_status');
  });

  it("front-matter 'draft: true' overrides filename heuristic 'final'", async () => {
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['id-fm-draft']);

    // Filename includes 'final' → heuristic would say 'final'. Front-matter
    // `draft: true` MUST override → 'draft' → publication_status='draft'.
    fmMocks.parseMarkdownFrontMatter.mockImplementation(() => ({
      frontMatter: { draft: true },
      body: '# Title\n',
    }));

    const file = createMockFile(
      '---\ndraft: true\n---\n# Title\n',
      'foo-final.md',
    );
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = findContentItemsInsert();
    expect(payload.publication_status).toBe('draft');
    expect(payload).not.toHaveProperty('governance_review_status');
  });

  it("front-matter 'status: final' overrides filename heuristic 'unknown' → publication_status='in_review'", async () => {
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['id-fm-final']);

    // Filename has neither 'draft' nor 'final' → heuristic 'unknown'.
    // Front-matter `status: final` MUST override → 'final' → 'in_review'.
    fmMocks.parseMarkdownFrontMatter.mockImplementation(() => ({
      frontMatter: { status: 'final' },
      body: '# Title\n',
    }));

    const file = createMockFile('---\nstatus: final\n---\n# Title\n', 'foo.md');
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = findContentItemsInsert();
    expect(payload.publication_status).toBe('in_review');
    expect(payload).not.toHaveProperty('governance_review_status');
  });

  it("front-matter 'status: published' lowercased → final → publication_status='in_review'", async () => {
    // Orchestrator branch: `status === 'published' || status === 'live'` → 'final'.
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['id-published']);

    fmMocks.parseMarkdownFrontMatter.mockImplementation(() => ({
      frontMatter: { status: 'published' },
      body: '# Title\n',
    }));

    const file = createMockFile(
      '---\nstatus: published\n---\n# Title\n',
      'foo.md',
    );
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = findContentItemsInsert();
    // Spec §9.2 — D-A guard: even 'published' status maps to 'in_review',
    // never to 'published'. Admin approval still required.
    expect(payload.publication_status).toBe('in_review');
    expect(payload.publication_status).not.toBe('published');
    expect(payload).not.toHaveProperty('governance_review_status');
  });

  it('governance_review_status field is OMITTED on every INSERT (left NULL by spec §9.2)', async () => {
    // Cover the invariant on a representative third path (filename 'final').
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['id-gov']);

    const file = createMockFile('# Body\n\ncontent', 'foo-final.md');
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = findContentItemsInsert();
    // Filename heuristic 'final' → 'in_review'.
    expect(payload.publication_status).toBe('in_review');
    // Spec §9.2 invariant: governance_review_status NEVER set on insert
    // (DB column nullable, defaults to NULL).
    expect(payload).not.toHaveProperty('governance_review_status');
  });
});
