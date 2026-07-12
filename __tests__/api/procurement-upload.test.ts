import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';
import {
  createMockFile,
  createMockUploadRequest,
} from '../helpers/factories/file-upload';

// ID-145 {145.9} — DR-014 manual-upload creation (BI-9/16). "Upload a form
// -> it becomes the procurement item" — POST /api/procurement/upload mints
// one form_instances row whose file identity IS the uploaded document, then
// enqueues an analyse_form job. Reuses the [id]/tender/route.ts hardening
// pattern (magic-byte sniff, 50 MB cap, rate limit) but creates the item
// itself rather than attaching to an existing one.

const mockSupabase = createMockSupabaseClient();

const { mockCheckRateLimit, mockIsEncryptedDocx, mockEnqueueQueueJob } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockIsEncryptedDocx: vi.fn(),
    mockEnqueueQueueJob: vi.fn(),
  }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/docx-utils', () => ({
  isEncryptedDocx: mockIsEncryptedDocx,
}));

vi.mock('@/lib/queue/enqueue', () => ({
  enqueueQueueJob: mockEnqueueQueueJob,
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST as uploadPost } from '@/app/api/procurement/upload/route';

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEGACY_DOC_MIME = 'application/msword';
const LEGACY_XLS_MIME = 'application/vnd.ms-excel';

// PDF magic bytes: %PDF
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]);
// ZIP/OOXML magic bytes: PK\x03\x04 (docx/xlsx)
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
// OLE2/MS-CFB magic bytes: legacy .doc/.xls
const OLE2_MAGIC = new Uint8Array([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

function makeMockFile(bytes: Uint8Array, name: string, type: string): File {
  return createMockFile({ name, content: bytes, type });
}

function createUploadRequest(
  file: File | null,
  fields?: Record<string, string | undefined>,
): import('next/server').NextRequest {
  if (file) {
    return createMockUploadRequest({
      path: '/api/procurement/upload',
      file,
      fields,
    });
  }
  const req = createTestRequest('/api/procurement/upload', {
    method: 'POST',
    body: {},
  });
  const formData = new FormData();
  (req as unknown as { formData: () => Promise<FormData> }).formData = vi
    .fn()
    .mockResolvedValue(formData);
  return req;
}

const CREATED_FORM_ROW = {
  id: '00000000-0000-4000-8000-000000000099',
  name: 'standard-sq',
  filename: 'standard-sq.pdf',
  storage_path: '00000000-0000-4000-8000-000000000099/standard-sq.pdf',
  file_size: 8,
  mime_type: PDF_MIME,
  ingest_source: 'app_upload',
  processing_status: 'uploaded',
  form_type: null,
  created_by: 'test-user-id',
  created_at: '2026-07-12T00:00:00.000Z',
  updated_at: '2026-07-12T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  for (const m of [
    'select',
    'insert',
    'update',
    'eq',
    'order',
    'contains',
  ] as const) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase.storage.from.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
  });

  mockCheckRateLimit.mockReturnValue({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
  });
  mockIsEncryptedDocx.mockReturnValue(false);
  mockEnqueueQueueJob.mockResolvedValue({
    jobId: 'job-1',
    deduplicated: false,
  });
});

describe('POST /api/procurement/upload', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const file = makeMockFile(PDF_MAGIC, 'test.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role (a viewer cannot upload)', async () => {
    configureRole(mockSupabase, 'viewer');
    const file = makeMockFile(PDF_MAGIC, 'test.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(403);
  });

  it('returns 400 when no file is provided', async () => {
    configureRole(mockSupabase, 'editor');
    const res = await uploadPost(createUploadRequest(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No file provided');
  });

  it('returns 400 for an empty file', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(new Uint8Array(0), 'test.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('empty');
  });

  it('returns 413 when the file exceeds the 50 MB cap', async () => {
    configureRole(mockSupabase, 'editor');
    const file = createMockFile({
      name: 'huge.pdf',
      type: PDF_MIME,
      content: PDF_MAGIC,
      size: 52_428_801,
    });
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain('50 MB');
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });
    const file = makeMockFile(PDF_MAGIC, 'test.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(429);
  });

  it('returns 400 for an unsupported MIME type', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(
      new Uint8Array(new TextEncoder().encode('hello')),
      'test.txt',
      'text/plain',
    );
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unsupported file type');
  });

  it('returns 415 when magic bytes do not match the declared MIME type', async () => {
    configureRole(mockSupabase, 'editor');
    // Declares PDF but the bytes are a ZIP/OOXML container.
    const file = makeMockFile(ZIP_MAGIC, 'test.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain('does not match');
  });

  it('returns 400 when a genuine docx upload is password-protected', async () => {
    configureRole(mockSupabase, 'editor');
    mockIsEncryptedDocx.mockReturnValue(true);
    const file = makeMockFile(ZIP_MAGIC, 'test.docx', DOCX_MIME);
    const res = await uploadPost(createUploadRequest(file));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('password-protected');
  });

  it('does not run encrypted-package detection against a genuine legacy .doc upload', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...CREATED_FORM_ROW, mime_type: DOCX_MIME },
      error: null,
    });
    const file = makeMockFile(OLE2_MAGIC, 'legacy.doc', LEGACY_DOC_MIME);
    const res = await uploadPost(createUploadRequest(file));
    // A genuine .doc is natively OLE2 — isEncryptedDocx must not be invoked
    // (it would false-positive "always encrypted" on the OLE2 envelope).
    expect(mockIsEncryptedDocx).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  it('creates one form_instances row whose file identity is the uploaded doc, and enqueues an analyse_form job (201)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: CREATED_FORM_ROW,
      error: null,
    });

    const file = makeMockFile(PDF_MAGIC, 'standard-sq.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(CREATED_FORM_ROW.id);
    expect(body.filename).toBe('standard-sq.pdf');
    expect(body.mime_type).toBe(PDF_MIME);
    expect(body.ingest_source).toBe('app_upload');
    expect(body.analyse_form_job_id).toBe('job-1');

    // form_instances insert carries the uploaded document's file identity.
    expect(mockSupabase.from).toHaveBeenCalledWith('form_instances');
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.filename).toBe('standard-sq.pdf');
    expect(insertArg.mime_type).toBe(PDF_MIME);
    expect(insertArg.ingest_source).toBe('app_upload');
    expect(insertArg.processing_status).toBe('uploaded');

    // analyse_form job enqueued for this form.
    expect(mockEnqueueQueueJob).toHaveBeenCalledTimes(1);
    const enqueueArg = mockEnqueueQueueJob.mock.calls[0][0];
    expect(enqueueArg.jobType).toBe('analyse_form');
    expect(enqueueArg.body).toEqual({ form_id: CREATED_FORM_ROW.id });
  });

  it('maps a legacy .doc upload to the target docx mime_type (DR-059)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...CREATED_FORM_ROW, mime_type: DOCX_MIME },
      error: null,
    });

    const file = makeMockFile(OLE2_MAGIC, 'legacy.doc', LEGACY_DOC_MIME);
    const res = await uploadPost(createUploadRequest(file));

    expect(res.status).toBe(201);
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    // Pre-insert conversion target per {145.6}'s mime_type CHECK — the DB
    // row always claims one of {docx,xlsx,pdf}, never the legacy mime.
    expect(insertArg.mime_type).toBe(DOCX_MIME);
  });

  it('maps a legacy .xls upload to the target xlsx mime_type (DR-059)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...CREATED_FORM_ROW, mime_type: XLSX_MIME },
      error: null,
    });

    const file = makeMockFile(OLE2_MAGIC, 'legacy.xls', LEGACY_XLS_MIME);
    const res = await uploadPost(createUploadRequest(file));

    expect(res.status).toBe(201);
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.mime_type).toBe(XLSX_MIME);
  });

  it('cleans up the uploaded storage object when the form_instances insert fails', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'insert failed', code: 'XXXXX' },
    });

    const file = makeMockFile(PDF_MAGIC, 'test.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));

    expect(res.status).toBe(500);
    const bucket = mockSupabase.storage.from.mock.results.find(
      (r) => r.value?.remove,
    )?.value;
    expect(bucket.remove).toHaveBeenCalled();
    expect(mockEnqueueQueueJob).not.toHaveBeenCalled();
  });

  it('still returns 201 (the item was created) when the analyse_form enqueue fails, surfacing the gap explicitly', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: CREATED_FORM_ROW,
      error: null,
    });
    mockEnqueueQueueJob.mockRejectedValueOnce(new Error('queue unavailable'));

    const file = makeMockFile(PDF_MAGIC, 'standard-sq.pdf', PDF_MIME);
    const res = await uploadPost(createUploadRequest(file));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(CREATED_FORM_ROW.id);
    expect(body.analyse_form_job_id).toBeNull();
    // safeErrorMessage() only interpolates the underlying error message in
    // NODE_ENV=development — in test/CI it returns the generic fallback.
    expect(body.analyse_form_enqueue_error).toBe(
      'Failed to queue form analysis',
    );
  });

  it('derives the form name from the filename when no name override is given', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: CREATED_FORM_ROW,
      error: null,
    });

    const file = makeMockFile(
      PDF_MAGIC,
      'Standard Selection Questionnaire.pdf',
      PDF_MIME,
    );
    const res = await uploadPost(createUploadRequest(file));

    expect(res.status).toBe(201);
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.name).toBe('Standard Selection Questionnaire');
  });

  it('honours an explicit name override field over the derived filename', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: CREATED_FORM_ROW,
      error: null,
    });

    const file = makeMockFile(PDF_MAGIC, 'raw-scan-034.pdf', PDF_MIME);
    const res = await uploadPost(
      createUploadRequest(file, { name: 'Croydon SQ 2026' }),
    );

    expect(res.status).toBe(201);
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.name).toBe('Croydon SQ 2026');
  });
});
