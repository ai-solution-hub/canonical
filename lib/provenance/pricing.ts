/**
 * Cost estimation for AI classification and embedding operations.
 *
 * Pure functions that compute estimated USD cost from token counts and model
 * identifiers. Returns `null` for unknown models (never fabricates pricing)
 * and `0` for zero token inputs.
 *
 * Pricing constants sourced from Anthropic and OpenAI published rates as of
 * April 2026. Update when provider pricing changes.
 */

// ---------------------------------------------------------------------------
// Pricing tables (USD per token)
// ---------------------------------------------------------------------------

/** Per-token pricing for classification (chat) models. */
const CLASSIFICATION_PRICING: Record<
  string,
  {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  }
> = {
  // Anthropic Claude models
  'claude-opus-4-6': {
    input: 15 / 1_000_000,
    output: 75 / 1_000_000,
    cacheCreation: 18.75 / 1_000_000,
    cacheRead: 1.5 / 1_000_000,
  },
  'claude-sonnet-4-6': {
    input: 3 / 1_000_000,
    output: 15 / 1_000_000,
    cacheCreation: 3.75 / 1_000_000,
    cacheRead: 0.3 / 1_000_000,
  },
  'claude-haiku-3-5': {
    input: 0.8 / 1_000_000,
    output: 4 / 1_000_000,
    cacheCreation: 1 / 1_000_000,
    cacheRead: 0.08 / 1_000_000,
  },
};

/** Per-token pricing for embedding models. */
const EMBEDDING_PRICING: Record<string, { input: number }> = {
  'text-embedding-3-large': { input: 0.13 / 1_000_000 },
  'text-embedding-3-small': { input: 0.02 / 1_000_000 },
  'text-embedding-ada-002': { input: 0.1 / 1_000_000 },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimate the USD cost of a classification (chat) API call.
 *
 * @param tokensIn - Input tokens consumed
 * @param tokensOut - Output tokens generated
 * @param cacheCreation - Cache creation tokens (Anthropic prompt caching)
 * @param cacheRead - Cache read tokens (Anthropic prompt caching)
 * @param model - Model identifier string
 * @returns Estimated USD cost, or `null` if the model is not in the pricing table
 */
export function estimateClassifyCost(
  tokensIn: number,
  tokensOut: number,
  cacheCreation: number,
  cacheRead: number,
  model: string,
): number | null {
  const pricing = CLASSIFICATION_PRICING[model];
  if (!pricing) return null;

  // Zero tokens is a valid input (e.g. cached-only request) — return 0, not null
  if (tokensIn === 0 && tokensOut === 0 && cacheCreation === 0 && cacheRead === 0) {
    return 0;
  }

  return (
    tokensIn * pricing.input +
    tokensOut * pricing.output +
    cacheCreation * pricing.cacheCreation +
    cacheRead * pricing.cacheRead
  );
}

/**
 * Estimate the USD cost of an embedding API call.
 *
 * @param tokens - Total input tokens consumed
 * @param model - Model identifier string
 * @returns Estimated USD cost, or `null` if the model is not in the pricing table
 */
export function estimateEmbedCost(
  tokens: number,
  model: string,
): number | null {
  const pricing = EMBEDDING_PRICING[model];
  if (!pricing) return null;

  if (tokens === 0) return 0;

  return tokens * pricing.input;
}
