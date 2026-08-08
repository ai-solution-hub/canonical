/**
 * Procurement tender-document upload route tests.
 *
 *   - POST /api/procurement/:id/tender — attach a tender document to a
 *     procurement
 *
 * Covers auth enforcement, UUID validation, the file-presence, empty-file and
 * MIME-type checks, the magic-byte/declared-type agreement check (415) and the
 * encrypted-docx rejection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';
import {
  createMockFile,
  createMockUploadRequest,
} from '@/__tests__/helpers/factories/file-upload';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockCheckRateLimit, mockIsEncryptedDocx } = vi.hoisted(
  () => ({
    mockCookies: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockIsEncryptedDocx: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/docx-utils', () => ({
  isEncryptedDocx: mockIsEncryptedDocx,
}));

// Import route handlers AFTER mocks
const { POST: tenderPost } =
  await import('@/app/api/procurement/[id]/tender/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INVALID_UUID = 'not-a-uuid';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire next/headers mock
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Chainable methods return the chain
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

  // Terminal methods
  mockSupabase._chain.single
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );

  // Storage mocks
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

  // Default dependency mocks
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  mockIsEncryptedDocx.mockReturnValue(false);
});

describe('POST /api/procurement/:id/tender', () => {
  const params = createTestParams({ id: VALID_UUID });

  // PDF magic bytes: %PDF
  const PDF_MAGIC = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x00, 0x00, 0x00, 0x00,
  ]);
  // ZIP/DOCX magic bytes: PK\x03\x04
  const DOCX_MAGIC = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
  ]);

  /**
   * Adapter to match the (bytes, name, mimeType) signature used by the
   * tender-upload describe block below. Delegates to the canonical
   * factory which spoofs `instanceof File` via Object.create(File.prototype)
   * — the same strategy the inline original used to satisfy the route's
   * cross-realm instanceof check.
   */
  function makeMockFile(
    bytes: Uint8Array,
    name: string,
    mimeType: string,
  ): File {
    return createMockFile({ name, content: bytes, type: mimeType });
  }

  /**
   * Adapter wrapping the canonical upload-request factory. Forwards
   * `null` as a no-file body so the route exercises its "no file"
   * validation branch.
   */
  function createTenderRequest(
    mockFile: File | null,
    procurementId: string = VALID_UUID,
  ): import('next/server').NextRequest {
    if (mockFile) {
      return createMockUploadRequest({
        path: `/api/procurement/${procurementId}/tender`,
        file: mockFile,
      });
    }

    // The "no file" path — the original helper built an empty FormData
    // whose .get always returns null. createMockUploadRequest requires a
    // File, so for this single branch fall back to the lower-level
    // request builder plus a manual empty FormData override.
    const req = createTestRequest(`/api/procurement/${procurementId}/tender`, {
      method: 'POST',
      body: {},
    });
    const formData = new FormData();
    (req as unknown as { formData: () => Promise<FormData> }).formData = vi
      .fn()
      .mockResolvedValue(formData);
    return req;
  }

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file, INVALID_UUID);

    const res = await tenderPost(req, {
      params: createTestParams({ id: INVALID_UUID }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no file is provided', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTenderRequest(null);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('No file provided');
  });

  it('returns 400 for empty file', async () => {
    configureRole(mockSupabase, 'editor');

    const emptyBytes = new Uint8Array(0);
    const file = makeMockFile(emptyBytes, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('empty');
  });

  it('returns 400 for unsupported MIME type', async () => {
    configureRole(mockSupabase, 'editor');

    const textBytes = new TextEncoder().encode('test content');
    const file = makeMockFile(
      new Uint8Array(textBytes),
      'test.txt',
      'text/plain',
    );
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Unsupported file type');
  });

  it('returns 404 when bid does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 415 when magic bytes do not match declared MIME type', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, domain_metadata: { tender_document_ids: [] } },
      error: null,
    });

    // Create a "PDF" file with wrong magic bytes (DOCX magic)
    const file = makeMockFile(DOCX_MAGIC, 'test.pdf', 'application/pdf');
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(415);

    const body = await res.json();
    expect(body.error).toContain('does not match');
  });

  it('accepts an XLSX tender document', async () => {
    configureRole(mockSupabase, 'editor');

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const xlsxType =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    // XLSX shares the ZIP container signature with DOCX
    const file = makeMockFile(DOCX_MAGIC, 'test.xlsx', xlsxType);
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mime_type).toBe(xlsxType);
    expect(body.filename).toBe('test.xlsx');
  });

  it('returns 415 for an XLSX upload whose bytes are not a ZIP container', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const xlsxType =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const file = makeMockFile(PDF_MAGIC, 'test.xlsx', xlsxType);
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(415);
  });

  it('returns 400 when docx is encrypted', async () => {
    configureRole(mockSupabase, 'editor');

    mockIsEncryptedDocx.mockReturnValue(true);

    // Procurement exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, domain_metadata: { tender_document_ids: [] } },
      error: null,
    });

    const docxType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const file = makeMockFile(DOCX_MAGIC, 'test.docx', docxType);
    const req = createTenderRequest(file);

    const res = await tenderPost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('password-protected');
  });
});
