/**
 * Procurement single-field mapping route tests.
 *
 *   - PATCH /api/procurement/:id/fields/:fieldId — set or confirm the question
 *     a form field maps to
 *
 * DR-075 (ID-147 TECH.md §6 row B, ratified S474): re-keyed + re-pathed from
 * `templates/[templateId]/fields/[fieldId]` -- `id` IS the form's own PK, no
 * more separate `templateId` segment.
 *
 * Covers auth enforcement, UUID validation on both params, body validation,
 * the form and field lookups, and the successful update.
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

// Import route handlers AFTER all vi.mock() calls
const { PATCH: fieldPatch } =
  await import('@/app/api/procurement/[id]/fields/[fieldId]/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const VALID_UUID_3 = 'c3d4e5f6-a7b8-1012-9def-123456789012';

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

  // NOTE: Do NOT set a default configureRole() here. Each test must
  // call configureRole() / configureUnauthenticated() explicitly so
  // that the queued .single() calls are consumed in the correct order.
});

describe('PATCH /api/procurement/:id/fields/:fieldId', () => {
  const params = createTestParams({
    id: VALID_UUID_2,
    fieldId: VALID_UUID_3,
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/procurement/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/procurement/y/fields/z', {
      method: 'PATCH',
      body: { question_id: VALID_UUID, mapping_status: 'confirmed' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 when any UUID is invalid (double validation)', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({
      id: 'not-uuid',
      fieldId: VALID_UUID_3,
    });

    const req = createTestRequest('/api/procurement/y/fields/z', {
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

    const req = createTestRequest('/api/procurement/y/fields/z', {
      method: 'PATCH',
      body: { mapping_status: 'invalid_status' },
    });

    const res = await fieldPatch(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 404 when the form is not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Form lookup (after role lookup)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/procurement/y/fields/z', {
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

    // Form exists
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Field not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/procurement/y/fields/z', {
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

    // Form exists
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

    const req = createTestRequest('/api/procurement/y/fields/z', {
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
