/**
 * Procurement bulk field-mapping route tests.
 *
 *   - POST /api/procurement/:id/fields/bulk-update — apply several field →
 *     question mappings in one call
 *
 * DR-075 (ID-147 TECH.md §6 row B, ratified S474): re-keyed + re-pathed from
 * `templates/[templateId]/fields/bulk-update` -- `id` IS the form's own PK.
 *
 * Covers auth enforcement, UUID validation, body validation, the form lookup
 * and the updated/mapped counts returned on success.
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
const { POST: bulkUpdatePost } =
  await import('@/app/api/procurement/[id]/fields/bulk-update/route');

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

describe('POST /api/procurement/:id/fields/bulk-update', () => {
  const params = createTestParams({ id: VALID_UUID_2 });

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

    const req = createTestRequest('/api/procurement/y/fields/bulk-update', {
      method: 'POST',
      body: validBody,
    });

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/procurement/y/fields/bulk-update', {
      method: 'POST',
      body: validBody,
    });

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({ id: 'bad' });

    const req = createTestRequest('/api/procurement/bad/fields/bulk-update', {
      method: 'POST',
      body: validBody,
    });

    const res = await bulkUpdatePost(req, { params: badParams });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty mappings array', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/procurement/y/fields/bulk-update', {
      method: 'POST',
      body: { mappings: [] },
    });

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when the form is not found', async () => {
    configureRole(mockSupabase, 'editor');

    // Form lookup (after role lookup)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const req = createTestRequest('/api/procurement/y/fields/bulk-update', {
      method: 'POST',
      body: validBody,
    });

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(404);
  });

  it('returns 200 with updated count and mapped_count on success', async () => {
    configureRole(mockSupabase, 'editor');

    // Form exists
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

    const req = createTestRequest('/api/procurement/y/fields/bulk-update', {
      method: 'POST',
      body: validBody,
    });

    const res = await bulkUpdatePost(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.updated).toBe(1);
    expect(body.mapped_count).toBe(3);
  });
});
