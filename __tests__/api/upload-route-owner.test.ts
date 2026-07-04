/**
 * Upload route — content_owner_id at the actual `.insert()` call (S206 WP-A
 * Phase 2 verifier finding M-1).
 *
 * This test invokes the real `POST` handler from `app/api/upload/route.ts`
 * with a mocked multipart body. It asserts that the row written to
 * `content_items` carries the resolved `content_owner_id` consistent with the
 * caller's role and the optional `content_owner_id` form field.
 *
 * It also covers the M-2 finding: malformed `content_owner_id` UUID values
 * must produce a 400 response from the route.
 *
 * Mocking notes:
 * - We override `request.formData()` directly per the canonical pattern in
 *   `bid-drafting.test.ts` — wrapping a real Request/NextRequest doesn't
 *   round-trip multipart bodies cleanly across realms in jsdom.
 * - File objects are created via `Object.create(File.prototype, …)` so
 *   `file instanceof File` passes inside the route handler.
 * - All AI/extraction collaborators are mocked to short-circuit the pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import {
  createMockFile,
  createMockUploadRequest,
} from '../helpers/factories/file-upload';

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
    text: 'Extracted text from PDF for upload-route-owner test.',
    pageCount: 1,
  }),
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

// Import route AFTER mocks are registered
import { POST } from '@/app/api/upload/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
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
 * Adapter to match the original `buildUploadRequest({ file, contentOwnerId })`
 * shape. Delegates to the canonical factory which uses a generic `fields`
 * record so callers may pass any form field by name.
 */
function buildUploadRequest(fields: {
  file: File;
  contentOwnerId?: string;
}): import('next/server').NextRequest {
  return createMockUploadRequest({
    path: '/api/upload',
    file: fields.file,
    fields: { content_owner_id: fields.contentOwnerId },
  });
}

/**
 * Configure the chained mock so the upload route lands on the success path.
 *
 * The route consumes `single()` in this order (see app/api/upload/route.ts):
 *   (1) pipeline_runs insert.select.single → { id: 'pipeline-run-1' }
 *   (2) content_items insert.select.single → { id: NEW_ITEM_ID }
 *   (3) source_documents insert.select.single → { id: 'src-doc-1' }
 *   (4) content_items update.select.single → { id: NEW_ITEM_ID }
 *   (5+) latestItem fetches and processed item fetch — we let them default
 *        to the beforeEach `{ data: null, error: null }` (route is defensive).
 */
function configureSuccessFlow() {
  mockSupabase._chain.single
    .mockResolvedValueOnce({ data: { id: 'pipeline-run-1' }, error: null })
    .mockResolvedValueOnce({ data: { id: NEW_ITEM_ID }, error: null })
    .mockResolvedValueOnce({ data: { id: 'src-doc-1' }, error: null })
    .mockResolvedValueOnce({ data: { id: NEW_ITEM_ID }, error: null });

  // Storage bucket: success
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
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/upload — content_owner_id resolution at insert', () => {
  it('defaults content_owner_id to caller userId when form field is absent (editor)', async () => {
    configureRole(mockSupabase, 'editor');
    configureSuccessFlow();

    const file = makeMockFile(VALID_PDF_BYTES, 'sample.pdf', 'application/pdf');
    const req = buildUploadRequest({ file });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // The first content_items insert is the row creation (page 1 of the
    // route at line ~320). Find by `content_owner_id` key.
    const inserts = mockSupabase._chain.insert.mock.calls;
    const contentItemInsert = inserts.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'content_owner_id' in (call[0] as Record<string, unknown>),
    );
    expect(contentItemInsert).toBeDefined();
    if (contentItemInsert) {
      const payload = contentItemInsert[0] as Record<string, unknown>;
      expect(payload.content_owner_id).toBe(CALLER_USER_ID);
      expect(payload.created_by).toBe(CALLER_USER_ID);
    }
  });

  it('admin override: explicit content_owner_id is respected when caller is admin', async () => {
    configureRole(mockSupabase, 'admin');
    configureSuccessFlow();

    const OTHER_UUID = '11111111-2222-4333-8444-555555555555';
    const file = makeMockFile(VALID_PDF_BYTES, 'sample.pdf', 'application/pdf');
    const req = buildUploadRequest({ file, contentOwnerId: OTHER_UUID });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const inserts = mockSupabase._chain.insert.mock.calls;
    const contentItemInsert = inserts.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'content_owner_id' in (call[0] as Record<string, unknown>),
    );
    expect(contentItemInsert).toBeDefined();
    if (contentItemInsert) {
      const payload = contentItemInsert[0] as Record<string, unknown>;
      expect(payload.content_owner_id).toBe(OTHER_UUID);
      // created_by always tracks the caller, not the override target
      expect(payload.created_by).toBe(CALLER_USER_ID);
    }
  });

  it('non-admin override is silent-forced: explicit content_owner_id ignored for editor', async () => {
    configureRole(mockSupabase, 'editor');
    configureSuccessFlow();

    const OTHER_UUID = '11111111-2222-4333-8444-555555555555';
    const file = makeMockFile(VALID_PDF_BYTES, 'sample.pdf', 'application/pdf');
    const req = buildUploadRequest({ file, contentOwnerId: OTHER_UUID });

    const res = await POST(req);
    // Silent-force = legitimate write, not 403
    expect(res.status).toBe(200);

    const inserts = mockSupabase._chain.insert.mock.calls;
    const contentItemInsert = inserts.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'content_owner_id' in (call[0] as Record<string, unknown>),
    );
    expect(contentItemInsert).toBeDefined();
    if (contentItemInsert) {
      const payload = contentItemInsert[0] as Record<string, unknown>;
      expect(payload.content_owner_id).toBe(CALLER_USER_ID);
      expect(payload.created_by).toBe(CALLER_USER_ID);
    }
  });

  // Typed ingestion_source column. Read by
  // ensure_v1_history_at_commit() trigger to set
  // content_history.change_reason='initial_ingest'.
  it('writes ingestion_source="upload" to the content_items insert payload', async () => {
    configureRole(mockSupabase, 'editor');
    configureSuccessFlow();

    const file = makeMockFile(VALID_PDF_BYTES, 'sample.pdf', 'application/pdf');
    const req = buildUploadRequest({ file });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const inserts = mockSupabase._chain.insert.mock.calls;
    const contentItemInsert = inserts.find(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'ingestion_source' in (call[0] as Record<string, unknown>),
    );
    expect(contentItemInsert).toBeDefined();
    if (contentItemInsert) {
      const payload = contentItemInsert[0] as Record<string, unknown>;
      expect(payload.ingestion_source).toBe('upload');
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // M-2 — Zod UUID validation on the formData field
  // ─────────────────────────────────────────────────────────────────────

  it('returns 400 when content_owner_id is malformed (not a UUID)', async () => {
    configureRole(mockSupabase, 'admin');
    configureSuccessFlow();

    const file = makeMockFile(VALID_PDF_BYTES, 'sample.pdf', 'application/pdf');
    const req = buildUploadRequest({ file, contentOwnerId: 'not-a-uuid' });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    // parseBody returns field-level detail in body.details
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'content_owner_id' }),
      ]),
    );
  });
});
