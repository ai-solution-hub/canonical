import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1024;

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
