/**
 * Stop-reason surfacing for structured AI touchpoints (B-INV-36 / ID-71.18).
 *
 * `stop_reason: 'refusal'` and `stop_reason: 'max_tokens'` must be surfaced to
 * the caller explicitly (logged + thrown), NEVER swallowed by a bare try/catch
 * returning a default. `assertSuccessfulStop` is the shared surfacer.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { assertSuccessfulStop } from '@/lib/ai/stop-reason';
import { AIServiceError } from '@/lib/ai/errors';
import { logger } from '@/lib/logger';

function response(
  stop_reason: string,
  stop_details?: {
    type: 'refusal';
    category: string | null;
    explanation?: string;
  },
) {
  return {
    stop_reason,
    stop_details: stop_details ?? null,
    content: [],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('assertSuccessfulStop (B-INV-36)', () => {
  it('surfaces a refusal as an AIServiceError and logs it', () => {
    expect(() =>
      assertSuccessfulStop(
        response('refusal', {
          type: 'refusal',
          category: 'cyber',
          explanation: 'declined',
        }),
        'draft.analyseQuestion',
      ),
    ).toThrow(AIServiceError);
    expect(logger.error).toHaveBeenCalled();
  });

  it('attaches the refusal category to the thrown error code', () => {
    try {
      assertSuccessfulStop(
        response('refusal', { type: 'refusal', category: 'bio' }),
        'summarise.callSummaryAI',
      );
      throw new Error('expected assertSuccessfulStop to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AIServiceError);
      const e = err as AIServiceError;
      expect(e.status).toBe(502);
      expect(e.code).toBe('AI_REFUSAL');
      expect(e.data?.category).toBe('bio');
    }
  });

  it('surfaces max_tokens truncation as a 413 AIServiceError', () => {
    try {
      assertSuccessfulStop(
        response('max_tokens'),
        'quality-check.runAIQualityCheck',
      );
      throw new Error('expected assertSuccessfulStop to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AIServiceError);
      const e = err as AIServiceError;
      expect(e.status).toBe(413);
      expect(e.code).toBe('AI_MAX_TOKENS');
    }
  });

  it('does NOT throw on a normal end_turn / tool_use stop reason', () => {
    expect(() =>
      assertSuccessfulStop(response('end_turn'), 'draft.analyseQuestion'),
    ).not.toThrow();
    expect(() =>
      assertSuccessfulStop(response('tool_use'), 'classify.classifyContent'),
    ).not.toThrow();
  });

  it('does NOT throw when stop_reason is absent (streamed/partial shape)', () => {
    expect(() =>
      assertSuccessfulStop({ stop_reason: undefined }, 'vision.analyseVision'),
    ).not.toThrow();
  });
});
