/**
 * Composed document-body reads for source_documents (id-392, M6 completion).
 *
 * The extracted body of a pipeline-ingested document lives in
 * `content_chunks.content` (ordered by `position`), or `reference_items.body`
 * on the URL-ingest route — `source_documents.extracted_text` is permanently
 * NULL on the pipeline path and is NOT read here (owner ruling S507:
 * forward-alignment, no legacy fallback; DR-093 pre-launch posture — no
 * backfill, readers do not paper over pre-pivot rows).
 *
 * Every production "document body" reader routes through this helper so the
 * composition rule lives in exactly one place.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/** Separator between composed chunks — chunk boundaries are heading-aligned,
 * so a blank line preserves paragraph structure in the recomposed body. */
const CHUNK_SEPARATOR = '\n\n';

/** PostgREST caps a select at 1000 rows — page chunk reads so a multi-document
 * batch can never silently truncate a body mid-document. */
const CHUNK_PAGE_SIZE = 1000;

/**
 * Fetch the composed body for each of `ids`.
 *
 * Resolution per document:
 * 1. `content_chunks.content` ordered by `position`, joined with blank lines
 *    (the pipeline file-route home).
 * 2. `reference_items.body` where the document has no chunks (the URL-route
 *    home).
 * 3. `null` when neither exists (bodyless row — callers keep their existing
 *    "no content" handling).
 *
 * The returned map has an entry for EVERY requested id (never a partial map),
 * so `bodies.get(id) ?? null` is always a deliberate read.
 *
 * Throws a plain `Error` on a failed query — callers wrap per their own
 * error idiom (AIServiceError, tryQuery, route error boundaries).
 */
export async function fetchSourceDocumentBodies(
  supabase: SupabaseClient<Database>,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const bodies = new Map<string, string | null>();
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    return bodies;
  }
  for (const id of uniqueIds) {
    bodies.set(id, null);
  }

  // Chunk leg — paged so large batches cannot hit the PostgREST row cap.
  const chunksByDoc = new Map<string, string[]>();
  for (let offset = 0; ; offset += CHUNK_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('content_chunks')
      .select('source_document_id, content, position')
      .in('source_document_id', uniqueIds)
      .order('source_document_id', { ascending: true })
      .order('position', { ascending: true })
      .range(offset, offset + CHUNK_PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `fetchSourceDocumentBodies: content_chunks read failed: ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      if (row.source_document_id === null || row.content === null) continue;
      const existing = chunksByDoc.get(row.source_document_id);
      if (existing) {
        existing.push(row.content);
      } else {
        chunksByDoc.set(row.source_document_id, [row.content]);
      }
    }
    if ((data ?? []).length < CHUNK_PAGE_SIZE) break;
  }
  for (const [docId, chunks] of chunksByDoc) {
    const composed = chunks.join(CHUNK_SEPARATOR).trim();
    if (composed.length > 0) {
      bodies.set(docId, composed);
    }
  }

  // Reference-item leg — only for documents the chunk leg left bodyless.
  const unresolved = uniqueIds.filter((id) => bodies.get(id) === null);
  if (unresolved.length > 0) {
    const { data, error } = await supabase
      .from('reference_items')
      .select('source_document_id, body')
      .in('source_document_id', unresolved);
    if (error) {
      throw new Error(
        `fetchSourceDocumentBodies: reference_items read failed: ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      if (row.source_document_id === null) continue;
      const body = row.body?.trim();
      // First non-empty body wins — the URL route stages one reference_item
      // per document, so multiples only arise from manual data and any
      // non-empty one is a valid body.
      if (body && bodies.get(row.source_document_id) === null) {
        bodies.set(row.source_document_id, row.body);
      }
    }
  }

  return bodies;
}

/** Single-document convenience over {@link fetchSourceDocumentBodies}. */
export async function fetchSourceDocumentBody(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<string | null> {
  const bodies = await fetchSourceDocumentBodies(supabase, [id]);
  return bodies.get(id) ?? null;
}
