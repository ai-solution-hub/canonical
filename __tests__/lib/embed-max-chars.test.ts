/**
 * Regression test for S159 WP4b — MAX_EMBEDDING_CHARS constant.
 *
 * Background: S158 WP2 ESM backfill found two items with high
 * classification confidence but `embedding IS NULL`. Root cause:
 * OpenAI `text-embedding-3-large` caps input at 8,192 tokens, the
 * affected items were 138k and 55k chars, the SDK threw a 400
 * BadRequestError, and `classifyContent`'s embedding path swallowed
 * the error via `console.error`.
 *
 * Fix: `lib/ai/embed.ts` now exports `MAX_EMBEDDING_CHARS` (~7k
 * tokens worth of budget) and `classify.ts` truncates the embedding
 * input to that length before calling `generateEmbedding`, emitting
 * a `classify.embedding.input_truncated` best-effort warning when
 * truncation fires. The `console.error` swallow was replaced with
 * `logBestEffortWarn('classify.embedding.generation_failed', ...)`.
 *
 * Source:
 *   docs/specs/esm-embedding-silent-failure-spec.md
 *   docs/audits/si-classification-verification-s156.md § Run 2
 *   docs/reference/post-mvp-roadmap.md §2.1.12
 */

import { describe, it, expect } from 'vitest';
import { MAX_EMBEDDING_CHARS } from '@/lib/ai/embed';

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
    // ~7k tokens worth of content is considered the minimum practical
    // budget per the spec. Anything below 20k chars would be too
    // aggressive a truncation.
    expect(MAX_EMBEDDING_CHARS).toBeGreaterThanOrEqual(20_000);
  });
});
