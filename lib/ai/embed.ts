import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1024;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

/**
 * Generate an embedding vector for the given text.
 * Uses OpenAI text-embedding-3-large with 1024 dimensions (Matryoshka shortening).
 * Matches the pattern in app/api/embed/route.ts.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
