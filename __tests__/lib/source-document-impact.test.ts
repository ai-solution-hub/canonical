import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';
import { analyseDocumentImpact } from '@/lib/source-document-impact';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

describe('analyseDocumentImpact', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
  });

  it('returns empty result when document has no parent', async () => {
    // First call: get new document (no parent_id)
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: null },
      error: null,
    });

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    expect(result.document_id).toBe('new-doc-1');
    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('returns empty result when no diffs exist', async () => {
    // First call: get new document (has parent)
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call (awaited chain): get diffs — none found
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    expect(result.document_id).toBe('new-doc-1');
    expect(result.previous_version_id).toBe('old-doc-1');
    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('maps modified diffs to content items as needs_update', async () => {
    // First call: get new document
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call (awaited chain): get diffs
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'diff-1',
              diff_type: 'modified',
              old_question: 'What is our ISO certification?',
              old_content: 'We hold ISO 9001',
              new_question: 'What is our ISO certification?',
              new_content: 'We hold ISO 9001:2015 and ISO 14001',
            },
          ],
          error: null,
        }),
    );

    // Third call (awaited chain): get linked content items
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

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    expect(result.total_affected_items).toBe(1);
    expect(result.items[0]).toEqual({
      content_item_id: 'item-1',
      content_item_title: 'What is our ISO certification?',
      impact_type: 'needs_update',
      diff_detail: expect.stringContaining('Q&A pair modified'),
    });
  });

  it('maps removed diffs to content items as source_removed', async () => {
    // First call: get new document
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: get diffs
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'diff-2',
              diff_type: 'removed',
              old_question: 'What is our health and safety policy?',
              old_content: 'We follow HSE guidelines',
              new_question: null,
              new_content: null,
            },
          ],
          error: null,
        }),
    );

    // Third call: get linked content items
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

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    expect(result.total_affected_items).toBe(1);
    expect(result.items[0].impact_type).toBe('source_removed');
    expect(result.items[0].diff_detail).toContain('Q&A pair removed');
  });

  it('returns empty items when no content matches the diff questions', async () => {
    // First call: get new document
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: get diffs
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'diff-3',
              diff_type: 'modified',
              old_question: 'Completely unrelated question?',
              old_content: 'Some answer',
              new_question: 'Completely unrelated question?',
              new_content: 'Updated answer',
            },
          ],
          error: null,
        }),
    );

    // Third call: linked content items that don't match the diff question
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

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('matches content items by content body when title does not match', async () => {
    // First call: get new document
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: get diffs
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'diff-4',
              diff_type: 'modified',
              old_question: 'describe your quality management system',
              old_content: 'We use ISO 9001',
              new_question: 'describe your quality management system',
              new_content: 'We use ISO 9001:2015',
            },
          ],
          error: null,
        }),
    );

    // Third call: content item has a different title but contains the question in body
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

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    expect(result.total_affected_items).toBe(1);
    expect(result.items[0].content_item_id).toBe('item-4');
  });

  it('handles empty diff list gracefully', async () => {
    // First call: get new document
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: empty diffs
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    expect(result.total_affected_items).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.document_filename).toBe('test.docx');
  });

  it('avoids duplicate impact entries for the same content item', async () => {
    // First call: get new document
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc-1', filename: 'test.docx', parent_id: 'old-doc-1' },
      error: null,
    });

    // Second call: two diffs that match the same content item
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'diff-5',
              diff_type: 'modified',
              old_question: 'What is our turnover?',
              old_content: '5 million',
              new_question: 'What is our turnover?',
              new_content: '6 million',
            },
            {
              id: 'diff-6',
              diff_type: 'modified',
              old_question: 'What is our turnover?',
              old_content: '5 million pounds',
              new_question: 'What is our turnover?',
              new_content: '6 million pounds',
            },
          ],
          error: null,
        }),
    );

    // Third call: one content item
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

    const result = await analyseDocumentImpact(supabase, 'new-doc-1');

    // Should only have one impact item, not two
    expect(result.total_affected_items).toBe(1);
    expect(result.items).toHaveLength(1);
  });
});
