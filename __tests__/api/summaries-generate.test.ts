import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
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

// Mock the AI summarise service
const mockGenerateSummary = vi.fn();
vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: (...args: unknown[]) => mockGenerateSummary(...args),
}));

// Mock rate-limit — allow by default
const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handler under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/summaries/generate/route';
// Import AIServiceError for constructing test errors
import { AIServiceError } from '@/lib/ai/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

const MOCK_SUMMARY_RESULT = {
  summary_data: {
    executive: 'A concise executive summary of the content item.',
    detailed:
      'A detailed multi-paragraph summary covering the key points in depth.',
    takeaways: [
      'First key takeaway from the content',
      'Second key takeaway from the content',
      'Third key takeaway from the content',
    ],
    generated_at: '2026-03-07T12:00:00.000Z',
    model: 'claude-sonnet-4-6',
    tokens_used: 850,
  },
};

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Default: rate limit allows
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });

  // Default: generateSummary returns a valid result
  mockGenerateSummary.mockResolvedValue(MOCK_SUMMARY_RESULT);
}

// ---------------------------------------------------------------------------
// POST /api/summaries/generate
// ---------------------------------------------------------------------------

describe('POST /api/summaries/generate', () => {
  beforeEach(resetMocks);

  // ── Auth & Role ──────────────────────────────────────────────────────────

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  // ── Rate Limiting ────────────────────────────────────────────────────────

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(429);

    const json = await res.json();
    expect(json.error).toContain('Rate limit');
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 for missing item_id', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'item_id' })]),
    );
  });

  it('returns 400 for non-UUID item_id', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: 'not-a-uuid' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  // ── Success Path ─────────────────────────────────────────────────────────

  it('returns 200 with summary_data on success', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.summary_data).toBeDefined();
    expect(json.summary_data.executive).toBeTruthy();
    expect(json.summary_data.detailed).toBeTruthy();
    expect(json.summary_data.takeaways).toHaveLength(3);

    // Verify generateSummary was called with correct params
    expect(mockGenerateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: VALID_UUID,
        force: false,
        userId: 'test-user-id',
      }),
    );
  });

  it('passes force=true when specified in request body', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID, force: true },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockGenerateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: VALID_UUID,
        force: true,
        userId: 'test-user-id',
      }),
    );
  });

  // ── Error Handling ───────────────────────────────────────────────────────

  it('returns 404 when content item not found', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateSummary.mockRejectedValue(
      new AIServiceError('Content item not found', 404),
    );

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe('Content item not found');
  });

  it('returns 409 when summary already exists and force is not set', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateSummary.mockRejectedValue(
      new AIServiceError(
        'Summary already exists. Pass force=true to regenerate.',
        409,
      ),
    );

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain('Summary already exists');
  });

  it('returns 400 when content item has no content to summarise', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateSummary.mockRejectedValue(
      new AIServiceError('Content item has no content to summarise', 400),
    );

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Content item has no content to summarise');
  });

  it('returns 500 on unexpected error', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateSummary.mockRejectedValue(new Error('Unexpected API failure'));

    const req = createTestRequest('/api/summaries/generate', {
      method: 'POST',
      body: { item_id: VALID_UUID },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to generate summary');
  });
});
