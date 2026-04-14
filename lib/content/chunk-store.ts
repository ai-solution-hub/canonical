/**
 * Chunk storage and embedding generation.
 *
 * Responsible for turning a markdown document into stored rows in
 * `content_chunks`, including per-chunk embeddings.
 *
 * Embedding input format: `heading_path.join(' > ') + '\n\n' + chunk_content`.
 * The path prefix gives the embedding model context about where the chunk
 * sits in the document so retrieval ranks semantically related sections
 * higher than a bare body match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding, MAX_EMBEDDING_CHARS } from '@/lib/ai/embed';
import { sb } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { chunkByHeadings, type ContentChunk } from './chunking';

export type ChunkWithEmbedding = ContentChunk & {
  embedding: number[] | null;
};

/**
 * Build the embedding input text for a chunk.
 *
 * Format: heading_path joined by ' > ', then double newline, then chunk content.
 * This gives the embedding model context about where this chunk sits in the
 * document. Truncated to MAX_EMBEDDING_CHARS (24,000) to stay within the
 * text-embedding-3-large token budget.
 */
export function buildChunkEmbeddingText(chunk: ContentChunk): string {
  const prefix =
    chunk.heading_path.length > 0
      ? chunk.heading_path.join(' > ') + '\n\n'
      : '';
  const text = prefix + chunk.content;
  return text.slice(0, MAX_EMBEDDING_CHARS);
}

/**
 * Generate embeddings for all chunks in parallel.
 *
 * Non-fatal per chunk: a single embedding failure yields a chunk with
 * `embedding: null` and a best-effort warning; the remaining chunks still
 * return successfully. Callers can inspect `embedding === null` to decide
 * whether to retry.
 */
export async function generateChunkEmbeddings(
  chunks: ContentChunk[],
): Promise<ChunkWithEmbedding[]> {
  return Promise.all(
    chunks.map(async (chunk): Promise<ChunkWithEmbedding> => {
      try {
        const text = buildChunkEmbeddingText(chunk);
        const embedding = await generateEmbedding(text);
        return { ...chunk, embedding };
      } catch (err) {
        logBestEffortWarn(
          'content.chunks.embedding',
          'Failed to generate embedding for chunk',
          {
            position: chunk.position,
            heading_text: chunk.heading_text,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        return { ...chunk, embedding: null };
      }
    }),
  );
}

/**
 * Store chunks to the database. Handles parent_chunk_id resolution
 * (parent_position -> actual UUID after insert).
 *
 * Strategy: Insert all chunks with parent_chunk_id null, then update
 * parent references in a second pass using the position -> UUID map.
 */
export async function storeChunks(
  supabase: SupabaseClient,
  contentItemId: string,
  chunks: ChunkWithEmbedding[],
): Promise<{ stored: number; errors: string[] }> {
  const errors: string[] = [];

  if (chunks.length === 0) {
    return { stored: 0, errors: [] };
  }

  // Insert all chunks (parent_chunk_id = null initially)
  const insertRows = chunks.map((chunk) => ({
    content_item_id: contentItemId,
    heading_text: chunk.heading_text,
    heading_level: chunk.heading_level,
    heading_path: chunk.heading_path,
    content: chunk.content,
    position: chunk.position,
    parent_chunk_id: null as string | null,
    // vector columns must receive a JSON-serialised array, not a raw number[]
    embedding: chunk.embedding ? JSON.stringify(chunk.embedding) : null,
    char_count: chunk.char_count,
    word_count: chunk.word_count,
  }));

  let inserted: { id: string; position: number }[];
  try {
    inserted = await sb<{ id: string; position: number }[]>(
      supabase
        .from('content_chunks')
        .insert(insertRows)
        .select('id, position'),
      'content_chunks.insert',
    );
  } catch (err) {
    errors.push(
      `Chunk insert failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { stored: 0, errors };
  }

  // Build position -> UUID map for parent resolution
  const positionToId = new Map<number, string>();
  for (const row of inserted) {
    positionToId.set(row.position, row.id);
  }

  // Update parent_chunk_id references in a second pass
  for (const chunk of chunks) {
    if (chunk.parent_position !== null) {
      const chunkId = positionToId.get(chunk.position);
      const parentId = positionToId.get(chunk.parent_position);
      if (chunkId && parentId) {
        try {
          await sb(
            supabase
              .from('content_chunks')
              .update({ parent_chunk_id: parentId })
              .eq('id', chunkId)
              .select('id'),
            'content_chunks.update_parent',
          );
        } catch (err) {
          errors.push(
            `Parent update failed for chunk ${chunk.position}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }

  return { stored: inserted.length, errors };
}

/**
 * Delete all existing chunks for a content item and regenerate from the
 * provided markdown.
 *
 * Called when content is edited so chunks stay in sync with the canonical
 * markdown. Uses delete-then-insert rather than diff-based update because
 * heading restructures (add/remove/rename sections) are common and make
 * position-based diffing brittle.
 */
export async function regenerateChunks(
  supabase: SupabaseClient,
  contentItemId: string,
  markdownContent: string,
): Promise<{ stored: number; errors: string[] }> {
  // Delete existing chunks (CASCADE handles child references)
  try {
    await sb(
      supabase
        .from('content_chunks')
        .delete()
        .eq('content_item_id', contentItemId)
        .select('id'),
      'content_chunks.delete_existing',
    );
  } catch (err) {
    return {
      stored: 0,
      errors: [
        `Failed to delete existing chunks: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    };
  }

  // Generate new chunks
  const chunks = chunkByHeadings(markdownContent);

  if (chunks.length === 0) {
    return { stored: 0, errors: [] };
  }

  // Generate embeddings
  const chunksWithEmbeddings = await generateChunkEmbeddings(chunks);

  // Store
  return storeChunks(supabase, contentItemId, chunksWithEmbeddings);
}
