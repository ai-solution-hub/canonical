import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1024;

/**
 * Maximum character budget for an embedding input.
 *
 * OpenAI `text-embedding-3-large` caps input at 8,192 tokens. For English
 * text the rough ratio is ~4 chars per token, so 8,192 tokens ≈ 32,768
 * chars. We budget ~28,000 chars (~7,000 tokens) to stay safely under
 * the hard cap with headroom for tokenisation variance on non-English
 * content and unusual whitespace.
 *
 * Callers that pass text longer than this MUST truncate (or chunk) before
 * calling `generateEmbedding`, otherwise the OpenAI SDK throws a 400
 * BadRequestError with `maximum context length`. The classify.ts
 * embedding regen path uses this constant to truncate before calling
 * and emits a `classify.embedding.input_truncated` best-effort warning
 * when truncation fires. Closes §2.1.12 (S158 WP2 Run 2 residual finding
 * on items 819b285f and c1042ca4 which were 138k and 55k chars).
 */
export const MAX_EMBEDDING_CHARS = 28_000;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

// ── Embedding cache ──
const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  embedding: number[];
  createdAt: number;
}

const embeddingCache = new Map<string, CacheEntry>();

/** Evict expired entries and oldest if over capacity */
function evictCache(): void {
  const now = Date.now();
  // Remove expired entries
  for (const [key, entry] of embeddingCache) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      embeddingCache.delete(key);
    }
  }
  // If still over capacity, remove oldest entries
  if (embeddingCache.size >= CACHE_MAX_ENTRIES) {
    const entries = [...embeddingCache.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );
    const toRemove = entries.slice(
      0,
      embeddingCache.size - CACHE_MAX_ENTRIES + 1,
    );
    for (const [key] of toRemove) {
      embeddingCache.delete(key);
    }
  }
}

/**
 * Generate an embedding vector for the given text.
 * Uses OpenAI text-embedding-3-large with 1024 dimensions (Matryoshka shortening).
 * Matches the pattern in app/api/embed/route.ts.
 * Results are cached with a 1-hour TTL (max 500 entries).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Check cache
  const cached = embeddingCache.get(text);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.embedding;
  }

  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const embedding = response.data[0].embedding;

  // Store in cache
  evictCache();
  embeddingCache.set(text, { embedding, createdAt: Date.now() });

  return embedding;
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
