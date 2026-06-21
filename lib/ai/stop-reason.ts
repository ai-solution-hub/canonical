/**
 * Stop-reason surfacing for structured AI touchpoints (B-INV-36 / ID-71.18).
 *
 * The Claude API returns `stop_reason: 'refusal'` (a streaming/safety classifier
 * declined the request — HTTP 200 with empty or partial content) and
 * `stop_reason: 'max_tokens'` (the response was truncated at the token cap). At a
 * structured touchpoint, neither is a successful result: the structured output
 * is missing or incomplete. These MUST be surfaced to the caller — logged and
 * thrown — never swallowed by a bare try/catch that returns a default. Silently
 * substituting a default hides a model refusal or truncation behind plausible
 * output, which is the silent-failure anti-pattern this guard removes.
 *
 * `stop_details` is only populated on a refusal (per the Claude API); it carries
 * the policy `category` and a human-readable `explanation`. We attach the
 * category to the thrown error so the caller can react without re-parsing.
 */

import { logger } from '@/lib/logger';
import { AIServiceError } from '@/lib/ai/errors';

/** Minimal response shape this guard inspects (a superset of the SDK Message). */
interface StopReasonBearing {
  stop_reason?: string | null;
  stop_details?: {
    type?: string;
    category?: string | null;
    explanation?: string | null;
  } | null;
}

/**
 * Surface a refusal or max-tokens stop reason as an {@link AIServiceError}.
 *
 * - `refusal`   → 502, code `AI_REFUSAL`, `data.category` / `data.explanation`.
 * - `max_tokens`→ 413, code `AI_MAX_TOKENS`.
 *
 * Any other (or absent) stop reason is a no-op — `end_turn`, `tool_use`,
 * `stop_sequence`, `pause_turn`, and the null stop_reason of a streamed
 * `message_start` are all valid non-terminal states for a structured call.
 *
 * @param response  The Claude API message (or any object carrying `stop_reason`).
 * @param touchpoint  The touchpoint id for log context (e.g. `summarise.callSummaryAI`).
 * @throws AIServiceError when the model refused or the response was truncated.
 */
export function assertSuccessfulStop(
  response: StopReasonBearing,
  touchpoint: string,
): void {
  const stopReason = response.stop_reason;

  if (stopReason === 'refusal') {
    const category = response.stop_details?.category ?? null;
    const explanation = response.stop_details?.explanation ?? null;
    logger.error(
      {
        op: 'ai.stop_reason.refusal',
        touchpoint,
        category,
        explanation,
      },
      `AI touchpoint ${touchpoint} was refused by the model (category: ${category ?? 'unspecified'})`,
    );
    throw new AIServiceError(
      'The AI model declined to complete this request. Please rephrase or try again.',
      502,
      {
        code: 'AI_REFUSAL',
        data: {
          touchpoint,
          ...(category !== null ? { category } : {}),
          ...(explanation !== null ? { explanation } : {}),
        },
      },
    );
  }

  if (stopReason === 'max_tokens') {
    logger.error(
      { op: 'ai.stop_reason.max_tokens', touchpoint },
      `AI touchpoint ${touchpoint} hit the output token limit — response was truncated`,
    );
    throw new AIServiceError(
      'The AI response was truncated before completing. Try a shorter input or a simpler request.',
      413,
      { code: 'AI_MAX_TOKENS', data: { touchpoint } },
    );
  }
}
