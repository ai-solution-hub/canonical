/**
 * Cost estimation for batch bid response drafting.
 *
 * Estimates token usage and cost (USD) for the three-pass drafting pipeline:
 * - Pass 1 (Sonnet): Question analysis
 * - Pass 2 (Opus):   Response drafting with citations
 * - Pass 3 (Haiku):  Quality check
 *
 * Provides min (80% cache hit) and max (no caching) cost estimates.
 */

// Re-use the canonical pricing from lib/anthropic.ts
// Duplicated here as plain constants to keep this module free of Anthropic SDK imports
// and usable in both server and test contexts.
const COST_PER_MILLION: Record<string, { input: number; output: number; cache_read: number }> = {
  'claude-opus-4-6':   { input: 15, output: 75, cache_read: 1.5 },
  'claude-sonnet-4-5': { input: 3,  output: 15, cache_read: 0.3 },
  'claude-haiku-4-5':  { input: 0.8, output: 4, cache_read: 0.08 },
};

// Model assignments per pipeline pass (mirrors lib/anthropic.ts MODEL_MAP)
const PASS_MODELS = {
  analysis: 'claude-sonnet-4-5',
  drafting: 'claude-opus-4-6',
  quality:  'claude-haiku-4-5',
} as const;

// Approximate system prompt token overhead per pass
const SYSTEM_PROMPT_TOKENS = 300;

// Estimated output tokens per pass
const ANALYSIS_OUTPUT_TOKENS = 500;
const DRAFTING_OUTPUT_TOKENS = 2000;
const QUALITY_OUTPUT_TOKENS = 200;

// ──────────────────────────────────────────
// Token estimation
// ──────────────────────────────────────────

/**
 * Rough token estimate from text length.
 * English text averages ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ──────────────────────────────────────────
// Per-question cost estimation
// ──────────────────────────────────────────

export interface QuestionCostEstimate {
  inputTokens: number;
  outputTokens: number;
  costMin: number;
  costMax: number;
}

/**
 * Estimate cost for drafting a single question through the three-pass pipeline.
 *
 * @param questionTokens - Estimated tokens for the question text
 * @param contentTokens  - Estimated tokens for all matched KB content
 * @returns Token counts and cost range (USD)
 *
 * Cost model:
 * - Pass 1 (analysis, Sonnet): system + question + 10% of content (summaries only)
 * - Pass 2 (drafting, Opus):   system + question + full content, ~2000 output
 * - Pass 3 (quality, Haiku):   system + 2000 (response) + question, ~200 output
 *
 * costMin assumes 80% prompt cache hit rate on input tokens.
 * costMax assumes no caching (worst case).
 */
export function estimateQuestionCost(
  questionTokens: number,
  contentTokens: number,
): QuestionCostEstimate {
  // Pass 1: Analysis (Sonnet)
  const pass1Input = SYSTEM_PROMPT_TOKENS + questionTokens + Math.ceil(contentTokens * 0.1);
  const pass1Output = ANALYSIS_OUTPUT_TOKENS;

  // Pass 2: Drafting (Opus)
  const pass2Input = SYSTEM_PROMPT_TOKENS + questionTokens + contentTokens;
  const pass2Output = DRAFTING_OUTPUT_TOKENS;

  // Pass 3: Quality check (Haiku)
  const pass3Input = SYSTEM_PROMPT_TOKENS + DRAFTING_OUTPUT_TOKENS + questionTokens;
  const pass3Output = QUALITY_OUTPUT_TOKENS;

  const totalInput = pass1Input + pass2Input + pass3Input;
  const totalOutput = pass1Output + pass2Output + pass3Output;

  // Max cost: no caching at all
  const costMax = calculatePassCost(pass1Input, pass1Output, PASS_MODELS.analysis, 0)
    + calculatePassCost(pass2Input, pass2Output, PASS_MODELS.drafting, 0)
    + calculatePassCost(pass3Input, pass3Output, PASS_MODELS.quality, 0);

  // Min cost: 80% of input tokens served from cache
  const cacheHitRate = 0.8;
  const costMin = calculatePassCost(pass1Input, pass1Output, PASS_MODELS.analysis, cacheHitRate)
    + calculatePassCost(pass2Input, pass2Output, PASS_MODELS.drafting, cacheHitRate)
    + calculatePassCost(pass3Input, pass3Output, PASS_MODELS.quality, cacheHitRate);

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costMin,
    costMax,
  };
}

// ──────────────────────────────────────────
// Batch estimation
// ──────────────────────────────────────────

export interface QuestionBreakdown {
  questionId: string;
  questionText: string;
  contentItemCount: number;
  estimatedTokens: number;
  costMin: number;
  costMax: number;
}

export interface BatchCostEstimate {
  totalQuestions: number;
  eligibleQuestions: number;
  estimatedCostMin: number;
  estimatedCostMax: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  breakdown: QuestionBreakdown[];
}

/**
 * Estimate cost for a batch of questions.
 */
export function estimateBatchCost(
  questions: Array<{
    id: string;
    questionText: string;
    contentTokens: number;
    contentItemCount: number;
  }>,
): BatchCostEstimate {
  let totalCostMin = 0;
  let totalCostMax = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const breakdown: QuestionBreakdown[] = [];

  for (const q of questions) {
    const questionTokens = estimateTokens(q.questionText);
    const estimate = estimateQuestionCost(questionTokens, q.contentTokens);

    totalCostMin += estimate.costMin;
    totalCostMax += estimate.costMax;
    totalInputTokens += estimate.inputTokens;
    totalOutputTokens += estimate.outputTokens;

    breakdown.push({
      questionId: q.id,
      questionText: q.questionText.slice(0, 100) + (q.questionText.length > 100 ? '...' : ''),
      contentItemCount: q.contentItemCount,
      estimatedTokens: estimate.inputTokens + estimate.outputTokens,
      costMin: estimate.costMin,
      costMax: estimate.costMax,
    });
  }

  return {
    totalQuestions: questions.length,
    eligibleQuestions: questions.length,
    estimatedCostMin: totalCostMin,
    estimatedCostMax: totalCostMax,
    estimatedInputTokens: totalInputTokens,
    estimatedOutputTokens: totalOutputTokens,
    breakdown,
  };
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

/**
 * Calculate cost for a single pass given input/output tokens and cache hit rate.
 */
function calculatePassCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
  cacheHitRate: number,
): number {
  const rates = COST_PER_MILLION[model];
  if (!rates) return 0;

  const cachedInput = Math.floor(inputTokens * cacheHitRate);
  const uncachedInput = inputTokens - cachedInput;

  return (
    (uncachedInput / 1_000_000) * rates.input +
    (cachedInput / 1_000_000) * rates.cache_read +
    (outputTokens / 1_000_000) * rates.output
  );
}

/**
 * Format a USD cost for display. Uses $ (USD) since Anthropic pricing is in USD.
 */
export function formatCostUSD(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}
