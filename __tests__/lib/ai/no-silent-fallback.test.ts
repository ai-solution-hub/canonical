/**
 * No-silent-fallback at structured touchpoints (B-INV-36 / ID-71.18).
 *
 * Each structured lib/ai touchpoint must SURFACE a `stop_reason: 'refusal'` or
 * `stop_reason: 'max_tokens'` (throw + log) rather than swallowing it behind a
 * default value. These tests drive the touchpoints with refusal / max_tokens
 * mocks and assert they throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: { create: mockCreate, stream: vi.fn() },
  })),
  getAIModel: vi.fn(() => 'claude-sonnet-4-6'),
  getModelForTier: vi.fn(() => 'claude-sonnet-4-6'),
  estimateCost: vi.fn(() => 0.001),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  generateSearchQueries,
  extractTenderMetadata,
} from '@/lib/domains/procurement/ai/extract-questions';
import { callSummaryAI } from '@/lib/ai/summarise';

const refusal = {
  stop_reason: 'refusal',
  stop_details: { type: 'refusal', category: 'cyber' },
  content: [],
  usage: { input_tokens: 5, output_tokens: 0 },
};

const maxTokens = {
  stop_reason: 'max_tokens',
  content: [],
  usage: { input_tokens: 5, output_tokens: 1024 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('B-INV-36 — refusal is surfaced, never swallowed', () => {
  it('generateSearchQueries throws on refusal', async () => {
    mockCreate.mockResolvedValueOnce(refusal);
    await expect(
      generateSearchQueries('Describe your security approach'),
    ).rejects.toThrow();
  });

  it('extractTenderMetadata throws on refusal (never silent null)', async () => {
    mockCreate.mockResolvedValueOnce(refusal);
    await expect(
      extractTenderMetadata('<p>Tender</p>', 'html'),
    ).rejects.toThrow();
  });

  it('callSummaryAI throws on refusal', async () => {
    mockCreate.mockResolvedValueOnce(refusal);
    await expect(
      callSummaryAI({
        content: 'Long enough content for a summary call.',
        title: 'Doc',
        contentType: 'article',
        domain: 'tech',
      }),
    ).rejects.toThrow();
  });
});

describe('B-INV-36 — max_tokens truncation is surfaced, never swallowed', () => {
  it('generateSearchQueries throws on max_tokens', async () => {
    mockCreate.mockResolvedValueOnce(maxTokens);
    await expect(
      generateSearchQueries('Describe your security approach'),
    ).rejects.toThrow();
  });

  it('callSummaryAI throws on max_tokens', async () => {
    mockCreate.mockResolvedValueOnce(maxTokens);
    await expect(
      callSummaryAI({
        content: 'Long enough content for a summary call.',
        title: 'Doc',
        contentType: 'article',
        domain: 'tech',
      }),
    ).rejects.toThrow();
  });
});
