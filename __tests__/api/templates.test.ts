import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// Mock rate-limit to always allow (default) — override per test when needed
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 5 })),
}));

// Mock docx-utils — not encrypted by default
vi.mock('@/lib/docx-utils', () => ({
  isEncryptedDocx: vi.fn(() => false),
}));

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { GET as listTemplates, POST as uploadTemplate } from '@/app/api/bids/[id]/templates/route';
import { GET as getTemplateDetail, DELETE as deleteTemplate } from '@/app/api/bids/[id]/templates/[templateId]/route';
import { POST as analyseTemplate } from '@/app/api/bids/[id]/templates/[templateId]/analyse/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BID_UUID = '00000000-0000-4000-8000-000000000001';
const TEMPLATE_UUID = '00000000-0000-4000-8000-000000000002';
const JOB_UUID = '00000000-0000-4000-8000-000000000003';

/** DOCX magic bytes (PK\x03\x04) to pass isValidDocx check */
const DOCX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

/** Reset mock state and restore default authenticated user. */
function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Reset storage mock
  mockSupabase.storage.from.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  });
}

// ---------------------------------------------------------------------------
// GET /api/bids/:id/templates — list templates for a bid
// ---------------------------------------------------------------------------

describe('GET /api/bids/:id/templates', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates`);
    const params = createTestParams({ id: BID_UUID });
    const res = await listTemplates(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for invalid bid UUID', async () => {
    const req = createTestRequest('/api/bids/not-a-uuid/templates');
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await listTemplates(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid bid ID');
  });

  it('returns 404 when bid does not exist', async () => {
    // single() for bid lookup returns nothing
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates`);
    const params = createTestParams({ id: BID_UUID });
    const res = await listTemplates(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Bid not found');
  });

  it('returns 200 with templates list on success', async () => {
    // First single() call: bid lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    const mockTemplates = [
      {
        id: TEMPLATE_UUID,
        name: 'Security Questionnaire',
        filename: 'security-q.docx',
        status: 'analysed',
        field_count: 12,
        mapped_count: 8,
        file_size: 45000,
        created_at: '2026-03-01T10:00:00Z',
        updated_at: '2026-03-01T11:00:00Z',
      },
    ];

    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      thenCallCount++;
      if (thenCallCount === 1) {
        // Templates query
        return resolve({ data: mockTemplates, error: null });
      }
      if (thenCallCount === 2) {
        // Completions query
        return resolve({ data: [{ template_id: TEMPLATE_UUID }], error: null });
      }
      return resolve({ data: [], error: null });
    });

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates`);
    const params = createTestParams({ id: BID_UUID });
    const res = await listTemplates(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.templates).toHaveLength(1);
    expect(json.templates[0].id).toBe(TEMPLATE_UUID);
    expect(json.templates[0].name).toBe('Security Questionnaire');
    expect(json.templates[0].completions_count).toBe(1);
  });

  it('returns empty templates array when bid has no templates', async () => {
    // Bid exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: BID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates`);
    const params = createTestParams({ id: BID_UUID });
    const res = await listTemplates(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.templates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/bids/:id/templates — upload a template
// ---------------------------------------------------------------------------

describe('POST /api/bids/:id/templates', () => {
  beforeEach(resetMocks);

  it('returns 403 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates`, {
      method: 'POST',
    });
    const params = createTestParams({ id: BID_UUID });
    const res = await uploadTemplate(req, { params });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates`, {
      method: 'POST',
    });
    const params = createTestParams({ id: BID_UUID });
    const res = await uploadTemplate(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid bid UUID', async () => {
    // Two single() calls: first for role lookup, then route logic
    configureRole(mockSupabase, 'editor');

    // Build a real FormData with a file so it gets past auth
    const formData = new FormData();
    const file = new File([DOCX_MAGIC], 'test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    formData.append('file', file);

    const req = new Request('http://localhost:3000/api/bids/not-a-uuid/templates', {
      method: 'POST',
      body: formData,
    });
    const nextReq = req as unknown as import('next/server').NextRequest;
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await uploadTemplate(nextReq, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid bid ID');
  });
});

// ---------------------------------------------------------------------------
// GET /api/bids/:id/templates/:templateId — template detail
// ---------------------------------------------------------------------------

describe('GET /api/bids/:id/templates/:templateId', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`);
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await getTemplateDetail(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for invalid template UUID', async () => {
    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/bad-id`);
    const params = createTestParams({ id: BID_UUID, templateId: 'bad-id' });
    const res = await getTemplateDetail(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid ID format');
  });

  it('returns 404 when template does not exist', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`);
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await getTemplateDetail(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Template not found');
  });

  it('returns 200 with template detail, fields, summary, and completions', async () => {
    const mockTemplate = {
      id: TEMPLATE_UUID,
      project_id: BID_UUID,
      name: 'Security Questionnaire',
      description: 'Annual security questionnaire',
      filename: 'security-q.docx',
      storage_path: `${BID_UUID}/${TEMPLATE_UUID}/original.docx`,
      file_size: 45000,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      status: 'analysed',
      field_count: 3,
      mapped_count: 2,
      structure_path: null,
      created_by: 'test-user-id',
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-03-01T11:00:00Z',
    };

    // first single(): template lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: mockTemplate,
      error: null,
    });

    const mockFields = [
      {
        id: 'field-1',
        template_id: TEMPLATE_UUID,
        field_type: 'table_cell',
        table_index: 0,
        row_index: 1,
        col_index: 1,
        question_text: 'Describe your security policy',
        section_name: 'Security',
        word_limit: null,
        placeholder_text: null,
        question_id: null,
        mapping_status: 'unmapped',
        mapping_confidence: null,
        fill_status: null,
        fill_error: null,
        sequence: 1,
        created_at: '2026-03-01T10:05:00Z',
        updated_at: '2026-03-01T10:05:00Z',
      },
    ];

    // then() calls: fields, questions (empty since no question_id), responses (empty),
    //   rpc for summary, completions
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      thenCallCount++;
      if (thenCallCount === 1) {
        // Fields query
        return resolve({ data: mockFields, error: null });
      }
      // Completions query and anything else
      return resolve({ data: [], error: null });
    });

    // RPC for summary
    mockSupabase.rpc.mockResolvedValue({
      data: [{
        total_fields: 3,
        confirmed_fields: 2,
        rejected_fields: 0,
        unmapped_fields: 1,
        unreviewed_fields: 0,
        filled_fields: 1,
        pending_fields: 1,
        skipped_fields: 0,
        failed_fields: 0,
      }],
      error: null,
    });

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`);
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await getTemplateDetail(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(TEMPLATE_UUID);
    expect(json.name).toBe('Security Questionnaire');
    expect(json.fields).toHaveLength(1);
    expect(json.fields[0].question_text).toBe('Describe your security policy');
    expect(json.fields[0].matched_question).toBeNull();
    expect(json.summary.total_fields).toBe(3);
    expect(json.summary.confirmed_fields).toBe(2);
    expect(json.completions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/bids/:id/templates/:templateId — delete a template
// ---------------------------------------------------------------------------

describe('DELETE /api/bids/:id/templates/:templateId', () => {
  beforeEach(resetMocks);

  it('returns 403 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await deleteTemplate(req, { params });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 403 for editor role (admin only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await deleteTemplate(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest(`/api/bids/bad-id/templates/${TEMPLATE_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: 'bad-id', templateId: TEMPLATE_UUID });
    const res = await deleteTemplate(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid ID format');
  });

  it('returns 404 when template does not exist', async () => {
    configureRole(mockSupabase, 'admin');

    // single() for template lookup — not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await deleteTemplate(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Template not found');
  });

  it('returns 200 on successful delete', async () => {
    configureRole(mockSupabase, 'admin');

    // single() for template lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: TEMPLATE_UUID,
        storage_path: `${BID_UUID}/${TEMPLATE_UUID}/original.docx`,
        structure_path: null,
      },
      error: null,
    });

    // then() calls: completions query, delete query
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      thenCallCount++;
      if (thenCallCount === 1) {
        // Completions query
        return resolve({ data: [], error: null });
      }
      if (thenCallCount === 2) {
        // Delete query
        return resolve({ data: null, error: null });
      }
      return resolve({ data: null, error: null });
    });

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await deleteTemplate(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);

    // Verify storage cleanup was attempted
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('templates');
  });

  it('returns 500 when delete fails', async () => {
    configureRole(mockSupabase, 'admin');

    // Template lookup succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: TEMPLATE_UUID,
        storage_path: `${BID_UUID}/${TEMPLATE_UUID}/original.docx`,
        structure_path: null,
      },
      error: null,
    });

    // then() calls: completions query succeeds, delete fails
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      thenCallCount++;
      if (thenCallCount === 1) {
        return resolve({ data: [], error: null });
      }
      if (thenCallCount === 2) {
        // Delete fails
        return resolve({ data: null, error: { message: 'FK constraint violation' } });
      }
      return resolve({ data: null, error: null });
    });

    const req = createTestRequest(`/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}`, {
      method: 'DELETE',
    });
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await deleteTemplate(req, { params });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to delete template');
  });
});

// ---------------------------------------------------------------------------
// POST /api/bids/:id/templates/:templateId/analyse — queue template analysis
// ---------------------------------------------------------------------------

describe('POST /api/bids/:id/templates/:templateId/analyse', () => {
  beforeEach(resetMocks);

  it('returns 403 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: {} },
    );
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      `/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: {} },
    );
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID format', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      `/api/bids/bad-id/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: {} },
    );
    const params = createTestParams({ id: 'bad-id', templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid ID format');
  });

  it('returns 404 when template does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(
      `/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: {} },
    );
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Template not found');
  });

  it('returns 409 when template is already analysed (without force)', async () => {
    configureRole(mockSupabase, 'editor');

    // Template lookup — already analysed
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: TEMPLATE_UUID,
        project_id: BID_UUID,
        storage_path: `${BID_UUID}/${TEMPLATE_UUID}/original.docx`,
        status: 'analysed',
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: {} },
    );
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already in');
    expect(json.error).toContain('force');
  });

  it('returns 202 on successful analysis queue for uploaded template', async () => {
    configureRole(mockSupabase, 'editor');

    // Template lookup — uploaded status (eligible for analysis)
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: {
          id: TEMPLATE_UUID,
          project_id: BID_UUID,
          storage_path: `${BID_UUID}/${TEMPLATE_UUID}/original.docx`,
          status: 'uploaded',
        },
        error: null,
      })
      // Job insert
      .mockResolvedValueOnce({
        data: { id: JOB_UUID },
        error: null,
      });

    // then() for status update
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest(
      `/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: {} },
    );
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.job_id).toBe(JOB_UUID);
    expect(json.status).toBe('queued');
    expect(json.message).toBe('Template analysis queued');
  });

  it('returns 202 when force re-analysing an already analysed template', async () => {
    configureRole(mockSupabase, 'editor');

    // Template lookup — already analysed
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: {
          id: TEMPLATE_UUID,
          project_id: BID_UUID,
          storage_path: `${BID_UUID}/${TEMPLATE_UUID}/original.docx`,
          status: 'analysed',
        },
        error: null,
      })
      // Job insert
      .mockResolvedValueOnce({
        data: { id: JOB_UUID },
        error: null,
      });

    // then() calls: delete fields, update status
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest(
      `/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: { force: true } },
    );
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.job_id).toBe(JOB_UUID);

    // Verify existing fields were deleted before re-analysis
    expect(mockSupabase.from).toHaveBeenCalledWith('template_fields');
    expect(mockSupabase._chain.delete).toHaveBeenCalled();
  });

  it('returns 500 and reverts status when job queue fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Template lookup — uploaded
    mockSupabase._chain.single
      .mockResolvedValueOnce({
        data: {
          id: TEMPLATE_UUID,
          project_id: BID_UUID,
          storage_path: `${BID_UUID}/${TEMPLATE_UUID}/original.docx`,
          status: 'uploaded',
        },
        error: null,
      })
      // Job insert fails
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Queue insert failed' },
      });

    // then() for status updates
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest(
      `/api/bids/${BID_UUID}/templates/${TEMPLATE_UUID}/analyse`,
      { method: 'POST', body: {} },
    );
    const params = createTestParams({ id: BID_UUID, templateId: TEMPLATE_UUID });
    const res = await analyseTemplate(req, { params });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to queue analysis job');
  });
});
