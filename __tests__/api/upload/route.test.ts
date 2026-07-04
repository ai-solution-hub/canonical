/**
 * @vitest-environment jsdom
 *
 * S213 W4-T8b — EP3 upload-route unit-test closure (OPS-12).
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §10.5.
 * Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T8 acceptance criterion (b).
 *
 * Closes the unit-test gap on `app/api/upload/route.ts` (POST handler) called
 * out in product-backlog OPS-12. The route is the EP3 single-file upload
 * pipeline: validate → upload → extract → embed → classify → summarise.
 * (ID-56.11 retired the app-side chunk step — cocoindex re-ingests the corpus
 * natively. ID-131.15 retired the on-ingest dedup step — G-DEDUP legacy
 * dedup-family retirement, S446.) We mirror the canonical pattern from
 * `upload-route-owner.test.ts`
 * — invoke the real `POST` handler with a mocked multipart body and shared
 * mock supabase client; AI/extraction collaborators are stubbed so we land on
 * the inline `content_items` insert/update and exit cleanly.
 *
 * Coverage (7 tests):
 *   1. Happy path — admin posts a .pdf → row created + pipeline_runs completed.
 *   2. Magic-byte rejection — .pdf extension + PK header → 415.
 *   3. Oversized file — >50 MB → 413.
 *   4. Dedup retirement (ID-131.15) — always stamps dedup_status=clean, no
 *      duplicate_matches.
 *   5. skip_dedup is a no-op for admin and non-admin callers alike.
 *   6. 403 — viewer (not admin/editor) is rejected at auth gate.
 *   7. 401 — unauthenticated session → 401.
 *
 * Mocking notes:
 * - Override `request.formData()` directly (canonical pattern from
 *   __tests__/api/upload-route-owner.test.ts:159-182) — wrapping a real
 *   Request/NextRequest does not round-trip multipart bodies cleanly across
 *   realms in jsdom.
 * - File objects via `Object.create(File.prototype, …)` so the route's
 *   `file instanceof File` check passes.
 * - All AI / extraction / source-document collaborators are file-scope mocked
 *   to short-circuit the pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '@/__tests__/helpers/mock-supabase';
import {
  createMockFile,
  createMockUploadRequest,
} from '@/__tests__/helpers/factories/file-upload';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// ---------------------------------------------------------------------------
// Mock collaborators — short-circuit AI/extraction so we land on the inline
// content_items insert and exit cleanly.
// ---------------------------------------------------------------------------

vi.mock('@/lib/extraction/pdf', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    text: 'Extracted text from PDF for OPS-12 closure test.',
    pageCount: 1,
  }),
}));

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn().mockResolvedValue({ value: '<p>docx body</p>' }),
  },
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

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/date-extraction', () => ({
  extractTemporalReferences: vi.fn().mockReturnValue([]),
  findExpiryDate: vi.fn().mockReturnValue(null),
  extractDates: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: vi.fn().mockReturnValue(60),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn().mockReturnValue({
    suggestedLayer: 'reference_material',
    reason: 'Test',
    confidence: 'medium',
  }),
}));

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/guide-section-mapping', () => ({
  suggestGuideSections: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/source-documents/document-diff', () => ({
  computeDocumentDiff: vi.fn(),
}));

vi.mock('@/lib/source-documents/source-document-impact', () => ({
  analyseDocumentImpact: vi.fn(),
}));

vi.mock('@/lib/source-documents/source-document-notifications', () => ({
  sendSourceDocumentUpdateNotifications: vi.fn(),
}));

// Import route AFTER mocks are registered.
import { POST } from '@/app/api/upload/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
const PK_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const NEW_ITEM_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const CALLER_USER_ID = 'a0000000-0000-4000-8000-000000000aaa';

/**
 * Adapter to match the (bytes, name, mimeType) signature used by callers
 * below. Delegates to the canonical factory.
 */
function makeMockFile(bytes: Uint8Array, name: string, mimeType: string): File {
  return createMockFile({ name, content: bytes, type: mimeType });
}

/**
 * Adapter to match the original `buildUploadRequest({ file, skipDedup })`
 * shape. Delegates to the canonical factory.
 */
function buildUploadRequest(fields: {
  file: File;
  skipDedup?: 'true' | 'false';
}): import('next/server').NextRequest {
  return createMockUploadRequest({
    path: '/api/upload',
    file: fields.file,
    fields: { skip_dedup: fields.skipDedup },
  });
}

/**
 * Configure the chained mock so the upload route lands on the success path.
 *
 * The route consumes `single()` in this order (see app/api/upload/route.ts):
 *   (1) user_roles role lookup (queued via configureRole)
 *   (2) pipeline_runs insert.select.single → { id: 'pipeline-run-1' }
 *   (3) content_items insert.select.single → { id: NEW_ITEM_ID }
 *   (4) source_documents insert.select.single → { id: 'src-doc-1' }
 *   (5) content_items update.select.single → { id: NEW_ITEM_ID }
 *   (6+) latestItem fetches and processed-item fetches — let them default
 *        to the beforeEach `{ data: null, error: null }` (route is defensive).
 */
function configureSuccessFlow() {
  mockSupabase._chain.single
    .mockResolvedValueOnce({ data: { id: 'pipeline-run-1' }, error: null })
    .mockResolvedValueOnce({ data: { id: NEW_ITEM_ID }, error: null })
    .mockResolvedValueOnce({ data: { id: 'src-doc-1' }, error: null })
    .mockResolvedValueOnce({ data: { id: NEW_ITEM_ID }, error: null });

  // Storage bucket: success.
  const storageBucket = {
    upload: vi
      .fn()
      .mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi
      .fn()
      .mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  };
  mockSupabase.storage.from.mockReturnValue(storageBucket);
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
});

// ---------------------------------------------------------------------------
// Tests — Spec §10.5 + Plan EP2-T8 (b)
// ---------------------------------------------------------------------------

describe('POST /api/upload — OPS-12 closure', () => {
  // ─────────────────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('admin posts a .pdf → content_items row created + pipeline_runs reaches completed', async () => {
      configureRole(mockSupabase, 'admin');
      configureSuccessFlow();

      const file = makeMockFile(
        VALID_PDF_BYTES,
        'sample.pdf',
        'application/pdf',
      );
      const req = buildUploadRequest({ file });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(NEW_ITEM_ID);
      expect(body.title).toBe('Sample');
      expect(body.content_type).toBe('pdf');
      expect(body.dedup_status).toBe('clean');
      expect(body.pipeline_run_id).toBe('pipeline-run-1');

      // pipeline_runs INSERT — initial row at 'running' status.
      const inserts = mockSupabase._chain.insert.mock.calls;
      const pipelineInsert = inserts.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'pipeline_name' in (call[0] as Record<string, unknown>),
      );
      expect(pipelineInsert).toBeDefined();
      const pipelinePayload = pipelineInsert![0] as Record<string, unknown>;
      expect(pipelinePayload.pipeline_name).toBe('file_upload');
      expect(pipelinePayload.status).toBe('running');
      expect(pipelinePayload.source_filename).toBe('sample.pdf');
      expect(pipelinePayload.created_by).toBe(CALLER_USER_ID);

      // content_items INSERT carries title, content_type, ingestion_source=upload.
      const contentItemInsert = inserts.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'ingestion_source' in (call[0] as Record<string, unknown>),
      );
      expect(contentItemInsert).toBeDefined();
      const contentPayload = contentItemInsert![0] as Record<string, unknown>;
      expect(contentPayload.title).toBe('Sample');
      expect(contentPayload.content_type).toBe('pdf');
      expect(contentPayload.platform).toBe('manual');
      expect(contentPayload.ingestion_source).toBe('upload');
      expect(contentPayload.created_by).toBe(CALLER_USER_ID);
      expect(contentPayload.content_owner_id).toBe(CALLER_USER_ID);

      // pipeline_runs UPDATE → status='completed' (via updatePipelineProgress).
      const updates = mockSupabase._chain.update.mock.calls;
      const completedUpdate = updates.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>).status === 'completed',
      );
      expect(completedUpdate).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Magic-byte validation
  // ─────────────────────────────────────────────────────────────────────

  describe('magic-byte validation', () => {
    it('returns 415 when .pdf extension carries a PK (zip) magic header', async () => {
      configureRole(mockSupabase, 'admin');
      // Pipeline-run insert still happens before the magic-byte check fails,
      // but the route returns 415 with a content-type-mismatch error.
      configureSuccessFlow();

      const file = makeMockFile(PK_ZIP_BYTES, 'fake.pdf', 'application/pdf');
      const req = buildUploadRequest({ file });

      const res = await POST(req);
      expect(res.status).toBe(415);

      const body = await res.json();
      expect(body.error).toMatch(/does not match its declared type/i);

      // No content_items insert should have happened.
      const inserts = mockSupabase._chain.insert.mock.calls;
      const contentItemInsert = inserts.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'ingestion_source' in (call[0] as Record<string, unknown>),
      );
      expect(contentItemInsert).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Size limits
  // ─────────────────────────────────────────────────────────────────────

  describe('size limits', () => {
    it('returns 413 for files exceeding 50 MB', async () => {
      configureRole(mockSupabase, 'admin');

      // Construct a 51 MB file (header bytes are %PDF so MIME detection
      // would otherwise pass — the size gate must trip first at 50 MB).
      const huge = new Uint8Array(51 * 1024 * 1024);
      huge[0] = 0x25;
      huge[1] = 0x50;
      huge[2] = 0x44;
      huge[3] = 0x46;
      const file = makeMockFile(huge, 'huge.pdf', 'application/pdf');
      const req = buildUploadRequest({ file });

      const res = await POST(req);
      expect(res.status).toBe(413);

      const body = await res.json();
      expect(body.error).toMatch(/too large/i);
      expect(body.error).toMatch(/50 MB/i);

      // No pipeline_runs insert and no content_items insert should fire —
      // the size gate trips before any DB writes.
      const inserts = mockSupabase._chain.insert.mock.calls;
      expect(inserts).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Dedup retirement (ID-131.15, G-DEDUP legacy dedup-family retirement,
  // S446): the on-ingest exact-hash/near-duplicate soft-block stamping
  // (checkForDuplicates/formatDedupWarning/resolveDedupStamp, backed by
  // the now-DROPped find_exact_duplicates + find_similar_content RPCs) was
  // removed. Uploads are always stamped 'clean' with no duplicate matches,
  // and `skip_dedup` is a no-op for admin and non-admin callers alike.
  // ─────────────────────────────────────────────────────────────────────

  describe('dedup retirement (ID-131.15) — always-clean stamping', () => {
    it('stamps dedup_status=clean and omits duplicate_matches — no on-ingest check runs', async () => {
      configureRole(mockSupabase, 'editor');
      configureSuccessFlow();

      const md = '# Sample\n\nbody text long enough to clear hash threshold';
      const file = makeMockFile(
        new TextEncoder().encode(md),
        'sample.md',
        'text/markdown',
      );
      const req = buildUploadRequest({ file });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.dedup_status).toBe('clean');
      expect(body.suspected_duplicate_of).toBeUndefined();
      expect(body.duplicate_matches).toEqual([]);

      // content_items UPDATE writes dedup_status='clean', no
      // metadata.suspected_duplicate_of.
      const updates = mockSupabase._chain.update.mock.calls;
      const dedupStampUpdate = updates.find(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          'dedup_status' in (call[0] as Record<string, unknown>),
      );
      expect(dedupStampUpdate).toBeDefined();
      const updatePayload = dedupStampUpdate![0] as Record<string, unknown>;
      expect(updatePayload.dedup_status).toBe('clean');
      const meta = updatePayload.metadata as Record<string, unknown>;
      expect(meta).not.toHaveProperty('suspected_duplicate_of');
    });

    it('skip_dedup=true is a no-op — upload still stamps clean (admin or non-admin)', async () => {
      configureRole(mockSupabase, 'admin');
      configureSuccessFlow();

      const md = '# Sample\n\nbody text long enough to clear hash threshold';
      const file = makeMockFile(
        new TextEncoder().encode(md),
        'sample.md',
        'text/markdown',
      );
      const req = buildUploadRequest({ file, skipDedup: 'true' });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.dedup_status).toBe('clean');
      expect(body.suspected_duplicate_of).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Auth gates
  // ─────────────────────────────────────────────────────────────────────

  describe('auth gates', () => {
    it('returns 403 for non-admin/non-editor (e.g. viewer)', async () => {
      configureRole(mockSupabase, 'viewer');

      const file = makeMockFile(
        VALID_PDF_BYTES,
        'sample.pdf',
        'application/pdf',
      );
      const req = buildUploadRequest({ file });

      const res = await POST(req);
      expect(res.status).toBe(403);

      // No pipeline_runs / content_items inserts should fire.
      const inserts = mockSupabase._chain.insert.mock.calls;
      expect(inserts).toEqual([]);
    });

    it('returns 401 when getAuthorisedClient returns unauthenticated', async () => {
      // Override default auth.getUser to simulate "no session".
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: {
          name: 'AuthSessionMissingError',
          message: 'Auth session missing!',
        },
      });

      const file = makeMockFile(
        VALID_PDF_BYTES,
        'sample.pdf',
        'application/pdf',
      );
      const req = buildUploadRequest({ file });

      const res = await POST(req);
      expect(res.status).toBe(401);

      // No DB writes whatsoever.
      const inserts = mockSupabase._chain.insert.mock.calls;
      expect(inserts).toEqual([]);
    });
  });
});
