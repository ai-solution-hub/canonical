import Anthropic from '@anthropic-ai/sdk';
import { COST_PER_MILLION } from '@/lib/ai/pricing';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function getAIModel(): string {
  return process.env.AI_SUMMARY_MODEL || 'claude-sonnet-4-6';
}

// ──────────────────────────────────────────
// Multi-model orchestration for bid drafting
// ──────────────────────────────────────────

export type ModelTier = 'analysis' | 'drafting' | 'quality';

const MODEL_MAP: Record<ModelTier, string> = {
  analysis: 'claude-sonnet-4-5', // Fast, cheap — question analysis + search queries
  drafting: 'claude-opus-4-6', // High quality — response drafting with citations
  quality: 'claude-haiku-4-5', // Cheap — quality checks
};

/**
 * Get the model ID for a given tier. Supports env var overrides:
 * AI_ANALYSIS_MODEL, AI_DRAFTING_MODEL, AI_QUALITY_MODEL
 */
export function getModelForTier(tier: ModelTier): string {
  return process.env[`AI_${tier.toUpperCase()}_MODEL`] ?? MODEL_MAP[tier];
}

// ──────────────────────────────────────────
// Cost estimation
// ──────────────────────────────────────────

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Estimate cost in USD from model name and token usage */
export function estimateCost(model: string, usage: TokenUsage): number {
  const rates =
    COST_PER_MILLION[model] ?? COST_PER_MILLION['claude-sonnet-4-5'];
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const inputTokens = usage.input_tokens - cacheReadTokens - cacheWriteTokens;

  return (
    (inputTokens / 1_000_000) * rates.input +
    (usage.output_tokens / 1_000_000) * rates.output +
    (cacheReadTokens / 1_000_000) * rates.cache_read +
    (cacheWriteTokens / 1_000_000) * rates.cache_write
  );
}
