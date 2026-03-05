/**
 * Citation extraction from Claude API Search Result Citations responses.
 *
 * The Claude API returns citations as `search_result_location` objects on text
 * blocks. Each citation references a specific search result by index and
 * includes the exact text being cited.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { CitationEntry } from '@/types/bid-metadata';

/** Minimal content item shape needed for citation mapping */
export interface CitationSourceItem {
  id: string;
  title: string | null;
  content: string | null;
}

/** Result of extracting text and citations from a Claude response */
export interface ExtractedCitedResponse {
  text: string;
  citations: CitationEntry[];
}

/**
 * Extract response text and citations from a Claude API response that used
 * Search Result Citations. Maps search_result_location citations back to
 * content item UUIDs.
 */
export function extractCitedResponse(
  response: Anthropic.Message,
  matchedContent: CitationSourceItem[],
): ExtractedCitedResponse {
  const citations: CitationEntry[] = [];
  let fullText = '';

  for (const block of response.content) {
    if (block.type === 'text') {
      fullText += block.text;

      // Extract search_result_location citations from the text block
      if ('citations' in block && Array.isArray(block.citations)) {
        for (const citation of block.citations) {
          if (
            typeof citation === 'object' &&
            citation !== null &&
            'type' in citation &&
            citation.type === 'search_result_location'
          ) {
            const c = citation as {
              type: 'search_result_location';
              source: string;
              title: string | null;
              cited_text: string;
              search_result_index: number;
              start_block_index: number;
              end_block_index: number;
            };

            // Map search_result_index back to our content item UUID
            const sourceItem = matchedContent[c.search_result_index];

            citations.push({
              cited_text: c.cited_text,
              source_index: c.search_result_index,
              source_id: sourceItem?.id ?? '',
              source_title: c.title ?? sourceItem?.title ?? '',
              source_url: c.source ?? '',
              start_block_index: c.start_block_index ?? 0,
              end_block_index: c.end_block_index ?? 0,
            });
          }
        }
      }
    }
  }

  return { text: fullText, citations };
}

/**
 * Deduplicate citations by source_id, keeping the first occurrence.
 * Useful for summary displays where you want unique source references.
 */
export function deduplicateCitations(citations: CitationEntry[]): CitationEntry[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    if (seen.has(c.source_id)) return false;
    seen.add(c.source_id);
    return true;
  });
}

/**
 * Count unique sources referenced by citations.
 */
export function countUniqueSources(citations: CitationEntry[]): number {
  return new Set(citations.map((c) => c.source_id)).size;
}

/**
 * Detect orphaned citations — citations whose source content item has been
 * deleted. The citation data (source_title, cited_text) is snapshotted at
 * draft time, but the "View source" link would be a 404.
 *
 * Returns a Set of source_id values that no longer exist in sourceContent.
 */
export function getOrphanedSourceIds(
  citations: Array<{ source_id: string }>,
  sourceContent: Array<{ id: string }>,
): Set<string> {
  const existingIds = new Set(sourceContent.map((s) => s.id));
  return new Set(
    citations
      .map((c) => c.source_id)
      .filter((id) => id && !existingIds.has(id)),
  );
}

/**
 * Batch-check whether source content items still exist in the database using
 * the `check_content_exists` RPC. Returns a Set of source_id values that no
 * longer exist (orphaned).
 *
 * This is the authoritative check -- it queries the database directly rather
 * than relying on a pre-fetched source_content array. Use this when you need
 * definitive orphan detection (e.g., after content deletions).
 *
 * @param sourceIds - Array of content item UUIDs to check
 * @param supabase  - An initialised Supabase client
 * @returns Set of source_id values that no longer exist
 */
export async function checkOrphanedSourceIds(
  sourceIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { rpc: (...args: any[]) => PromiseLike<{ data: any; error: any }> },
): Promise<Set<string>> {
  // Filter out empty/falsy IDs and deduplicate
  const uniqueIds = [...new Set(sourceIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Set();

  const { data, error } = await supabase.rpc('check_content_exists', {
    ids: uniqueIds,
  });

  if (error || !data) {
    // On error, return empty set -- fail open (don't mark things as orphaned
    // when we can't verify)
    console.warn('check_content_exists RPC failed:', error);
    return new Set();
  }

  return new Set(
    (data as Array<{ id: string; item_exists: boolean }>)
      .filter((r) => !r.item_exists)
      .map((r) => r.id),
  );
}
