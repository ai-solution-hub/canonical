/**
 * Digest cost guard tests (OPS-23).
 *
 * Tests the DIGEST_AUTO_GEN_MAX_ITEMS threshold pre-flight check in
 * `lib/ai/digest.ts`. When the number of content items in the period
 * exceeds the threshold, `generateDigest` should throw an AIServiceError
 * with status 413 and a structured JSON body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIServiceError } from '@/lib/ai/errors';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock external dependencies so we can test the function in isolation
vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn(),
  getAIModel: vi.fn(() => 'claude-sonnet-4-6'),
}));

vi.mock('@/lib/ai-parse', () => ({
  extractToolResult: vi.fn(),
}));

vi.mock('@/lib/content/content-suggestions', () => ({
  generateContentSuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/supabase/safe', () => ({
  tryQuery: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { generateDigest, DIGEST_AUTO_GEN_MAX_ITEMS } from '@/lib/ai/digest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    title: `Item ${i + 1}`,
    suggested_title: null,
    summary: 'A test summary',
    primary_domain: 'Test Domain',
    primary_subtopic: null,
    content_type: 'article',
    ai_keywords: ['test'],
    captured_date: '2026-04-20T12:00:00Z',
    summary_data: null,
  }));
}

function createMockSupabase(itemCount: number) {
  const items = makeMockItems(itemCount);
  const mockQuery = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    overlaps: vi.fn().mockReturnThis(),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  // The final call in the chain resolves with the items
  mockQuery.order = vi.fn().mockResolvedValue({
    data: items,
    error: null,
  });

  return mockQuery as unknown as Parameters<
    typeof generateDigest
  >[0]['supabase'];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Digest cost guard (OPS-23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports DIGEST_AUTO_GEN_MAX_ITEMS as 150', () => {
    expect(DIGEST_AUTO_GEN_MAX_ITEMS).toBe(150);
  });

  it('throws AIServiceError(413) when item count exceeds threshold', async () => {
    const supabase = createMockSupabase(200);

    await expect(
      generateDigest({
        supabase,
        periodDays: 7,
        digestType: 'weekly',
        userId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow(AIServiceError);

    try {
      await generateDigest({
        supabase,
        periodDays: 7,
        digestType: 'weekly',
        userId: '00000000-0000-4000-8000-000000000001',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AIServiceError);
      const aiErr = err as AIServiceError;
      expect(aiErr.status).toBe(413);

      // Parse the JSON message
      const body = JSON.parse(aiErr.message);
      expect(body.code).toBe('DIGEST_TOO_MANY_ITEMS');
      expect(body.item_count).toBe(200);
      expect(body.max).toBe(DIGEST_AUTO_GEN_MAX_ITEMS);
      expect(body.message).toContain('200 items');
    }
  });

  it('does not throw when item count is at the threshold', async () => {
    const supabase = createMockSupabase(DIGEST_AUTO_GEN_MAX_ITEMS);

    // This will fail later (missing Claude mock) but should NOT throw 413
    try {
      await generateDigest({
        supabase,
        periodDays: 7,
        digestType: 'weekly',
        userId: '00000000-0000-4000-8000-000000000001',
      });
    } catch (err) {
      // We expect an error — but it should NOT be the cost guard error
      if (err instanceof AIServiceError) {
        expect(err.status).not.toBe(413);
      }
      // Any other error (e.g. from unmocked Claude call) is acceptable
    }
  });

  it('does not throw when item count is below threshold', async () => {
    const supabase = createMockSupabase(50);

    try {
      await generateDigest({
        supabase,
        periodDays: 7,
        digestType: 'weekly',
        userId: '00000000-0000-4000-8000-000000000001',
      });
    } catch (err) {
      // Should NOT be the cost guard error
      if (err instanceof AIServiceError) {
        expect(err.status).not.toBe(413);
      }
    }
  });

  it('throws 400 when zero items found (existing behaviour preserved)', async () => {
    const supabase = createMockSupabase(0);

    await expect(
      generateDigest({
        supabase,
        periodDays: 7,
        digestType: 'weekly',
        userId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow(AIServiceError);

    try {
      await generateDigest({
        supabase,
        periodDays: 7,
        digestType: 'weekly',
        userId: '00000000-0000-4000-8000-000000000001',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AIServiceError);
      expect((err as AIServiceError).status).toBe(400);
    }
  });

  it('structured error includes actionable user guidance', async () => {
    const supabase = createMockSupabase(500);

    try {
      await generateDigest({
        supabase,
        periodDays: 7,
        digestType: 'weekly',
        userId: '00000000-0000-4000-8000-000000000001',
      });
    } catch (err) {
      const body = JSON.parse((err as AIServiceError).message);
      expect(body.message).toContain('Custom filter');
      expect(body.message).toContain('domain filter');
    }
  });
});
