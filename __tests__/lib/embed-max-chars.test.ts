/**
 * Regression test for S159 WP4b — MAX_EMBEDDING_CHARS constant +
 * truncation call-site verification.
 *
 * Background: S158 WP2 ESM backfill found two items with high
 * classification confidence but `embedding IS NULL`. Root cause:
 * OpenAI `text-embedding-3-large` caps input at 8,192 tokens, the
 * affected items were 138k and 55k chars, the SDK threw a 400
 * BadRequestError, and `classifyContent`'s embedding path swallowed
 * the error via `console.error`.
 *
 * Fix: `lib/ai/embed.ts` now exports `MAX_EMBEDDING_CHARS` (~6k
 * tokens worth of budget) and `classify.ts` truncates the embedding
 * input to that length before calling `generateEmbedding`, emitting
 * a `classify.embedding.input_truncated` best-effort warning when
 * truncation fires. The `console.error` swallow was replaced with
 * `logBestEffortWarn('classify.embedding.generation_failed', ...)`.
 *
 * S161 follow-up: Added call-site integration tests per S159 WP4b
 * adversarial verification §1 — previous tests only verified the
 * constant value, not the truncation logic or warning emission.
 *
 * Source:
 *   docs/specs/esm-embedding-silent-failure-spec.md
 *   docs/audits/si-classification-verification-s156.md § Run 2
 *   docs/audits/s159-wp4a-wp4b-adversarial-verification.md
 *   docs/reference/post-mvp-roadmap.md §2.1.12
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_EMBEDDING_CHARS } from '@/lib/ai/embed';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';

// ──────────────────────────────────────────
// Mock dependencies (same pattern as ai-classify-entities.test.ts)
// ──────────────────────────────────────────

const mockCreate = vi.fn();
const mockGenerateEmbedding = vi.fn();
const mockLogBestEffortWarn = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  getAIModel: () => 'claude-sonnet-4-6',
  estimateCost: () => 0.031,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  };
});

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: (...args: unknown[]) => mockLogBestEffortWarn(...args),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: (text: string) => text,
}));

vi.mock('@/lib/ai/skills/loader', () => ({
  loadSkill: vi.fn().mockResolvedValue(
    'Classify content.\n\n{TAXONOMY}\n\n{CLIENT_DISAMBIGUATION}\n\nPrefer "{CLIENT_ORGANISATION_NAME}" not "{CLIENT_ORGANISATION_SHORT}", "{CLIENT_PRODUCT_NAME}" not "{CLIENT_PRODUCT_SHORT}".',
  ),
}));

vi.mock('@/lib/entities/entity-aliases', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/entities/entity-aliases')>();
  return {
    ...actual,
    loadAliases: vi.fn().mockResolvedValue({}),
  };
});

// Import after mocks
import { classifyContent } from '@/lib/ai/classify';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function createToolUseResponse(input: Record<string, unknown>) {
  return {
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    container: null,
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_test',
        name: 'return_classification',
        input,
        caller: { type: 'direct' as const },
      },
    ],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

const baseClassificationInput = {
  primary_domain: 'SECURITY & COMPLIANCE',
  primary_subtopic: 'Certifications',
  secondary_domain: null,
  secondary_subtopic: null,
  ai_keywords: ['ISO 27001'],
  summary: 'Summary.',
  suggested_title: 'Title',
  classification_confidence: 0.92,
  classification_reasoning: 'Content discusses security.',
};

const ITEM_ID = 'item-emb-001';
const USER_ID = 'user-emb-001';

// ──────────────────────────────────────────
// Tests
// ──────────────────────────────────────────

describe('S159 WP4b — MAX_EMBEDDING_CHARS constant', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_EMBEDDING_CHARS)).toBe(true);
    expect(MAX_EMBEDDING_CHARS).toBeGreaterThan(0);
  });

  it('stays safely below the 8,192-token OpenAI cap', () => {
    // 8,192 tokens × ~4 chars/token ≈ 32,768 chars — the hard cap.
    // We want headroom for tokenisation variance on non-English and
    // unusual whitespace, so the constant should be meaningfully below.
    expect(MAX_EMBEDDING_CHARS).toBeLessThan(32_768);
  });

  it('is large enough to carry the dominant semantic signal', () => {
    // ~6k tokens worth of content is considered the minimum practical
    // budget per the spec. Anything below 20k chars would be too
    // aggressive a truncation.
    expect(MAX_EMBEDDING_CHARS).toBeGreaterThanOrEqual(20_000);
  });

  it('provides headroom for non-English tokenisation (~3 chars/token)', () => {
    // At ~3 chars/token the budget should stay under 8,192 tokens.
    const worstCaseTokens = MAX_EMBEDDING_CHARS / 3;
    expect(worstCaseTokens).toBeLessThan(8_192);
  });
});

describe('S159 WP4b — embedding truncation call-site integration', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();

    mockSupabase._chain.single.mockResolvedValue({
      data: {
        id: ITEM_ID,
        title: 'Long Content Item',
        content: '<p>' + 'x'.repeat(200_000) + '</p>',
        content_type: 'article',
        classified_at: null,
        primary_domain: null,
        primary_subtopic: null,
        secondary_domain: null,
        secondary_subtopic: null,
        ai_keywords: null,
        summary: null,
        suggested_title: null,
        classification_confidence: null,
        classification_reasoning: null,
      },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    mockSupabase._chain.eq.mockReturnValue({
      ...mockSupabase._chain,
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
      ),
    });

    mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));
  });

  it('truncates embedding input to MAX_EMBEDDING_CHARS for long content', async () => {
    mockCreate.mockResolvedValueOnce(
      createToolUseResponse(baseClassificationInput),
    );

    await classifyContent({
      supabase: mockSupabase as never,
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    // generateEmbedding should have been called with truncated text
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    const embeddingInput = mockGenerateEmbedding.mock.calls[0][0] as string;
    expect(embeddingInput.length).toBeLessThanOrEqual(MAX_EMBEDDING_CHARS);
  });

  it('emits classify.embedding.input_truncated warning when truncation fires', async () => {
    mockCreate.mockResolvedValueOnce(
      createToolUseResponse(baseClassificationInput),
    );

    await classifyContent({
      supabase: mockSupabase as never,
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    expect(mockLogBestEffortWarn).toHaveBeenCalledWith(
      'classify.embedding.input_truncated',
      expect.stringContaining('truncated'),
      expect.objectContaining({
        itemId: ITEM_ID,
        truncatedLength: MAX_EMBEDDING_CHARS,
      }),
    );
  });

  it('emits classify.embedding.generation_failed when generateEmbedding throws', async () => {
    mockGenerateEmbedding.mockRejectedValueOnce(
      new Error('400 BadRequestError: maximum context length'),
    );

    mockCreate.mockResolvedValueOnce(
      createToolUseResponse(baseClassificationInput),
    );

    // Classification should still succeed — embedding failure is non-blocking
    const result = await classifyContent({
      supabase: mockSupabase as never,
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    expect(result.primary_domain).toBe('SECURITY & COMPLIANCE');

    expect(mockLogBestEffortWarn).toHaveBeenCalledWith(
      'classify.embedding.generation_failed',
      expect.stringContaining('failed'),
      expect.objectContaining({
        itemId: ITEM_ID,
        err: expect.any(Error),
      }),
    );
  });

  it('does not truncate or emit warning for short content', async () => {
    // Override with short content
    mockSupabase._chain.single.mockResolvedValue({
      data: {
        id: ITEM_ID,
        title: 'Short Item',
        content: '<p>Brief content.</p>',
        content_type: 'article',
        classified_at: null,
        primary_domain: null,
        primary_subtopic: null,
        secondary_domain: null,
        secondary_subtopic: null,
        ai_keywords: null,
        summary: null,
        suggested_title: null,
        classification_confidence: null,
        classification_reasoning: null,
      },
      error: null,
    });

    mockCreate.mockResolvedValueOnce(
      createToolUseResponse(baseClassificationInput),
    );

    await classifyContent({
      supabase: mockSupabase as never,
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    // Should NOT emit truncation warning
    expect(mockLogBestEffortWarn).not.toHaveBeenCalledWith(
      'classify.embedding.input_truncated',
      expect.anything(),
      expect.anything(),
    );

    // generateEmbedding should receive the full text (title + content)
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    const embeddingInput = mockGenerateEmbedding.mock.calls[0][0] as string;
    expect(embeddingInput).toContain('Brief content.');
  });
});
