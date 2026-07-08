import { describe, it, expect } from 'vitest';
import { createMockSupabaseTable } from '@/__tests__/helpers/mock-supabase';
import { fetchMatchedContentForDrafting } from '@/lib/domains/procurement/draft-response';

/**
 * {131.16} BI-29: `fetchMatchedContentForDrafting` resolves
 * `matched_record_ids`/`source_record_ids` into full drafting content from
 * q_a_pairs (primary) + reference_items (optional) — the retired
 * content_items table is never queried, and source_documents is never a
 * match source (provenance-only — D2/E5).
 */
describe('fetchMatchedContentForDrafting', () => {
  it('returns an empty array without querying when ids is empty', async () => {
    const supabase = createMockSupabaseTable();

    const result = await fetchMatchedContentForDrafting(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      [],
    );

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('resolves q_a_pairs into DraftableContent with the canonical Q/A content shape', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'qa-1',
              question_text: 'What is your data retention policy?',
              answer_standard: 'We retain data for 7 years.',
              answer_advanced: 'Detailed retention schedule available.',
            },
          ],
          error: null,
        }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

    const result = await fetchMatchedContentForDrafting(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      ['qa-1'],
    );

    expect(result).toEqual([
      {
        id: 'qa-1',
        title: 'What is your data retention policy?',
        content:
          'Q: What is your data retention policy?\n\nWe retain data for 7 years.\n\nDetailed retention schedule available.',
        content_type: 'q_a_pair',
        summary: 'We retain data for 7 years.',
      },
    ]);
  });

  it('omits answer_advanced from content when null', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'qa-1',
              question_text: 'Are you ISO 27001 certified?',
              answer_standard: 'Yes, certified since 2022.',
              answer_advanced: null,
            },
          ],
          error: null,
        }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

    const result = await fetchMatchedContentForDrafting(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      ['qa-1'],
    );

    expect(result[0].content).toBe(
      'Q: Are you ISO 27001 certified?\n\nYes, certified since 2022.',
    );
  });

  it('resolves reference_items using body verbatim', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'ri-1',
              title: 'ISO 27001 Certificate',
              body: 'Full certificate text...',
              summary: 'Certification evidence',
            },
          ],
          error: null,
        }),
      );

    const result = await fetchMatchedContentForDrafting(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      ['ri-1'],
    );

    expect(result).toEqual([
      {
        id: 'ri-1',
        title: 'ISO 27001 Certificate',
        content: 'Full certificate text...',
        content_type: 'reference_item',
        summary: 'Certification evidence',
      },
    ]);
  });

  it('merges q_a_pairs and reference_items preserving input id order', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'qa-1',
              question_text: 'Q1',
              answer_standard: 'A1',
              answer_advanced: null,
            },
          ],
          error: null,
        }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'ri-1', title: 'RI1', body: 'B1', summary: null }],
          error: null,
        }),
      );

    const result = await fetchMatchedContentForDrafting(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      ['ri-1', 'qa-1'],
    );

    expect(result.map((r) => r.id)).toEqual(['ri-1', 'qa-1']);
  });

  it('silently drops ids that resolve to neither table (stale/deleted item)', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

    const result = await fetchMatchedContentForDrafting(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      ['missing-id'],
    );

    expect(result).toEqual([]);
  });

  it('throws when the q_a_pairs query errors', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'connection refused' } }),
    );

    await expect(
      fetchMatchedContentForDrafting(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase as any,
        ['qa-1'],
      ),
    ).rejects.toThrow('Failed to fetch matched q_a_pairs: connection refused');
  });

  it('throws when the reference_items query errors', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'timeout' } }),
      );

    await expect(
      fetchMatchedContentForDrafting(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase as any,
        ['ri-1'],
      ),
    ).rejects.toThrow('Failed to fetch matched reference_items: timeout');
  });
});
