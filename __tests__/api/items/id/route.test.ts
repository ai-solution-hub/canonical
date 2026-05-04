/**
 * PATCH /api/items/[id] — ai_keywords normalisation at write boundary.
 *
 * Verifies that ai_keywords submitted via the web form PATCH are normalised
 * (lowercased, plural-stripped, deduped) before UPDATE on content_items.
 * Spec: docs/specs/p0-tag-canonicalisation-classify-time-spec.md ss10.6 EP4.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockGenerateSingleFieldChangeSummary } = vi.hoisted(
  () => ({
    mockCookies: vi.fn(),
    mockGenerateSingleFieldChangeSummary: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/change-summary', () => ({
  generateSingleFieldChangeSummary: mockGenerateSingleFieldChangeSummary,
}));

vi.mock('@/lib/ai/embed', () => ({
  MAX_EMBEDDING_CHARS: 24_000,
  getEmbeddingModel: vi.fn(() => 'text-embedding-3-large'),
  getEmbeddingDimensions: vi.fn(() => 1024),

  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: vi.fn((text: string) => text),
}));

vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: vi.fn().mockResolvedValue({ errors: [] }),
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: vi.fn().mockReturnValue(50),
}));

// Import route AFTER mocks are registered
import { PATCH } from '@/app/api/items/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function defaultCurrentItem(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Item',
    content: 'Some test content.',
    brief: null,
    detail: null,
    reference: null,
    suggested_title: 'Test Item',
    ai_keywords: ['old-tag'],
    primary_domain: null,
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    priority: null,
    summary: null,
    content_type: 'article',
    platform: 'manual',
    author_name: null,
    user_tags: null,
    answer_standard: null,
    answer_advanced: null,
    governance_review_status: null,
    expiry_date: null,
    lifecycle_type: null,
    classified_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
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

  mockGenerateSingleFieldChangeSummary.mockReturnValue('Field updated');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — ai_keywords normalisation (EP4)', () => {
  it('normalises ai_keywords value before UPDATE', async () => {
    // 1. Role lookup -> editor
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { role: 'editor' },
      error: null,
    });
    // 2. Fetch current item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: defaultCurrentItem(),
      error: null,
    });
    // 3. Update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: {
        field: 'ai_keywords',
        value: ['Systems', 'access'],
      },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });

    const json = await response.json();
    expect(json.success).toBe(true);

    // Verify the UPDATE call received normalised keywords
    const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0];
    expect(updateCall).toBeDefined();
    // "Systems" -> "system" (lowercase + plural stripped)
    // "access" -> "access" (ss guard preserves)
    expect(updateCall.ai_keywords).toEqual(['system', 'access']);
  });

  it('deduplicates ai_keywords after normalisation', async () => {
    // 1. Role lookup -> admin
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    // 2. Fetch current item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: defaultCurrentItem(),
      error: null,
    });
    // 3. Update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: {
        field: 'ai_keywords',
        value: ['Systems', 'system', 'GDPR', 'gdpr'],
      },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });

    const json = await response.json();
    expect(json.success).toBe(true);

    const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0];
    expect(updateCall).toBeDefined();
    // "Systems" and "system" both normalise to "system" — dedup keeps first
    // "GDPR" and "gdpr" both normalise to "GDPR" — dedup keeps first
    expect(updateCall.ai_keywords).toEqual(['system', 'GDPR']);
  });

  it('records normalised value (not raw) in change summary', async () => {
    // WP3 L-1 fix: generateSingleFieldChangeSummary must receive the
    // normalised effectiveValue, not the raw pre-normalisation value.
    // 1. Role lookup -> editor
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { role: 'editor' },
      error: null,
    });
    // 2. Fetch current item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: defaultCurrentItem({ ai_keywords: ['old-tag'] }),
      error: null,
    });
    // 3. Update succeeds
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: {
        field: 'ai_keywords',
        value: ['Systems', 'GDPR'],
      },
    });

    await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });

    // generateSingleFieldChangeSummary should have been called with normalised values
    expect(mockGenerateSingleFieldChangeSummary).toHaveBeenCalledWith(
      'ai_keywords',
      ['old-tag'],
      // Normalised: "Systems" -> "system", "GDPR" stays uppercase
      ['system', 'GDPR'],
    );
  });

  it('does not normalise non-ai_keywords fields (e.g. suggested_title)', async () => {
    // Real integration test: PATCH a suggested_title field and verify the stored
    // value is the raw string, not normalised via normaliseTag.
    // 1. Role lookup -> editor
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { role: 'editor' },
      error: null,
    });
    // 2. Fetch current item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: defaultCurrentItem(),
      error: null,
    });

    const request = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: {
        field: 'suggested_title',
        value: 'Updated Title With Capitals',
      },
    });

    const response = await PATCH(request, {
      params: createTestParams({ id: VALID_UUID }),
    });

    expect(response.status).toBe(200);

    const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0];
    expect(updateCall).toBeDefined();
    // suggested_title should be stored as-is, not normalised
    expect(updateCall.suggested_title).toBe('Updated Title With Capitals');
  });
});
