/**
 * POST /api/items — ai_keywords normalisation at write boundary.
 *
 * Verifies that ai_keywords submitted via the web form are normalised
 * (lowercased, plural-stripped, deduped) before INSERT into content_items.
 * Spec: docs/specs/p0-tag-canonicalisation-classify-time-spec.md ss10.6 EP3.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

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

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  };
});

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: vi.fn((text: string) => text),
}));

vi.mock('@/lib/dedup/content-dedup', () => ({
  checkForDuplicates: vi.fn().mockResolvedValue({
    has_duplicates: false,
    matches: [],
  }),
  formatDedupWarning: vi.fn(),
  resolveDedupStamp: vi.fn().mockReturnValue({ dedup_status: 'clean' }),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn().mockReturnValue({
    suggestedLayer: 'reference',
    reason: 'test',
    confidence: 'high',
  }),
}));

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/guide-section-mapping', () => ({
  suggestGuideSections: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: vi.fn().mockReturnValue(50),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}));

// Import route AFTER mocks are registered
import { POST } from '@/app/api/items/route';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const VALID_ITEM_BODY = {
  title: 'Test Item',
  content: 'Test content body.',
  content_type: 'article',
  auto_classify: false,
  auto_summarise: false,
  auto_embed: false,
};

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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/items — ai_keywords normalisation (EP3)', () => {
  it('normalises ai_keywords before INSERT', async () => {
    // Configure: role lookup returns admin
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    // INSERT returns the new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'Test Item',
        content_type: 'article',
        created_at: '2026-04-23T00:00:00Z',
      },
      error: null,
    });

    const request = createTestRequest('/api/items', {
      method: 'POST',
      body: {
        ...VALID_ITEM_BODY,
        ai_keywords: ['Audits', 'GDPR'],
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    // Verify the INSERT call received normalised keywords
    const insertCall = mockSupabase._chain.insert.mock.calls[0]?.[0];
    expect(insertCall).toBeDefined();
    // "Audits" -> "audit" (lowercase + plural stripped)
    // "GDPR" -> "GDPR" (proper noun preserved)
    expect(insertCall.ai_keywords).toEqual(['audit', 'GDPR']);
  });

  it('deduplicates ai_keywords after normalisation', async () => {
    // Configure: role lookup returns admin
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });
    // INSERT returns the new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'Test Item',
        content_type: 'article',
        created_at: '2026-04-23T00:00:00Z',
      },
      error: null,
    });

    const request = createTestRequest('/api/items', {
      method: 'POST',
      body: {
        ...VALID_ITEM_BODY,
        ai_keywords: ['Audits', 'audit', 'audits'],
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const insertCall = mockSupabase._chain.insert.mock.calls[0]?.[0];
    expect(insertCall).toBeDefined();
    // All three collapse to "audit"; dedup leaves one
    expect(insertCall.ai_keywords).toEqual(['audit']);
  });
});
