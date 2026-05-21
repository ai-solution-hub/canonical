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

// Mock the AI change report service
const mockGenerateChangeReport = vi.fn();
vi.mock('@/lib/ai/change-reports', () => ({
  generateChangeReport: (...args: unknown[]) => mockGenerateChangeReport(...args),
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

import { POST } from '@/app/api/change-reports/generate/route';
// Import AIServiceError for constructing test errors
import { AIServiceError } from '@/lib/ai/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

const MOCK_DIGEST = {
  digest: {
    id: VALID_UUID,
    digest_type: 'weekly',
    period_start: '2026-03-01T00:00:00.000Z',
    period_end: '2026-03-07T23:59:59.999Z',
    item_count: 5,
    domain_summaries: [
      {
        domain: 'Technology',
        item_count: 3,
        summary: 'A busy week for technology content.',
        top_items: [],
        key_themes: ['AI', 'Security'],
      },
    ],
    theme_clusters: [
      {
        theme: 'AI Adoption',
        description: 'Multiple items on AI',
        item_count: 3,
      },
    ],
    narrative_summary: 'You captured 5 items this week.',
    generated_at: '2026-03-07T12:00:00.000Z',
    generated_by: 'claude-sonnet-4-6',
    tokens_used: 1500,
    filters: null,
    governance_summary: null,
    created_at: '2026-03-07T12:00:00.000Z',
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
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 2 });

  // Default: generateDigest returns a valid digest
  mockGenerateChangeReport.mockResolvedValue(MOCK_DIGEST);
}

// ---------------------------------------------------------------------------
// POST /api/change-reports/generate
// ---------------------------------------------------------------------------

describe('POST /api/change-reports/generate', () => {
  beforeEach(resetMocks);

  // ── Auth & Role ──────────────────────────────────────────────────────────

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 7 },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 7 },
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  // ── Rate Limiting ────────────────────────────────────────────────────────

  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 7 },
    });

    const res = await POST(req);
    expect(res.status).toBe(429);

    const json = await res.json();
    expect(json.error).toContain('Rate limit');
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 for invalid period_days (too large)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 999 },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'period_days' }),
      ]),
    );
  });

  it('returns 400 for invalid digest_type', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 7, digest_type: 'monthly' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'digest_type' }),
      ]),
    );
  });

  // ── Success Path ─────────────────────────────────────────────────────────

  it('returns 200 with digest on success (weekly)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 7, digest_type: 'weekly' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.digest).toBeDefined();
    expect(json.digest.digest_type).toBe('weekly');
    expect(json.digest.narrative_summary).toBeTruthy();

    // Verify generateDigest was called with correct params
    expect(mockGenerateChangeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        periodDays: 7,
        digestType: 'weekly',
        userId: 'test-user-id',
      }),
    );
  });

  it('returns 200 with digest on success (daily)', async () => {
    configureRole(mockSupabase, 'admin');

    const dailyDigest = {
      ...MOCK_DIGEST,
      digest: { ...MOCK_DIGEST.digest, digest_type: 'daily' },
    };
    mockGenerateChangeReport.mockResolvedValue(dailyDigest);

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { digest_type: 'daily' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.digest.digest_type).toBe('daily');

    expect(mockGenerateChangeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        digestType: 'daily',
      }),
    );
  });

  it('honours optional digest filters when generating a digest', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: {
        period_days: 14,
        digest_type: 'custom',
        domain: 'Technology',
        keywords: ['AI', 'security'],
        date_from: '2026-03-01T00:00:00.000Z',
        date_to: '2026-03-14T23:59:59.999Z',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockGenerateChangeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        periodDays: 14,
        digestType: 'custom',
        filterDomain: 'Technology',
        filterKeywords: ['AI', 'security'],
        dateFrom: '2026-03-01T00:00:00.000Z',
        dateTo: '2026-03-14T23:59:59.999Z',
        userId: 'test-user-id',
      }),
    );
  });

  // ── Error Handling ───────────────────────────────────────────────────────

  it('returns AIServiceError status when AI service throws domain error', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateChangeReport.mockRejectedValue(
      new AIServiceError(
        'No content items found for the selected filters and period',
        400,
      ),
    );

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 7 },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe(
      'No content items found for the selected filters and period',
    );
  });

  it('returns 413 when content is too long for digest', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateChangeReport.mockRejectedValue(
      new AIServiceError(
        'Content too long for digest generation — response was truncated',
        413,
      ),
    );

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 30 },
    });

    const res = await POST(req);
    expect(res.status).toBe(413);

    const json = await res.json();
    expect(json.error).toContain('truncated');
  });

  it('returns 500 on unexpected error', async () => {
    configureRole(mockSupabase, 'editor');
    mockGenerateChangeReport.mockRejectedValue(
      new Error('Unexpected network failure'),
    );

    const req = createTestRequest('/api/change-reports/generate', {
      method: 'POST',
      body: { period_days: 7 },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to generate digest');
  });
});
