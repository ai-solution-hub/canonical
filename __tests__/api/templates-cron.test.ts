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

const {
  mockCookies,
  mockCheckRateLimit,
  mockVerifyCronAuth,
  mockGetUsersByRole,
  mockCreateBulkNotifications,
  mockGetExistingNotificationIds,
  mockClassifyContent,
  mockSimilarity,
  mockFetchTemplateRequirements,
  mockFetchContentForMatching,
  mockComputeTemplateCoverage,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockVerifyCronAuth: vi.fn(),
  mockGetUsersByRole: vi.fn(),
  mockCreateBulkNotifications: vi.fn(),
  mockGetExistingNotificationIds: vi.fn(),
  mockClassifyContent: vi.fn(),
  mockSimilarity: vi.fn(),
  mockFetchTemplateRequirements: vi.fn(),
  mockFetchContentForMatching: vi.fn(),
  mockComputeTemplateCoverage: vi.fn(),
}));

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

vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: mockVerifyCronAuth,
  getUsersByRole: mockGetUsersByRole,
}));

vi.mock('@/lib/notifications', () => ({
  createBulkNotifications: mockCreateBulkNotifications,
  getExistingNotificationIds: mockGetExistingNotificationIds,
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mockClassifyContent,
}));

vi.mock('@/lib/domains/procurement/form-templating/template-auto-map', () => ({
  similarity: mockSimilarity,
}));

vi.mock('@/lib/domains/procurement/form-templating/template-coverage', () => ({
  fetchTemplateRequirements: mockFetchTemplateRequirements,
  fetchContentForMatching: mockFetchContentForMatching,
  computeTemplateCoverage: mockComputeTemplateCoverage,
}));

// Import route handlers AFTER all vi.mock() calls
const { POST: autoMapPost } =
  await import('@/app/api/procurement/[id]/templates/[templateId]/auto-map/route');
const { PATCH: fieldPatch } =
  await import('@/app/api/procurement/[id]/templates/[templateId]/fields/[fieldId]/route');
const { POST: bulkUpdatePost } =
  await import('@/app/api/procurement/[id]/templates/[templateId]/fields/bulk-update/route');
const { POST: fillPost } =
  await import('@/app/api/procurement/[id]/templates/[templateId]/fill/route');
const { PATCH: subtopicPatch } =
  await import('@/app/api/taxonomy/subtopics/[id]/route');
const { GET: freshnessGet } =
  await import('@/app/api/cron/freshness-transitions/route');
const { GET: classificationGet } =
  await import('@/app/api/cron/classification-quality/route');
const { GET: contentGapsGet } =
  await import('@/app/api/cron/content-gaps/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const VALID_UUID_3 = 'c3d4e5f6-a7b8-1012-9def-123456789012';

function cronRequest(path: string) {
  return createTestRequest(path, {
    method: 'GET',
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

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

  // Chainable methods return the chain (including .filter used by freshness route)
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
    'filter',
  ] as const;
  for (const m of chainable) {
    (
      mockSupabase._chain as unknown as Record<string, ReturnType<typeof vi.fn>>
    )[m] ??= vi.fn();
    (
      mockSupabase._chain as unknown as Record<string, ReturnType<typeof vi.fn>>
    )[m].mockReturnValue(mockSupabase._chain);
  }

  // Terminal methods
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // External dependency defaults
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  mockVerifyCronAuth.mockReturnValue(true);
  mockGetUsersByRole.mockResolvedValue(['admin-1']);
  mockCreateBulkNotifications.mockResolvedValue({ count: 0, error: null });
  mockGetExistingNotificationIds.mockResolvedValue(new Set());
  mockSimilarity.mockReturnValue(0.8);
  mockClassifyContent.mockResolvedValue({
    primary_domain: 'Engineering',
    primary_subtopic: 'Standards',
    classification_confidence: 0.9,
  });
  mockFetchTemplateRequirements.mockResolvedValue([]);
  mockFetchContentForMatching.mockResolvedValue([]);
  mockComputeTemplateCoverage.mockReturnValue({
    total_requirements: 0,
    strong_count: 0,
    partial_count: 0,
    gap_count: 0,
    score: 100,
    sections: [],
  });

  // NOTE: Do NOT set a default configureRole() here. Each test must
  // call configureRole() / configureUnauthenticated() explicitly so
  // that the queued .single() calls are consumed in the correct order.
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/templates/:templateId/auto-map
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/templates/:templateId/auto-map', () => {
  const params = createTestParams({ id: VALID_UUID, templateId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: {},
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: {},
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID in bid or template ID', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({
      id: 'not-a-uuid',
      templateId: VALID_UUID_2,
    });
    const req = createTestRequest(
      '/api/procurement/not-a-uuid/templates/y/auto-map',
      {
        method: 'POST',
        body: {},
      },
    );

    const res = await autoMapPost(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid ID/);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: {},
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(429);
  });

  it('returns 404 when template not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Role lookup consumed first .single(), now template lookup:
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: {},
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Template not found');
  });

  it('returns 409 when template not yet analysed', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, processing_status: 'uploaded' },
      error: null,
    });

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: {},
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toMatch(/analysed/);
  });

  it('returns empty mapping result when no unmapped fields exist', async () => {
    configureRole(mockSupabase, 'editor');

    // Template exists and is analysed
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, processing_status: 'analysed' },
      error: null,
    });

    // No unmapped fields returned
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: {},
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mapped).toBe(0);
    expect(body.total).toBe(0);
  });

  it('maps fields to questions using similarity and updates mapped_count', async () => {
    configureRole(mockSupabase, 'editor');

    // Template exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, processing_status: 'analysed' },
      error: null,
    });

    // Unmapped form_instance_fields rows -- ID-145 {145.14}: real writer
    // output (e.g. PDF's pdfplumber-paired label text, {145.11}), not the
    // structural no-op the route was before a field writer existed.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'field-1', question_text: 'Describe your experience' }],
          error: null,
        }),
    );

    // This form's form_questions rows
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: 'q-1', question_text: 'Describe your relevant experience' },
          ],
          error: null,
        }),
    );

    // similarity returns 0.8 (above threshold)
    mockSimilarity.mockReturnValue(0.8);

    // Count query for mapped_count (returns via .then since head: true)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 1 }),
    );

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: { threshold: 0.7 },
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mapped).toBe(1);
    expect(body.mappings).toHaveLength(1);
    expect(body.mappings[0].confidence).toBe(0.8);
    // BI-21/BI-26: auto-map leaves the field 'unreviewed' (not
    // pre-confirmed) so the user can still review/adjust the mapping.
    expect(body.mappings[0].field_id).toBe('field-1');
    expect(body.mappings[0].question_id).toBe('q-1');
  });

  it('produces a per-field mapping over real form_instance_fields rows, not a no-op against an empty set', async () => {
    configureRole(mockSupabase, 'editor');

    // Template exists and is analysed
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, processing_status: 'analysed' },
      error: null,
    });

    // Two real fields carrying non-empty question_text (PDF: pdfplumber-
    // paired label text {145.11}; OOXML: cell labels {145.10}).
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: 'field-1', question_text: 'Company registration number' },
            { id: 'field-2', question_text: 'Unrelated field text' },
          ],
          error: null,
        }),
    );

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'q-1', question_text: 'Company registration number' }],
          error: null,
        }),
    );

    mockSimilarity
      .mockReturnValueOnce(1.0) // field-1 vs q-1: exact match
      .mockReturnValueOnce(0.1); // field-2 vs q-1: below threshold

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 1 }),
    );

    const req = createTestRequest('/api/procurement/x/templates/y/auto-map', {
      method: 'POST',
      body: { threshold: 0.7 },
    });

    const res = await autoMapPost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.mapped).toBe(1);
    expect(body.unmapped).toBe(1);
    expect(body.mappings[0].field_question_text).toBe(
      'Company registration number',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/bids/:id/templates/:templateId/fields/:fieldId
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/bids/:id/templates/:templateId/fields/:fieldId', () => {
  const params = createTestParams({
    id: VALID_UUID,
    templateId: VALID_UUID_2,
    fieldId: VALID_UUID_3,
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/procurement/x/templates/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/procurement/x/templates/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 when any UUID is invalid (triple validation)', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({
      id: VALID_UUID,
      templateId: 'not-uuid',
      fieldId: VALID_UUID_3,
    });

    const req = createTestRequest('/api/procurement/x/templates/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid ID/);
  });

  it('returns 400 for invalid request body (FieldMappingUpdateSchema)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/procurement/x/templates/y/fields/z', {
      method: 'PATCH',
      body: { mapping_status: 'invalid_status' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 404 when template not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Template lookup (after role lookup)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/procurement/x/templates/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Template not found');
  });

  it('returns 404 when field not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Template exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Field not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/procurement/x/templates/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Field not found');
  });

  it('returns 200 with updated field data on success', async () => {
    configureRole(mockSupabase, 'editor');

    // Template exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Field updated successfully
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_3,
        question_id: VALID_UUID,
        mapping_status: 'confirmed',
        updated_at: '2026-03-14T12:00:00Z',
      },
      error: null,
    });

    // Count query for mapped_count recalculation
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 5 }),
    );

    const req = createTestRequest('/api/procurement/x/templates/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID_3);
    expect(body.mapping_status).toBe('confirmed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/templates/:templateId/fields/bulk-update
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/templates/:templateId/fields/bulk-update', () => {
  const params = createTestParams({ id: VALID_UUID, templateId: VALID_UUID_2 });

  const validBody = {
    mappings: [
      {
        field_id: VALID_UUID_3,
        question_id: VALID_UUID,
        mapping_status: 'confirmed' as const,
      },
    ],
  };

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      '/api/procurement/x/templates/y/fields/bulk-update',
      {
        method: 'POST',
        body: validBody,
      },
    );

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(
      '/api/procurement/x/templates/y/fields/bulk-update',
      {
        method: 'POST',
        body: validBody,
      },
    );

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({ id: 'bad', templateId: VALID_UUID_2 });

    const req = createTestRequest(
      '/api/procurement/bad/templates/y/fields/bulk-update',
      {
        method: 'POST',
        body: validBody,
      },
    );

    const res = await bulkUpdatePost(req, { params: badParams });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty mappings array', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(
      '/api/procurement/x/templates/y/fields/bulk-update',
      {
        method: 'POST',
        body: { mappings: [] },
      },
    );

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when template not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Template lookup (after role lookup)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest(
      '/api/procurement/x/templates/y/fields/bulk-update',
      {
        method: 'POST',
        body: validBody,
      },
    );

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 200 with updated count and mapped_count on success', async () => {
    configureRole(mockSupabase, 'editor');

    // Template exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Each field update succeeds (via .then)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // Count query for mapped_count
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 3 }),
    );

    const req = createTestRequest(
      '/api/procurement/x/templates/y/fields/bulk-update',
      {
        method: 'POST',
        body: validBody,
      },
    );

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.updated).toBe(1);
    expect(body.mapped_count).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bids/:id/templates/:templateId/fill
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/bids/:id/templates/:templateId/fill', () => {
  const params = createTestParams({ id: VALID_UUID, templateId: VALID_UUID_2 });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/procurement/x/templates/y/fill', {
      method: 'POST',
      body: {},
    });

    const res = await fillPost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/procurement/x/templates/y/fill', {
      method: 'POST',
      body: {},
    });

    const res = await fillPost(req, { params });
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({ id: 'bad', templateId: VALID_UUID_2 });

    const req = createTestRequest('/api/procurement/bad/templates/y/fill', {
      method: 'POST',
      body: {},
    });

    const res = await fillPost(req, { params: badParams });
    expect(res.status).toBe(400);
  });

  it('returns 404 when template not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Template lookup (after role lookup)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/procurement/x/templates/y/fill', {
      method: 'POST',
      body: {},
    });

    const res = await fillPost(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 409 when template not yet analysed', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_2,
        workspace_id: VALID_UUID,
        storage_path: '/test.docx',
        status: 'uploaded',
      },
      error: null,
    });

    const req = createTestRequest('/api/procurement/x/templates/y/fill', {
      method: 'POST',
      body: {},
    });

    const res = await fillPost(req, { params });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toMatch(/analysed/);
  });

  // NOTE: "returns 400 when no fields have been mapped" was removed here —
  // it duplicated __tests__/api/procurement-templates-fill.test.ts's
  // "returns 400 when there are no outstanding mapped fields" (same form
  // fetch -> empty fields -> 400 "No fields have been mapped" scenario,
  // same route). Kept in exactly one place per {145.15} test sync.

  it('returns 202 when fill job is queued successfully', async () => {
    configureRole(mockSupabase, 'editor');

    // Form exists and is analysed (form_instances, keyed on processing_status
    // post-{145.15} form-first fill rewrite).
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, processing_status: 'analysed' },
      error: null,
    });

    // Confirmed fields (form_instance_fields, form_instance_id-keyed)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'f-1',
              table_index: 0,
              row_index: 1,
              col_index: 1,
              question_id: 'q-1',
              word_limit: 200,
              mapping_status: 'confirmed',
              fill_status: 'pending',
            },
          ],
          error: null,
        }),
    );

    // Responses for questions
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              question_id: 'q-1',
              response_text: 'Our experience spans 10 years.',
              review_status: 'approved',
              version: 1,
            },
          ],
          error: null,
        }),
    );

    // Job insert returns job ID
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'job-1' },
      error: null,
    });

    const req = createTestRequest('/api/procurement/x/templates/y/fill', {
      method: 'POST',
      body: {},
    });

    const res = await fillPost(req, { params });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.job_id).toBe('job-1');
    expect(body.status).toBe('queued');
    expect(body.fields_to_fill).toBe(1);
  });

  it('returns 500 and reverts template status when queue job insert fails', async () => {
    configureRole(mockSupabase, 'editor');

    // Form exists (form_instances, processing_status-keyed)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2, processing_status: 'analysed' },
      error: null,
    });

    // Confirmed fields (form_instance_fields, form_instance_id-keyed)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'f-1',
              table_index: 0,
              row_index: 1,
              col_index: 1,
              question_id: 'q-1',
              word_limit: null,
              mapping_status: 'confirmed',
              fill_status: 'pending',
            },
          ],
          error: null,
        }),
    );

    // Responses
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              question_id: 'q-1',
              response_text: 'Answer text.',
              review_status: 'approved',
              version: 1,
            },
          ],
          error: null,
        }),
    );

    // Job insert fails
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Insert failed', code: '50000' },
    });

    const req = createTestRequest('/api/procurement/x/templates/y/fill', {
      method: 'POST',
      body: {},
    });

    const res = await fillPost(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toMatch(/queue/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/taxonomy/subtopics/:id
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/taxonomy/subtopics/:id', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/taxonomy/subtopics/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated Name' },
    });

    const res = await subtopicPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for editor role (admin only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/taxonomy/subtopics/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated Name' },
    });

    const res = await subtopicPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'admin');

    const badParams = createTestParams({ id: 'bad-id' });

    const req = createTestRequest('/api/taxonomy/subtopics/bad-id', {
      method: 'PATCH',
      body: { name: 'Updated Name' },
    });

    const res = await subtopicPatch(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid subtopic ID/);
  });

  it('returns 400 when no update fields provided', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest(`/api/taxonomy/subtopics/${VALID_UUID}`, {
      method: 'PATCH',
      body: {},
    });

    const res = await subtopicPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('No fields to update');
  });

  it('returns 409 for unique constraint violation (23505)', async () => {
    configureRole(mockSupabase, 'admin');

    // Supabase update returns unique constraint error
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Duplicate key', code: '23505' },
    });

    const req = createTestRequest(`/api/taxonomy/subtopics/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Existing Name' },
    });

    const res = await subtopicPatch(req, { params });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toMatch(/already exists/);
  });

  it('returns 404 when subtopic not found (PGRST116)', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/taxonomy/subtopics/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'New Name' },
    });

    const res = await subtopicPatch(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Subtopic not found');
  });

  it('returns 200 with updated subtopic data on success', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        domain_id: VALID_UUID_2,
        name: 'Updated Name',
        display_order: 1,
        is_active: true,
      },
      error: null,
    });

    const req = createTestRequest(`/api/taxonomy/subtopics/${VALID_UUID}`, {
      method: 'PATCH',
      body: { name: 'Updated Name' },
    });

    const res = await subtopicPatch(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe('Updated Name');
    expect(body.id).toBe(VALID_UUID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/cron/freshness-transitions
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/cron/freshness-transitions', () => {
  it('returns 401 when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const req = cronRequest('/api/cron/freshness-transitions');
    const res = await freshnessGet(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with zero notifications when no transitions detected', async () => {
    // Governance config query (consumed first by the route)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // Content items query returns no items
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = cronRequest('/api/cron/freshness-transitions');
    const res = await freshnessGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications_created).toBe(0);
  });

  it('creates individual notifications when transitions are within batch threshold', async () => {
    // ID-131 {131.19}: content_items is dying — the route now reads
    // record_lifecycle (owner_kind='source_document') joined to
    // source_documents.
    const transitions = [
      {
        source_document_id: 'item-1',
        previous_freshness: 'fresh',
        freshness: 'aging',
        lifecycle_type: 'standard',
        content_owner_id: null,
        governance_review_status: null,
        verified_at: null,
        source_documents: {
          id: 'item-1',
          filename: 'test-item.pdf',
          suggested_title: 'Test Item',
          primary_domain: 'Engineering',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    ];

    // Governance config query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // Content items query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: transitions, error: null }),
    );

    mockGetUsersByRole.mockResolvedValue(['admin-1', 'editor-1']);
    mockGetExistingNotificationIds.mockResolvedValue(new Set());
    mockCreateBulkNotifications.mockResolvedValue({ count: 2, error: null });

    const req = cronRequest('/api/cron/freshness-transitions');
    const res = await freshnessGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications_created).toBe(2);
    expect(body.transitions.fresh_to_aging).toBe(1);

    // Verify individual notifications were created (not summary)
    const bulkCall = mockCreateBulkNotifications.mock.calls[0];
    expect(bulkCall[1]).toHaveLength(2); // 1 transition x 2 users
    expect(bulkCall[1][0].title).toMatch(/ageing/);
  });

  it('creates summary notification when transitions exceed batch threshold (>10)', async () => {
    // ID-131 {131.19}: content_items is dying — record_lifecycle facet
    // joined to source_documents.
    const transitions = Array.from({ length: 12 }, (_, i) => ({
      source_document_id: `item-${i}`,
      previous_freshness: 'fresh',
      freshness: 'aging',
      lifecycle_type: 'standard',
      content_owner_id: null,
      governance_review_status: null,
      verified_at: null,
      source_documents: {
        id: `item-${i}`,
        filename: `test-item-${i}.pdf`,
        suggested_title: `Test Item ${i}`,
        primary_domain: 'Engineering',
        updated_at: '2026-01-01T00:00:00Z',
      },
    }));

    // Governance config query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // Content items query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: transitions, error: null }),
    );

    mockGetUsersByRole.mockResolvedValue(['admin-1']);
    mockGetExistingNotificationIds.mockResolvedValue(new Set());
    mockCreateBulkNotifications.mockResolvedValue({ count: 1, error: null });

    const req = cronRequest('/api/cron/freshness-transitions');
    const res = await freshnessGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications_created).toBe(1);

    // Verify summary notification was created
    const bulkCall = mockCreateBulkNotifications.mock.calls[0];
    expect(bulkCall[1]).toHaveLength(1); // 1 summary x 1 user
    expect(bulkCall[1][0].title).toMatch(/12 items changed freshness status/);
  });

  it('skips already-notified items for idempotency', async () => {
    // ID-131 {131.19}: content_items is dying — record_lifecycle facet
    // joined to source_documents.
    const transitions = [
      {
        source_document_id: 'item-1',
        previous_freshness: 'fresh',
        freshness: 'stale',
        lifecycle_type: null,
        content_owner_id: null,
        governance_review_status: null,
        verified_at: null,
        source_documents: {
          id: 'item-1',
          filename: 'already-notified.pdf',
          suggested_title: 'Already Notified',
          primary_domain: null,
          updated_at: null,
        },
      },
    ];

    // Governance config query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // Content items query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: transitions, error: null }),
    );

    mockGetUsersByRole.mockResolvedValue(['admin-1']);
    // Already notified for item-1
    mockGetExistingNotificationIds.mockResolvedValue(new Set(['item-1']));

    const req = cronRequest('/api/cron/freshness-transitions');
    const res = await freshnessGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications_created).toBe(0);
  });

  it('returns 500 when freshness query fails', async () => {
    // Governance config query succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // Content items query fails
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

    const req = cronRequest('/api/cron/freshness-transitions');
    const res = await freshnessGet(req);

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/cron/classification-quality
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/cron/classification-quality', () => {
  it('returns 401 when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const req = cronRequest('/api/cron/classification-quality');
    const res = await classificationGet(req);

    expect(res.status).toBe(401);
  });

  it('returns 200 with zero counts when no candidates found', async () => {
    // Taxonomy latest subtopic query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // No candidates
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = cronRequest('/api/cron/classification-quality');
    const res = await classificationGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates_found).toBe(0);
    expect(body.reclassified).toBe(0);
  });

  it('auto-updates items when same taxonomy with improved confidence', async () => {
    // Taxonomy query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { created_at: '2026-01-01T00:00:00Z' },
      error: null,
    });

    // Candidates
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              // ID-131 {131.19}: content_items is dying — the route now
              // reads source_documents (suggested_title/filename, no bare
              // `title` column).
              id: 'item-1',
              suggested_title: 'Test Item',
              filename: 'test-item.pdf',
              primary_domain: 'Engineering',
              primary_subtopic: 'Standards',
              classification_confidence: 0.5,
              classified_at: '2025-01-01T00:00:00Z',
            },
          ],
          error: null,
        }),
    );

    mockGetUsersByRole.mockResolvedValue(['admin-1']);

    // classifyContent returns same domain/subtopic with higher confidence
    mockClassifyContent.mockResolvedValue({
      primary_domain: 'Engineering',
      primary_subtopic: 'Standards',
      classification_confidence: 0.9,
    });

    const req = cronRequest('/api/cron/classification-quality');
    const res = await classificationGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.auto_updated).toBe(1);
    expect(body.flagged_for_review).toBe(0);
  });

  it('flags items for review when reclassification suggests different taxonomy', async () => {
    // Taxonomy query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { created_at: '2026-01-01T00:00:00Z' },
      error: null,
    });

    // Candidates
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-1',
              suggested_title: 'Test Item',
              filename: 'test-item.pdf',
              primary_domain: 'Engineering',
              primary_subtopic: 'Standards',
              classification_confidence: 0.5,
              classified_at: '2025-01-01T00:00:00Z',
            },
          ],
          error: null,
        }),
    );

    mockGetUsersByRole.mockResolvedValue(['admin-1']);

    // classifyContent returns DIFFERENT domain
    mockClassifyContent.mockResolvedValue({
      primary_domain: 'Compliance',
      primary_subtopic: 'Regulatory',
      classification_confidence: 0.85,
    });

    mockCreateBulkNotifications.mockResolvedValue({ count: 1, error: null });

    const req = cronRequest('/api/cron/classification-quality');
    const res = await classificationGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flagged_for_review).toBe(1);
    expect(body.notifications_created).toBe(1);
  });

  it('records unchanged when same taxonomy with equal or lower confidence', async () => {
    // Taxonomy query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { created_at: '2026-01-01T00:00:00Z' },
      error: null,
    });

    // Candidates
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-1',
              suggested_title: 'Test Item',
              filename: 'test-item.pdf',
              primary_domain: 'Engineering',
              primary_subtopic: 'Standards',
              classification_confidence: 0.65,
              classified_at: '2025-12-01T00:00:00Z',
            },
          ],
          error: null,
        }),
    );

    mockGetUsersByRole.mockResolvedValue(['admin-1']);

    // Same taxonomy but lower confidence
    mockClassifyContent.mockResolvedValue({
      primary_domain: 'Engineering',
      primary_subtopic: 'Standards',
      classification_confidence: 0.6,
    });

    const req = cronRequest('/api/cron/classification-quality');
    const res = await classificationGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unchanged).toBe(1);
  });

  it('records error and stops batch processing on rate limit', async () => {
    // Taxonomy query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // Two candidates
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-1',
              suggested_title: 'Item 1',
              filename: 'item-1.pdf',
              primary_domain: 'Eng',
              primary_subtopic: 'S',
              classification_confidence: 0.4,
              classified_at: null,
            },
            {
              id: 'item-2',
              suggested_title: 'Item 2',
              filename: 'item-2.pdf',
              primary_domain: 'Eng',
              primary_subtopic: 'S',
              classification_confidence: 0.3,
              classified_at: null,
            },
          ],
          error: null,
        }),
    );

    mockGetUsersByRole.mockResolvedValue(['admin-1']);

    // First call rate-limits
    mockClassifyContent.mockRejectedValueOnce(new Error('429 Rate limited'));

    const req = cronRequest('/api/cron/classification-quality');
    const res = await classificationGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Should have 1 error result, and should have stopped before processing item-2
    expect(body.reclassified).toBe(1);
  });

  it('skips entire run when no admin user found', async () => {
    // Taxonomy query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // Candidates exist
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-1',
              suggested_title: 'Test',
              filename: 'test.pdf',
              primary_domain: null,
              primary_subtopic: null,
              classification_confidence: null,
              classified_at: null,
            },
          ],
          error: null,
        }),
    );

    mockGetUsersByRole.mockResolvedValue([]);

    const req = cronRequest('/api/cron/classification-quality');
    const res = await classificationGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped_reason).toBe('no_admin_user');
  });
});

// GET /api/cron/coverage-alerts was retired under ID-131.19 fix-Executor
// escalation 2 (DR-034 owner ruling) — the content_items-era coverage
// feature (matrix/summary/routes/cron) is retired, not re-pointed. Its
// describe block, and the vercel.json cron registration, were removed in
// the same commit. GET /api/cron/content-gaps below is unrelated — it runs
// on the already-repointed (q_a_pairs/reference_items) template-completion
// coverage engine, not content_items, and survives untouched.

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/cron/content-gaps
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/cron/content-gaps', () => {
  it('returns 401 when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const req = cronRequest('/api/cron/content-gaps');
    const res = await contentGapsGet(req);

    expect(res.status).toBe(401);
  });

  it('returns 200 with zero templates when none are current', async () => {
    // No templates
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const req = cronRequest('/api/cron/content-gaps');
    const res = await contentGapsGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates_analysed).toBe(0);
    expect(body.total_requirements).toBe(0);
  });

  it('returns 500 when template query fails', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

    const req = cronRequest('/api/cron/content-gaps');
    const res = await contentGapsGet(req);

    expect(res.status).toBe(500);
  });

  it('analyses templates and identifies new and resolved gaps', async () => {
    // Templates exist
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              template_name: 'PQQ v1',
              template_version: '1.0',
              is_current: true,
            },
          ],
          error: null,
        }),
    );

    // Previous run with one old gap (req-old) that is now resolved
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        result: {
          snapshots: [
            {
              template: 'PQQ v1',
              version: '1.0',
              snapshot_date: '2026-03-07',
              gaps: ['req-old'],
              coverage_score: 70,
            },
          ],
          consecutive_gap_counts: { 'req-old': 2 },
        },
      },
      error: null,
    });

    // fetchContentForMatching
    mockFetchContentForMatching.mockResolvedValue([
      {
        id: 'content-1',
        primary_domain: 'Engineering',
        primary_subtopic: 'Standards',
      },
    ]);

    // fetchTemplateRequirements
    mockFetchTemplateRequirements.mockResolvedValue([
      { template_type: 'psq', requirement_id: 'req-1', section: 'S1' },
    ]);

    // computeTemplateCoverage — req-new is a gap, req-old is no longer present (resolved)
    mockComputeTemplateCoverage.mockReturnValue({
      total_requirements: 5,
      strong_count: 3,
      partial_count: 1,
      gap_count: 1,
      score: 70,
      sections: [
        {
          section: 'S1',
          requirements: [
            { requirement_id: 'req-new', coverage_status: 'gap' },
            { requirement_id: 'req-2', coverage_status: 'strong' },
          ],
        },
      ],
    });

    mockGetUsersByRole.mockResolvedValue(['admin-1']);
    mockGetExistingNotificationIds.mockResolvedValue(new Set());
    mockCreateBulkNotifications.mockResolvedValue({ count: 1, error: null });

    const req = cronRequest('/api/cron/content-gaps');
    const res = await contentGapsGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates_analysed).toBe(1);
    expect(body.total_requirements).toBe(5);
    expect(body.gaps['PQQ v1']).toBeDefined();
    expect(body.gaps['PQQ v1'].new_gaps).toBe(1);
    // req-old was in previous gaps but not in current gaps, so it's resolved
    expect(body.gaps['PQQ v1'].resolved_gaps).toBe(1);
  });

  it('tracks consecutive gap counts and detects persistent gaps after 3 weeks', async () => {
    // Templates
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { template_name: 'ITT', template_version: '2.0', is_current: true },
          ],
          error: null,
        }),
    );

    // Previous run with req-persist at 2 consecutive weeks
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        result: {
          snapshots: [
            {
              template: 'ITT',
              version: '2.0',
              snapshot_date: '2026-03-07',
              gaps: ['req-persist'],
              coverage_score: 80,
            },
          ],
          consecutive_gap_counts: { 'req-persist': 2 },
        },
      },
      error: null,
    });

    mockFetchContentForMatching.mockResolvedValue([]);

    mockFetchTemplateRequirements.mockResolvedValue([
      { template_type: 'itt', requirement_id: 'req-persist', section: 'S1' },
    ]);

    // req-persist is still a gap (3rd consecutive week = persistent)
    mockComputeTemplateCoverage.mockReturnValue({
      total_requirements: 1,
      strong_count: 0,
      partial_count: 0,
      gap_count: 1,
      score: 0,
      sections: [
        {
          section: 'S1',
          requirements: [
            { requirement_id: 'req-persist', coverage_status: 'gap' },
          ],
        },
      ],
    });

    mockGetUsersByRole.mockResolvedValue(['admin-1']);
    mockGetExistingNotificationIds.mockResolvedValue(new Set());
    mockCreateBulkNotifications.mockResolvedValue({ count: 2, error: null });

    const req = cronRequest('/api/cron/content-gaps');
    const res = await contentGapsGet(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gaps['ITT'].persistent_gaps).toBe(1);
  });
});
