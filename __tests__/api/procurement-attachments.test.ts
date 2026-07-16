import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';
import {
  createMockFile,
  createMockUploadRequest,
} from '../helpers/factories/file-upload';

// ID-147 {147.8} — POST/DELETE /api/procurement/[id]/attachments. POST binds
// the Extend upload shell's onFilesAccepted to the EXISTING hardened BI-9
// backend characteristics (magic-byte sniff, 50 MB cap, rate-limit) and
// writes a `form_attachments` row (form-scoped or engagement-scoped, §A6).
// DELETE best-effort-removes the storage object (TECH §2 cleanup owner).

const mockSupabase = createMockSupabaseClient();

const { mockCheckRateLimit, mockIsEncryptedDocx } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockIsEncryptedDocx: vi.fn(),
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

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST, DELETE } from '@/app/api/procurement/[id]/attachments/route';

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]);
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

const FORM_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const OTHER_FORM_ID = 'b2c3d4e5-f6a7-4901-bcde-f12345678901';
const ENGAGEMENT_ID = 'c3d4e5f6-a7b8-4012-cdef-123456789012';
const ATTACHMENT_ID = 'd4e5f6a7-b8c9-4123-def0-234567890123';

function makeMockFile(bytes: Uint8Array, name: string, type: string): File {
  return createMockFile({ name, content: bytes, type });
}

function postRequest(
  file: File | null,
  fields?: Record<string, string | undefined>,
) {
  return createMockUploadRequest({
    path: `/api/procurement/${FORM_ID}/attachments`,
    file: file ?? undefined,
    fields,
  });
}

function deleteRequest(searchParams?: Record<string, string>) {
  return createTestRequest(`/api/procurement/${FORM_ID}/attachments`, {
    method: 'DELETE',
    searchParams,
  });
}

const CREATED_ATTACHMENT_ROW = {
  id: ATTACHMENT_ID,
  form_instance_id: FORM_ID,
  engagement_group_id: null,
  role: 'form_source',
  filename: 'cv.pdf',
  storage_path: `${FORM_ID}/attachments/${ATTACHMENT_ID}-cv.pdf`,
  mime_type: PDF_MIME,
  file_size: 8,
  created_by: 'test-user-id',
  created_at: '2026-07-16T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  for (const m of ['select', 'insert', 'delete', 'eq'] as const) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }
  // Default awaited-chain resolution (e.g. `.delete().eq(...)` success).
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null }),
  );

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
});

describe('POST /api/procurement/[id]/attachments', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role (a viewer cannot attach)', async () => {
    configureRole(mockSupabase, 'viewer');
    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });
    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(429);
  });

  it('returns 400 when no file is provided', async () => {
    configureRole(mockSupabase, 'editor');
    const res = await POST(postRequest(null, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No file provided');
  });

  it('returns 400 for an invalid role', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'bogus' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Invalid role');
  });

  it('returns 400 when a form_source attachment carries an engagement_group_id (scope/role CHECK)', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(
      postRequest(file, {
        role: 'form_source',
        engagement_group_id: ENGAGEMENT_ID,
      }),
      { params: createTestParams({ id: FORM_ID }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('form-scoped');
  });

  it('returns 400 for a malformed engagement_group_id', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(
      postRequest(file, {
        role: 'reference_evidence',
        engagement_group_id: 'not-a-uuid',
      }),
      { params: createTestParams({ id: FORM_ID }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('engagement_group_id');
  });

  it('rejects a hostile filename containing path-traversal segments (400, no storage write)', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(PDF_MAGIC, '../../etc/x.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Invalid filename');
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
  });

  it('returns 413 when the file exceeds the 50 MB cap', async () => {
    configureRole(mockSupabase, 'editor');
    const file = createMockFile({
      name: 'huge.pdf',
      type: PDF_MIME,
      content: PDF_MAGIC,
      size: 52_428_801,
    });
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(413);
  });

  it('returns 400 for an empty file', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(new Uint8Array(0), 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('empty');
  });

  it('returns 400 for an unsupported MIME type', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(
      new Uint8Array(new TextEncoder().encode('hello')),
      'cv.txt',
      'text/plain',
    );
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Unsupported file type');
  });

  it('returns 415 when magic bytes do not match the declared MIME type', async () => {
    configureRole(mockSupabase, 'editor');
    const file = makeMockFile(ZIP_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(415);
    expect((await res.json()).error).toContain('does not match');
  });

  it('returns 400 when a genuine docx upload is password-protected', async () => {
    configureRole(mockSupabase, 'editor');
    mockIsEncryptedDocx.mockReturnValue(true);
    const file = makeMockFile(ZIP_MAGIC, 'cv.docx', DOCX_MIME);
    const res = await POST(postRequest(file, { role: 'reference_evidence' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('password-protected');
  });

  it('returns 404 when the form does not exist', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });
    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('creates a form-scoped attachment (201), uploading to <form_id>/attachments/<uuid>-<filename>', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single
      .mockResolvedValueOnce({ data: { id: FORM_ID }, error: null }) // form lookup
      .mockResolvedValueOnce({ data: CREATED_ATTACHMENT_ROW, error: null }); // insert

    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(postRequest(file, { role: 'form_source' }), {
      params: createTestParams({ id: FORM_ID }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(CREATED_ATTACHMENT_ROW.id);
    expect(body.form_instance_id).toBe(FORM_ID);
    expect(body.role).toBe('form_source');

    const bucket = mockSupabase.storage.from('tender-documents');
    const uploadedPath = bucket.upload.mock.calls[0][0];
    expect(uploadedPath).toMatch(
      new RegExp(`^${FORM_ID}/attachments/[0-9a-f-]{36}-cv\\.pdf$`),
    );

    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.form_instance_id).toBe(FORM_ID);
    expect(insertArg.engagement_group_id).toBeNull();
    expect(insertArg.role).toBe('form_source');
    expect(insertArg.storage_path).toBe(uploadedPath);
  });

  it('creates an engagement-scoped attachment (201), uploading to engagement/<id>/<uuid>-<filename>', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single
      .mockResolvedValueOnce({ data: { id: FORM_ID }, error: null }) // form lookup
      .mockResolvedValueOnce({
        data: {
          ...CREATED_ATTACHMENT_ROW,
          form_instance_id: null,
          engagement_group_id: ENGAGEMENT_ID,
          role: 'reference_evidence',
        },
        error: null,
      }); // insert

    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(
      postRequest(file, {
        role: 'reference_evidence',
        engagement_group_id: ENGAGEMENT_ID,
      }),
      { params: createTestParams({ id: FORM_ID }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.engagement_group_id).toBe(ENGAGEMENT_ID);
    expect(body.form_instance_id).toBeNull();

    const bucket = mockSupabase.storage.from('tender-documents');
    const uploadedPath = bucket.upload.mock.calls[0][0];
    expect(uploadedPath).toMatch(
      new RegExp(`^engagement/${ENGAGEMENT_ID}/[0-9a-f-]{36}-cv\\.pdf$`),
    );

    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.form_instance_id).toBeNull();
    expect(insertArg.engagement_group_id).toBe(ENGAGEMENT_ID);
  });

  it('compensates by removing the storage object when the row insert fails (invalid engagement -> 400)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single
      .mockResolvedValueOnce({ data: { id: FORM_ID }, error: null }) // form lookup
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23503', message: 'foreign key violation' },
      }); // insert fails (FK violation)

    const file = makeMockFile(PDF_MAGIC, 'cv.pdf', PDF_MIME);
    const res = await POST(
      postRequest(file, {
        role: 'reference_evidence',
        engagement_group_id: ENGAGEMENT_ID,
      }),
      { params: createTestParams({ id: FORM_ID }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Engagement not found');

    const bucket = mockSupabase.storage.from('tender-documents');
    expect(bucket.remove).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/procurement/[id]/attachments', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when attachmentId is missing', async () => {
    configureRole(mockSupabase, 'editor');
    const res = await DELETE(deleteRequest(), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('attachmentId');
  });

  it('returns 404 when the attachment does not exist', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the attachment belongs to a different form (no cross-form delete)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: ATTACHMENT_ID,
        storage_path: `${OTHER_FORM_ID}/attachments/x-cv.pdf`,
        form_instance_id: OTHER_FORM_ID,
        engagement_group_id: null,
      },
      error: null,
    });
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(404);
    expect(mockSupabase._chain.delete).not.toHaveBeenCalled();
  });

  it("returns 404 when an engagement-scoped attachment does not match this form's engagement", async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: {
          id: ATTACHMENT_ID,
          storage_path: `engagement/${ENGAGEMENT_ID}/x-cv.pdf`,
          form_instance_id: null,
          engagement_group_id: ENGAGEMENT_ID,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { engagement_group_id: 'a-different-engagement-id' },
        error: null,
      });
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('deletes a form-scoped attachment (204) and best-effort-removes the storage object', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: ATTACHMENT_ID,
        storage_path: `${FORM_ID}/attachments/x-cv.pdf`,
        form_instance_id: FORM_ID,
        engagement_group_id: null,
      },
      error: null,
    });
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(204);
    expect(mockSupabase._chain.delete).toHaveBeenCalledTimes(1);

    const bucket = mockSupabase.storage.from('tender-documents');
    expect(bucket.remove).toHaveBeenCalledWith([
      `${FORM_ID}/attachments/x-cv.pdf`,
    ]);
  });

  it("deletes an engagement-scoped attachment (204) when it matches this form's engagement", async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: {
          id: ATTACHMENT_ID,
          storage_path: `engagement/${ENGAGEMENT_ID}/x-cv.pdf`,
          form_instance_id: null,
          engagement_group_id: ENGAGEMENT_ID,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { engagement_group_id: ENGAGEMENT_ID },
        error: null,
      });
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(204);
  });

  it('still returns 204 when the best-effort storage remove() fails (row is gone; orphan-sweep is the backstop)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: ATTACHMENT_ID,
        storage_path: `${FORM_ID}/attachments/x-cv.pdf`,
        form_instance_id: FORM_ID,
        engagement_group_id: null,
      },
      error: null,
    });
    mockSupabase.storage.from.mockReturnValue({
      upload: vi.fn(),
      remove: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'boom' } }),
    });
    const res = await DELETE(deleteRequest({ attachmentId: ATTACHMENT_ID }), {
      params: createTestParams({ id: FORM_ID }),
    });
    expect(res.status).toBe(204);
    expect(mockSupabase._chain.delete).toHaveBeenCalledTimes(1);
  });
});
