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
