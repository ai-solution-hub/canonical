import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const {
  mockCookies,
  mockGenerateEmbedding,
  mockGenerateSingleFieldChangeSummary,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockGenerateSingleFieldChangeSummary: vi
    .fn()
    .mockReturnValue('field updated'),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/ai/embed', () => ({
  MAX_EMBEDDING_CHARS: 24_000,
  getEmbeddingModel: vi.fn(() => 'text-embedding-3-large'),
  getEmbeddingDimensions: vi.fn(() => 1024),

  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@/lib/change-summary', () => ({
  generateSingleFieldChangeSummary: mockGenerateSingleFieldChangeSummary,
}));

// Import route AFTER mocks
const { PATCH } = await import('@/app/api/items/[id]/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

function setupSuccessfulPatch() {
  // Role lookup
  configureRole(mockSupabase, 'admin');
  // Fetch current item (for version history)
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      title: 'Test Item',
      content: '<p>Test</p>',
      brief: null,
      detail: null,
      reference: null,
      suggested_title: 'Test Item',
      ai_keywords: [],
      primary_domain: 'Standards & Regulations',
      primary_subtopic: 'iso_standards',
      secondary_domain: null,
      secondary_subtopic: null,
      priority: 'medium',
      summary: null,
      content_type: 'article',
      platform: 'gov_uk',
      author_name: null,
      user_tags: [],
      answer_standard: null,
      answer_advanced: null,
      governance_review_status: null,
      expiry_date: null,
      lifecycle_type: null,
    },
    error: null,
  });
}

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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — expiry_date field', () => {
  it('accepts a valid ISO date for expiry_date', async () => {
    setupSuccessfulPatch();

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'expiry_date', value: '2027-06-15' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('accepts null for expiry_date (clearing)', async () => {
    setupSuccessfulPatch();

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'expiry_date', value: null },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('rejects an invalid date format for expiry_date', async () => {
    setupSuccessfulPatch();

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'expiry_date', value: '15/06/2027' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('expiry_date');
  });
});

describe('PATCH /api/items/[id] — lifecycle_type field', () => {
  it('accepts valid lifecycle_type values', async () => {
    setupSuccessfulPatch();

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'lifecycle_type', value: 'date_bound' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('rejects invalid lifecycle_type values', async () => {
    setupSuccessfulPatch();

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'lifecycle_type', value: 'invalid_type' },
    });
    const params = createTestParams({ id: VALID_UUID });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('lifecycle_type must be one of');
  });
});
