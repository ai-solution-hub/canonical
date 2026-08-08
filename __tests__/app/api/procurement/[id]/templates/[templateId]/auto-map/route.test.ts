/**
 * Procurement template auto-map route tests.
 *
 *   - POST /api/procurement/:id/templates/:templateId/auto-map — match the
 *     form's unmapped fields to its questions by text similarity
 *
 * Covers auth enforcement, UUID validation, rate limiting, the
 * template-not-analysed guard and the mapping result shape.
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

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockCheckRateLimit, mockSimilarity } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockSimilarity: vi.fn(),
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

vi.mock('@/lib/domains/procurement/form-templating/template-auto-map', () => ({
  similarity: mockSimilarity,
}));

// Import route handlers AFTER all vi.mock() calls
const { POST: autoMapPost } =
  await import('@/app/api/procurement/[id]/templates/[templateId]/auto-map/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
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
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  mockSimilarity.mockReturnValue(0.8);
  // NOTE: Do NOT set a default configureRole() here. Each test must
  // call configureRole() / configureUnauthenticated() explicitly so
  // that the queued .single() calls are consumed in the correct order.
});

describe('POST /api/procurement/:id/templates/:templateId/auto-map', () => {
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
