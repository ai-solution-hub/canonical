/**
 * Shared Anthropic model pricing constants (USD per million tokens).
 *
 * Canonical source for all cost calculations. Updated March 2026.
 * cache_write = 1.25x input price per Anthropic pricing.
 *
 * Imported by:
 * - lib/anthropic.ts (actual API cost estimation)
 * - lib/cost-estimation.ts (batch cost forecasting)
 */

export interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export const COST_PER_MILLION: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    input: 15,
    output: 75,
    cache_read: 1.5,
    cache_write: 18.75,
  },
  'claude-sonnet-4-5': {
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write: 3.75,
  },
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write: 3.75,
  },
  'claude-haiku-4-5': {
    input: 0.8,
    output: 4,
    cache_read: 0.08,
    cache_write: 1.0,
  },
};
