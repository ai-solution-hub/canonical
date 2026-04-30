/**
 * @vitest-environment jsdom
 *
 * EP2 §1.11 markdown-batch UI ingest — admin-override (skip_dedup) +
 * per-file `excluded` mock-API tests.
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §10.3.
 * Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T7 acceptance criterion (c).
 *
 * End-to-end: invokes the real `POST` handler from
 * `app/api/ingest/markdown/route.ts` with a mocked multipart body and
 * shared mock supabase. AI/extraction collaborators are stubbed so we
 * land on the orchestrator's `content_items` INSERT and assert the wire
 * payload (publication_status, dedup_status, metadata.suspected_duplicate_of).
 *
 * Mocking notes:
 * - Override `request.formData()` directly (canonical pattern from
 *   __tests__/api/upload-route-owner.test.ts:159-182).
 * - File objects via `Object.create(File.prototype, …)` so the route's
 *   duck-type filter (route.ts:126-135) accepts them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

const dedupMocks = vi.hoisted(() => ({
  checkExactDuplicate: vi.fn(),
  resolveDedupStamp: vi.fn(),
  normaliseTextForHash: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// ---------------------------------------------------------------------------
// Mock collaborators — short-circuit AI/extraction so we land on the
// orchestrator's content_items insert and exit cleanly.
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  MAX_EMBEDDING_CHARS: 8192,
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/dedup', () => ({
  checkExactDuplicate: dedupMocks.checkExactDuplicate,
  resolveDedupStamp: dedupMocks.resolveDedupStamp,
  normaliseTextForHash: dedupMocks.normaliseTextForHash,
}));

vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: vi.fn().mockResolvedValue({ stored: 1, errors: [] }),
}));

vi.mock('@/lib/extraction/markdown-front-matter', () => ({
  parseMarkdownFrontMatter: vi.fn().mockImplementation((content: string) => ({
    frontMatter: null,
    body: content,
  })),
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

// Import route AFTER mocks are registered.
import { POST } from '@/app/api/ingest/markdown/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CALLER_USER_ID = 'a0000000-0000-4000-8000-000000000aaa';
const SEED_DUPLICATE_ID = 'b0000000-0000-4000-8000-000000000bbb';

/**
 * Create a mock File compatible with the route's duck-type filter.
 * Mirrors the pattern at __tests__/api/upload-route-owner.test.ts:137-152.
 */
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

/**
 * Build a NextRequest with formData() pre-mocked. Files come through
 * `formData.getAll('files[]')` and `phase` / `options` via `formData.get(...)`.
 */
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

/**
 * Set up the chained-mock supabase for a successful import phase.
 *
 * The orchestrator's `importOneFile()` calls
 *   .from('content_items').insert(payload).select('id, title').single()
 * once per file. We queue one .single() resolution per content_items insert
 * we expect.
 *
 * `startPipelineRun` is mocked separately above so the pipeline_runs INSERT
 * never hits this chain.
 */
function configureImportSuccess(perFileIds: string[]) {
  // configureRole consumed the first .single() resolution. The next
  // resolutions are the per-file content_items inserts.
  for (const id of perFileIds) {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id, title: `Item ${id}` },
      error: null,
    });
  }
  // source_file lookup uses .maybeSingle() — keep null fallback.
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

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

  // Default dedup behaviour reset per test.
  dedupMocks.normaliseTextForHash.mockImplementation((s: string) =>
    s.toLowerCase(),
  );
});

// ---------------------------------------------------------------------------
// Tests — Spec §10.3 + Plan EP2-T7 (c)
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — admin-override (skip_dedup) + per-file excluded', () => {
  it('admin + skip_dedup=true + duplicate exists → INSERT payload has dedup_status=clean (no suspected_duplicate_of)', async () => {
    configureRole(mockSupabase, 'admin');
    configureImportSuccess(['new-id-1']);

    // Duplicate detected upstream — but admin skip_dedup shrugs it off.
    dedupMocks.checkExactDuplicate.mockResolvedValue({
      isDuplicate: true,
      existingId: SEED_DUPLICATE_ID,
      existingTitle: 'Existing Title',
    });
    dedupMocks.resolveDedupStamp.mockImplementation(
      (existingId: string | undefined, opts: { skipDedup?: boolean } = {}) => {
        // Real-impl parity: skipDedup=true short-circuits to clean.
        if (opts.skipDedup) return { dedup_status: 'clean' };
        return existingId
          ? {
              dedup_status: 'suspected_duplicate',
              suspected_duplicate_of: existingId,
            }
          : { dedup_status: 'clean' };
      },
    );

    const file = createMockFile(
      '# Foo\n\nbody text long enough to clear normalised threshold',
      'foo.md',
    );
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
      options: {
        per_file_overrides: [{ filename: 'foo.md', skip_dedup: true }],
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.results_summary.stored).toHaveLength(1);
    expect(body.results_summary.dedup_flagged).toEqual([]);

    // Verify resolveDedupStamp was called with skipDedup=true (admin path).
    const stampCalls = dedupMocks.resolveDedupStamp.mock.calls;
    expect(stampCalls.length).toBeGreaterThan(0);
    const lastStamp = stampCalls[stampCalls.length - 1];
    expect(lastStamp[1]).toEqual({ skipDedup: true });

    const inserts = mockSupabase._chain.insert.mock.calls;
    const contentItemInsert = inserts.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'publication_status' in (call[0] as Record<string, unknown>),
    );
    expect(contentItemInsert).toBeDefined();
    const payload = contentItemInsert![0] as Record<string, unknown>;
    expect(payload.dedup_status).toBe('clean');
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('suspected_duplicate_of');
  });

  it('editor + skip_dedup=true + duplicate exists → silently ignored, INSERT stamps suspected_duplicate', async () => {
    configureRole(mockSupabase, 'editor');
    configureImportSuccess(['new-id-2']);

    dedupMocks.checkExactDuplicate.mockResolvedValue({
      isDuplicate: true,
      existingId: SEED_DUPLICATE_ID,
      existingTitle: 'Existing Title',
    });
    dedupMocks.resolveDedupStamp.mockImplementation(
      (existingId: string | undefined, opts: { skipDedup?: boolean } = {}) => {
        if (opts.skipDedup) return { dedup_status: 'clean' };
        return existingId
          ? {
              dedup_status: 'suspected_duplicate',
              suspected_duplicate_of: existingId,
            }
          : { dedup_status: 'clean' };
      },
    );

    const file = createMockFile(
      '# Foo\n\nbody text long enough to clear normalised threshold',
      'foo.md',
    );
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
      options: {
        per_file_overrides: [{ filename: 'foo.md', skip_dedup: true }],
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Silent-ignore — request still succeeds, just stamps dedup.
    expect(body.results_summary.stored).toHaveLength(1);
    expect(body.results_summary.dedup_flagged).toEqual([
      expect.objectContaining({
        filename: 'foo.md',
        suspected_duplicate_of: SEED_DUPLICATE_ID,
      }),
    ]);

    // resolveDedupStamp must have been called with skipDedup=false for the
    // editor path (orchestrator strips the admin-only override silently).
    const stampCalls = dedupMocks.resolveDedupStamp.mock.calls;
    const lastStamp = stampCalls[stampCalls.length - 1];
    expect(lastStamp[1]).toEqual({ skipDedup: false });

    const inserts = mockSupabase._chain.insert.mock.calls;
    const contentItemInsert = inserts.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'publication_status' in (call[0] as Record<string, unknown>),
    );
    expect(contentItemInsert).toBeDefined();
    const payload = contentItemInsert![0] as Record<string, unknown>;
    expect(payload.dedup_status).toBe('suspected_duplicate');
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata.suspected_duplicate_of).toBe(SEED_DUPLICATE_ID);
  });

  it('admin + per-file excluded=true → file is NOT inserted, listed in skipped_excluded', async () => {
    configureRole(mockSupabase, 'admin');
    // No content_items inserts expected — only the never-fired single() default.

    dedupMocks.checkExactDuplicate.mockResolvedValue({ isDuplicate: false });
    dedupMocks.resolveDedupStamp.mockReturnValue({ dedup_status: 'clean' });

    const file = createMockFile(
      '# Foo\n\nbody text long enough to clear normalised threshold',
      'foo.md',
    );
    const req = buildBatchRequest({
      phase: 'import',
      files: [file],
      options: {
        per_file_overrides: [{ filename: 'foo.md', excluded: true }],
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.results_summary.stored).toEqual([]);
    expect(body.results_summary.skipped_excluded).toEqual(['foo.md']);

    // Critically: NO `.insert()` call carrying a content_items payload
    // (i.e. no payload with `publication_status` / `ingest_source`).
    const inserts = mockSupabase._chain.insert.mock.calls;
    const contentItemInsert = inserts.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'publication_status' in (call[0] as Record<string, unknown>),
    );
    expect(contentItemInsert).toBeUndefined();
  });
});
