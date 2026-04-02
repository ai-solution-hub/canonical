import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

// Import routes AFTER mocks are registered
import { GET as listLayers, POST as createLayer } from '@/app/api/layers/route';
import {
  PATCH as updateLayer,
  DELETE as deleteLayer,
} from '@/app/api/layers/[id]/route';
import { PUT as reorderLayers } from '@/app/api/layers/reorder/route';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

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
  for (const method of chainable) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
});

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_LAYERS = [
  {
    id: 'layer-1',
    key: 'sales_brief',
    label: 'Sales Brief',
    description: 'Positioning and messaging',
    display_order: 10,
    is_active: true,
    created_at: '2026-03-19T00:00:00Z',
    updated_at: null,
  },
  {
    id: 'layer-2',
    key: 'bid_detail',
    label: 'Bid Detail',
    description: 'Factual content for tenders',
    display_order: 20,
    is_active: true,
    created_at: '2026-03-19T00:00:00Z',
    updated_at: null,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/layers
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/layers', () => {
  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);
    const res = await listLayers();
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    configureRole(mockSupabase, 'editor');
    const res = await listLayers();
    expect(res.status).toBe(403);
  });

  it('returns layers for admin users', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: SAMPLE_LAYERS, error: null }),
    );

    const res = await listLayers();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(SAMPLE_LAYERS);
  });

  it('returns empty array when no layers exist', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const res = await listLayers();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns 500 on database error', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

    const res = await listLayers();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/layers
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/layers', () => {
  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/layers', {
      method: 'POST',
      body: { key: 'test', label: 'Test' },
    });
    const res = await createLayer(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/layers', {
      method: 'POST',
      body: { key: 'test', label: 'Test' },
    });
    const res = await createLayer(req);
    expect(res.status).toBe(403);
  });

  it('creates a layer with valid data', async () => {
    configureRole(mockSupabase, 'admin');

    // Mock the max display_order lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { display_order: 40 },
      error: null,
    });
    // Mock the insert result
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-layer',
        key: 'technical',
        label: 'Technical',
        display_order: 50,
      },
      error: null,
    });

    const req = createTestRequest('/api/layers', {
      method: 'POST',
      body: { key: 'technical', label: 'Technical' },
    });
    const res = await createLayer(req);
    expect(res.status).toBe(201);
  });

  it('creates a layer with explicit display_order', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-layer',
        key: 'technical',
        label: 'Technical',
        display_order: 5,
      },
      error: null,
    });

    const req = createTestRequest('/api/layers', {
      method: 'POST',
      body: { key: 'technical', label: 'Technical', display_order: 5 },
    });
    const res = await createLayer(req);
    expect(res.status).toBe(201);
  });

  it('returns 409 for duplicate key', async () => {
    configureRole(mockSupabase, 'admin');

    // First single() call: auto-assign display_order lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { display_order: 40 },
      error: null,
    });
    // Second single() call: insert fails with unique violation
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'unique violation' },
    });

    const req = createTestRequest('/api/layers', {
      method: 'POST',
      body: { key: 'sales_brief', label: 'Sales Brief' },
    });
    const res = await createLayer(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already exists');
  });

  it('returns 400 for missing required fields', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/layers', {
      method: 'POST',
      body: { key: 'test' }, // missing label
    });
    const res = await createLayer(req);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/layers/:id
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/layers/:id', () => {
  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/layers/layer-1', {
      method: 'PATCH',
      body: { label: 'Updated' },
    });
    const res = await updateLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/layers/layer-1', {
      method: 'PATCH',
      body: { label: 'Updated' },
    });
    const res = await updateLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(403);
  });

  it('updates a layer successfully', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...SAMPLE_LAYERS[0], label: 'Updated Brief' },
      error: null,
    });

    const req = createTestRequest('/api/layers/layer-1', {
      method: 'PATCH',
      body: { label: 'Updated Brief' },
    });
    const res = await updateLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.label).toBe('Updated Brief');
  });

  it('returns 404 when layer not found', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });

    const req = createTestRequest('/api/layers/nonexistent', {
      method: 'PATCH',
      body: { label: 'Updated' },
    });
    const res = await updateLayer(req, {
      params: createTestParams({ id: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it('can toggle is_active', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { ...SAMPLE_LAYERS[0], is_active: false },
      error: null,
    });

    const req = createTestRequest('/api/layers/layer-1', {
      method: 'PATCH',
      body: { is_active: false },
    });
    const res = await updateLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/layers/:id
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/layers/:id', () => {
  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/layers/layer-1', { method: 'DELETE' });
    const res = await deleteLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/layers/layer-1', { method: 'DELETE' });
    const res = await deleteLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(403);
  });

  it('deletes a layer with no content assigned', async () => {
    configureRole(mockSupabase, 'admin');
    // Look up the layer key
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { key: 'test_layer' },
      error: null,
    });
    // Count content items using this layer
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 0 }),
    );
    // Delete succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/layers/layer-1', { method: 'DELETE' });
    const res = await deleteLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(204);
  });

  it('returns 409 when content items reference the layer', async () => {
    configureRole(mockSupabase, 'admin');
    // Look up the layer key
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { key: 'sales_brief' },
      error: null,
    });
    // Count content items: 5 items use this layer
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 5 }),
    );

    const req = createTestRequest('/api/layers/layer-1', { method: 'DELETE' });
    const res = await deleteLayer(req, {
      params: createTestParams({ id: 'layer-1' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('5 content items');
    expect(body.count).toBe(5);
  });

  it('returns 404 when layer not found', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });

    const req = createTestRequest('/api/layers/nonexistent', {
      method: 'DELETE',
    });
    const res = await deleteLayer(req, {
      params: createTestParams({ id: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/layers/reorder
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/layers/reorder', () => {
  it('returns 401 for unauthenticated users', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/layers/reorder', {
      method: 'PUT',
      body: {
        layers: [
          { id: 'a0000000-0000-4000-8000-000000000001', display_order: 20 },
        ],
      },
    });
    const res = await reorderLayers(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/layers/reorder', {
      method: 'PUT',
      body: {
        layers: [
          { id: 'a0000000-0000-4000-8000-000000000001', display_order: 20 },
        ],
      },
    });
    const res = await reorderLayers(req);
    expect(res.status).toBe(403);
  });

  it('reorders layers successfully', async () => {
    configureRole(mockSupabase, 'admin');
    // Mock two update operations
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/layers/reorder', {
      method: 'PUT',
      body: {
        layers: [
          { id: 'a0000000-0000-4000-8000-000000000001', display_order: 20 },
          { id: 'a0000000-0000-4000-8000-000000000002', display_order: 10 },
        ],
      },
    });
    const res = await reorderLayers(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 400 for invalid body', async () => {
    configureRole(mockSupabase, 'admin');
    const req = createTestRequest('/api/layers/reorder', {
      method: 'PUT',
      body: { layers: 'not-an-array' },
    });
    const res = await reorderLayers(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty layers array', async () => {
    configureRole(mockSupabase, 'admin');
    const req = createTestRequest('/api/layers/reorder', {
      method: 'PUT',
      body: { layers: [] },
    });
    const res = await reorderLayers(req);
    expect(res.status).toBe(400);
  });
});
