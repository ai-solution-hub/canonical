/**
 * fetchSourceDocumentBodies / fetchSourceDocumentBody tests (id-392 M6).
 *
 * The composed document body lives in `content_chunks.content` (ordered by
 * `position`) on the pipeline file route, or `reference_items.body` on the
 * URL route — `source_documents.extracted_text` is permanently NULL on the
 * pipeline path and is never read. These tests pin the composition contract:
 * chunks joined with blank lines win; the reference body is a fallback ONLY
 * for chunkless documents; every requested id gets a map entry; chunk reads
 * page at 1000 rows; a failed query throws.
 */
import { describe, it, expect } from 'vitest';

import { createMockSupabaseTableDispatch } from '@/__tests__/helpers/mock-supabase';
import {
  fetchSourceDocumentBodies,
  fetchSourceDocumentBody,
} from '@/lib/source-documents/body';

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';

function chunkRow(sourceDocumentId: string, content: string, position: number) {
  return { source_document_id: sourceDocumentId, content, position };
}

describe('fetchSourceDocumentBodies', () => {
  it('composes a document body from its chunks in position order, separated by blank lines', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: [
          chunkRow(DOC_A, 'Alpha paragraph.', 0),
          chunkRow(DOC_A, 'Beta paragraph.', 1),
          chunkRow(DOC_A, 'Gamma paragraph.', 2),
        ],
        error: null,
      },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [DOC_A]);

    expect(bodies.get(DOC_A)).toBe(
      'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.',
    );
  });

  it('prefers the chunk-composed body over a reference_items body when both exist', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: [chunkRow(DOC_A, 'Chunk body.', 0)],
        error: null,
      },
      reference_items: {
        data: [{ source_document_id: DOC_A, body: 'Reference body.' }],
        error: null,
      },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [DOC_A]);

    expect(bodies.get(DOC_A)).toBe('Chunk body.');
  });

  it('falls back to the reference_items body for a document with no chunks (URL route)', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: [chunkRow(DOC_A, 'Chunk body for A.', 0)],
        error: null,
      },
      reference_items: {
        data: [{ source_document_id: DOC_B, body: 'URL-route body for B.' }],
        error: null,
      },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [
      DOC_A,
      DOC_B,
    ]);

    expect(bodies.get(DOC_A)).toBe('Chunk body for A.');
    expect(bodies.get(DOC_B)).toBe('URL-route body for B.');
  });

  it('falls back to the reference_items body when the chunks compose to only whitespace', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: [chunkRow(DOC_A, '   \n\t  ', 0)],
        error: null,
      },
      reference_items: {
        data: [{ source_document_id: DOC_A, body: 'Reference body.' }],
        error: null,
      },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [DOC_A]);

    expect(bodies.get(DOC_A)).toBe('Reference body.');
  });

  it('resolves a bodyless document (no chunks, no reference item) to null', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: { data: [], error: null },
      reference_items: { data: [], error: null },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [DOC_A]);

    expect(bodies.has(DOC_A)).toBe(true);
    expect(bodies.get(DOC_A)).toBeNull();
  });

  it('ignores a reference_items row whose body is only whitespace (document stays null)', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: { data: [], error: null },
      reference_items: {
        data: [{ source_document_id: DOC_A, body: '   ' }],
        error: null,
      },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [DOC_A]);

    expect(bodies.get(DOC_A)).toBeNull();
  });

  it('returns an entry for every requested id, with duplicate ids deduplicated', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: [chunkRow(DOC_A, 'Body A.', 0)],
        error: null,
      },
      reference_items: { data: [], error: null },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [
      DOC_A,
      DOC_A,
      DOC_B,
    ]);

    expect(bodies.size).toBe(2);
    expect(bodies.get(DOC_A)).toBe('Body A.');
    expect(bodies.get(DOC_B)).toBeNull();
  });

  it('returns an empty map without issuing any reads when no ids are requested', async () => {
    const supabase = createMockSupabaseTableDispatch();

    const bodies = await fetchSourceDocumentBodies(supabase as never, []);

    expect(bodies.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('reads a second chunk page when the first comes back full, composing content from both pages', async () => {
    // A page of exactly 1000 rows means the read may have been truncated at
    // the PostgREST cap — the helper must fetch the next page so a long
    // document's tail is never silently dropped.
    const pageOne = Array.from({ length: 1000 }, (_, i) =>
      chunkRow(DOC_A, `Chunk ${i}.`, i),
    );
    const pageTwo = [chunkRow(DOC_A, 'Final overflow chunk.', 1000)];

    const supabase = createMockSupabaseTableDispatch({
      content_chunks: { data: [], error: null },
      reference_items: { data: [], error: null },
    });
    supabase._chains.content_chunks.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: pageOne, error: null }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: pageTwo, error: null }),
      );

    const bodies = await fetchSourceDocumentBodies(supabase as never, [DOC_A]);

    const body = bodies.get(DOC_A);
    expect(body).toContain('Chunk 0.');
    expect(body).toContain('Chunk 999.');
    expect(body?.endsWith('Chunk 999.\n\nFinal overflow chunk.')).toBe(true);
  });

  it('does not read a second page when the first page is short of the 1000-row cap', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: [chunkRow(DOC_A, 'Only chunk.', 0)],
        error: null,
      },
      reference_items: { data: [], error: null },
    });

    const bodies = await fetchSourceDocumentBodies(supabase as never, [DOC_A]);

    expect(bodies.get(DOC_A)).toBe('Only chunk.');
    // One awaited chunk read only — a short page terminates the paging loop.
    expect(supabase._chains.content_chunks.then).toHaveBeenCalledTimes(1);
  });

  it('throws a plain Error when the chunk read fails', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: null,
        error: { message: 'connection reset' },
      },
    });

    await expect(
      fetchSourceDocumentBodies(supabase as never, [DOC_A]),
    ).rejects.toThrowError(/content_chunks read failed: connection reset/);
  });

  it('throws a plain Error when the reference_items fallback read fails', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: { data: [], error: null },
      reference_items: {
        data: null,
        error: { message: 'permission denied' },
      },
    });

    await expect(
      fetchSourceDocumentBodies(supabase as never, [DOC_A]),
    ).rejects.toThrowError(/reference_items read failed: permission denied/);
  });
});

describe('fetchSourceDocumentBody', () => {
  it('returns the composed body for a single document', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: {
        data: [
          chunkRow(DOC_A, 'First half.', 0),
          chunkRow(DOC_A, 'Second half.', 1),
        ],
        error: null,
      },
    });

    const body = await fetchSourceDocumentBody(supabase as never, DOC_A);

    expect(body).toBe('First half.\n\nSecond half.');
  });

  it('returns null for a document with no body anywhere', async () => {
    const supabase = createMockSupabaseTableDispatch({
      content_chunks: { data: [], error: null },
      reference_items: { data: [], error: null },
    });

    const body = await fetchSourceDocumentBody(supabase as never, DOC_A);

    expect(body).toBeNull();
  });
});
