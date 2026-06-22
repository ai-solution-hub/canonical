import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';
import { analyseDocumentImpact } from '@/lib/source-documents/source-document-impact';
import type { DiffEntry } from '@/lib/source-documents/document-diff';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/**
 * ID-117.11 REHOME decouple: analyseDocumentImpact now receives DiffEntry[]
 * directly instead of re-fetching from source_document_diffs. Tests verify
 * the in-memory filtering (modified/removed only) and content-item matching
 * logic, with no DB reads or writes to source_document_diffs.
 */
describe('analyseDocumentImpact', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
  });

  it('returns empty result when document has no parent', async () => {
    // First call: get new document (no parent_id)
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: null },
      error: null,
    });

    const entries: DiffEntry[] = [
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'Some question?',
        old_content: 'Some answer',
        new_question: 'Some question?',
        new_content: 'Updated answer',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    expect(result.document_id).toBe('new-doc-1');
    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('returns empty result when no relevant diff entries (empty array)', async () => {
    // First call: get new document (has parent)
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', []);

    expect(result.document_id).toBe('new-doc-1');
    expect(result.previous_version_id).toBe('old-doc-1');
    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('returns empty result when entries contain only added/unchanged (no modified/removed)', async () => {
    // First call: get new document (has parent)
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    const entries: DiffEntry[] = [
      {
        diff_type: 'added',
        diff_mode: 'qa',
        new_question: 'Newly added question?',
        new_content: 'New answer',
      },
      {
        diff_type: 'unchanged',
        diff_mode: 'qa',
        old_question: 'Unchanged question?',
        old_content: 'Same answer',
        new_question: 'Unchanged question?',
        new_content: 'Same answer',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    expect(result.document_id).toBe('new-doc-1');
    expect(result.previous_version_id).toBe('old-doc-1');
    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('maps modified entries to content items as needs_update', async () => {
    // First call: get new document
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call (awaited chain): get linked content items
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-1',
              title: 'What is our ISO certification?',
              content: 'We hold ISO 9001',
            },
          ],
          error: null,
        }),
    );

    const entries: DiffEntry[] = [
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'What is our ISO certification?',
        old_content: 'We hold ISO 9001',
        new_question: 'What is our ISO certification?',
        new_content: 'We hold ISO 9001:2015 and ISO 14001',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    expect(result.total_affected_items).toBe(1);
    expect(result.items[0]).toEqual({
      content_item_id: 'item-1',
      content_item_title: 'What is our ISO certification?',
      impact_type: 'needs_update',
      diff_detail: expect.stringContaining('Q&A pair modified'),
    });
  });

  it('maps removed entries to content items as source_removed', async () => {
    // First call: get new document
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call (awaited chain): get linked content items
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-2',
              title: 'What is our health and safety policy?',
              content: 'We follow HSE guidelines',
            },
          ],
          error: null,
        }),
    );

    const entries: DiffEntry[] = [
      {
        diff_type: 'removed',
        diff_mode: 'qa',
        old_question: 'What is our health and safety policy?',
        old_content: 'We follow HSE guidelines',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    expect(result.total_affected_items).toBe(1);
    expect(result.items[0].impact_type).toBe('source_removed');
    expect(result.items[0].diff_detail).toContain('Q&A pair removed');
  });

  it('filters out added/unchanged entries — only modified/removed drive impact', async () => {
    // First call: get new document
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call (awaited chain): get linked content items
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-1',
              title: 'What is our ISO certification?',
              content: 'We hold ISO 9001',
            },
            {
              id: 'item-3',
              title: 'New policy',
              content: 'New policy content',
            },
          ],
          error: null,
        }),
    );

    const entries: DiffEntry[] = [
      {
        diff_type: 'added',
        diff_mode: 'qa',
        new_question: 'New policy',
        new_content: 'New policy content',
      },
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'What is our ISO certification?',
        old_content: 'We hold ISO 9001',
        new_question: 'What is our ISO certification?',
        new_content: 'We hold ISO 9001:2015',
      },
      {
        diff_type: 'unchanged',
        diff_mode: 'qa',
        old_question: 'Unchanged Q',
        old_content: 'Same A',
        new_question: 'Unchanged Q',
        new_content: 'Same A',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    // Only the 'modified' entry produces an impact item; 'added' and 'unchanged' are filtered
    expect(result.total_affected_items).toBe(1);
    expect(result.items[0].content_item_id).toBe('item-1');
    expect(result.items[0].impact_type).toBe('needs_update');
  });

  it('returns empty items when no content matches the diff questions', async () => {
    // First call: get new document
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: linked content items that don't match
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-3',
              title: 'What is our turnover?',
              content: 'Our turnover is 5 million',
            },
          ],
          error: null,
        }),
    );

    const entries: DiffEntry[] = [
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'Completely unrelated question?',
        old_content: 'Some answer',
        new_question: 'Completely unrelated question?',
        new_content: 'Updated answer',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('matches content items by content body when title does not match', async () => {
    // First call: get new document
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: content item has a different title but contains the question in body
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-4',
              title: 'Quality Management',
              content:
                'Q: Describe your quality management system\nA: We use ISO 9001',
            },
          ],
          error: null,
        }),
    );

    const entries: DiffEntry[] = [
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'describe your quality management system',
        old_content: 'We use ISO 9001',
        new_question: 'describe your quality management system',
        new_content: 'We use ISO 9001:2015',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    expect(result.total_affected_items).toBe(1);
    expect(result.items[0].content_item_id).toBe('item-4');
  });

  it('avoids duplicate impact entries for the same content item', async () => {
    // First call: get new document
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: one content item
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'item-5',
              title: 'What is our turnover?',
              content: 'Our annual turnover is 5 million',
            },
          ],
          error: null,
        }),
    );

    // Two diff entries that both match the same content item
    const entries: DiffEntry[] = [
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'What is our turnover?',
        old_content: '5 million',
        new_question: 'What is our turnover?',
        new_content: '6 million',
      },
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'What is our turnover?',
        old_content: '5 million pounds',
        new_question: 'What is our turnover?',
        new_content: '6 million pounds',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    // Should only have one impact item, not two
    expect(result.total_affected_items).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('returns empty items when no linked content items exist for the old document', async () => {
    // First call: get new document
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: no linked content items
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const entries: DiffEntry[] = [
      {
        diff_type: 'modified',
        diff_mode: 'qa',
        old_question: 'What is our turnover?',
        old_content: '5 million',
        new_question: 'What is our turnover?',
        new_content: '6 million',
      },
    ];

    const result = await analyseDocumentImpact(supabase, 'new-doc-1', entries);

    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.document_filename).toBe('test.docx');
  });
});
