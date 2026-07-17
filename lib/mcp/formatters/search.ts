/**
 * Search result formatters for MCP tool responses.
 */
import { z } from 'zod';
import { formatContentType } from '@/lib/format';
import { truncate } from './shared';

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  summary: string | null;
  similarity: number;
}

/**
 * Zod schema for `SearchResult` — mirrors the interface exactly for
 * MCP `outputSchema` runtime validation.
 */
const SearchResultSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  suggested_title: z.string().nullable(),
  content_type: z.string().nullable(),
  primary_domain: z.string().nullable(),
  primary_subtopic: z.string().nullable(),
  summary: z.string().nullable(),
  similarity: z.number(),
});

/**
 * Zod schema for the `search_knowledge_base` / `search_qa_library`
 * structured response envelope.
 */
export const SearchResponseSchema = z.object({
  query: z.string(),
  offset: z.number(),
  count: z.number(),
  has_more: z.boolean(),
  results: z.array(SearchResultSchema),
});

export function formatSearchResults(
  query: string,
  results: SearchResult[],
): string {
  if (results.length === 0) {
    return `# Search Results for "${query}"\n\nNo results found. Try broadening your search terms.`;
  }

  const lines: string[] = [
    `# Search Results for "${query}"`,
    '',
    `Found ${results.length} result${results.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const title = r.suggested_title || r.title || 'Untitled';
    const type = formatContentType(r.content_type);
    const similarity = Math.round(r.similarity * 100);

    lines.push(`## ${i + 1}. ${title} (${type})`);

    if (r.primary_domain) {
      const domain = r.primary_subtopic
        ? `${r.primary_domain} > ${r.primary_subtopic}`
        : r.primary_domain;
      lines.push(`**Domain:** ${domain}`);
    }

    lines.push(`**Relevance:** ${similarity}%`);

    if (r.summary) {
      lines.push(truncate(r.summary, 300));
    }

    lines.push(`**ID:** ${r.id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Q&A search results
// ---------------------------------------------------------------------------

export function formatQASearchResults(
  query: string,
  results: SearchResult[],
): string {
  if (results.length === 0) {
    return `# Q&A Library Search: "${query}"\n\nNo Q&A pairs found matching your query.`;
  }

  const lines: string[] = [
    `# Q&A Library Search: "${query}"`,
    '',
    `Found ${results.length} Q&A pair${results.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const title = r.suggested_title || r.title || 'Untitled Q&A';
    const similarity = Math.round(r.similarity * 100);

    lines.push(`## ${i + 1}. ${title}`);

    if (r.primary_domain) {
      const domain = r.primary_subtopic
        ? `${r.primary_domain} > ${r.primary_subtopic}`
        : r.primary_domain;
      lines.push(`**Domain:** ${domain}`);
    }

    lines.push(`**Relevance:** ${similarity}%`);

    if (r.summary) {
      lines.push(truncate(r.summary, 300));
    }

    lines.push(`**ID:** ${r.id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Chunk search results
// ---------------------------------------------------------------------------

export interface ChunkSearchResult {
  chunk_id: string;
  // ID-131.11 G-SEARCH (M2): chunks re-parented content_item_id →
  // source_document_id; mirrors the search_content_chunks RPC return column.
  source_document_id: string;
  item_title: string | null;
  item_suggested_title: string | null;
  item_content_type: string | null;
  item_primary_domain: string | null;
  item_primary_subtopic: string | null;
  heading_text: string | null;
  heading_level: number | null;
  heading_path: string[] | null;
  content: string;
  position: number;
  char_count: number;
  word_count: number;
  similarity: number;
}

/**
 * Zod schema for `ChunkSearchResult` — mirrors the interface exactly for
 * MCP `outputSchema` runtime validation.
 */
const ChunkSearchResultSchema = z.object({
  chunk_id: z.string(),
  source_document_id: z.string(),
  item_title: z.string().nullable(),
  item_suggested_title: z.string().nullable(),
  item_content_type: z.string().nullable(),
  item_primary_domain: z.string().nullable(),
  item_primary_subtopic: z.string().nullable(),
  heading_text: z.string().nullable(),
  heading_level: z.number().nullable(),
  heading_path: z.array(z.string()).nullable(),
  content: z.string(),
  position: z.number(),
  char_count: z.number(),
  word_count: z.number(),
  similarity: z.number(),
});

/**
 * Zod schema for the `search_content_chunks` structured response envelope.
 */
export const ChunkSearchResponseSchema = z.object({
  query: z.string(),
  count: z.number(),
  // Echo of the MCP-facing tool arg, which deliberately stays
  // `content_item_id` (see lib/mcp/tools/search.ts runChunkSearch) — only the
  // per-result rows carry the renamed `source_document_id`.
  content_item_id: z.string().nullable(),
  overdue_review_filter: z.boolean().nullable(),
  review_due_within_days_filter: z.number().nullable(),
  visibility_filter: z.string(),
  results: z.array(ChunkSearchResultSchema),
});

export function formatChunkSearchResults(
  query: string,
  results: ChunkSearchResult[],
): string {
  if (results.length === 0) {
    return `# Chunk Search Results for "${query}"\n\nNo matching sections found. Try broadening your search terms, or use search_knowledge_base for whole-document search.`;
  }

  const lines: string[] = [
    `# Chunk Search Results for "${query}"`,
    '',
    `Found ${results.length} matching section${results.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const itemTitle = r.item_suggested_title || r.item_title || 'Untitled';
    const sectionTitle = r.heading_text || '(preamble)';
    const similarity = Math.round(r.similarity * 100);
    const path = r.heading_path?.length
      ? r.heading_path.join(' > ')
      : '(document root)';

    lines.push(`## ${i + 1}. ${sectionTitle}`);
    lines.push(`**Document:** ${itemTitle}`);
    lines.push(`**Path:** ${path}`);
    if (r.item_primary_domain) {
      const domain = r.item_primary_subtopic
        ? `${r.item_primary_domain} > ${r.item_primary_subtopic}`
        : r.item_primary_domain;
      lines.push(`**Domain:** ${domain}`);
    }
    lines.push(`**Relevance:** ${similarity}%`);
    lines.push(`**Size:** ${r.word_count} words`);
    lines.push('');
    // Show content excerpt (truncated for large chunks)
    lines.push(truncate(r.content, 500));
    lines.push('');
    lines.push(
      `**Chunk ID:** ${r.chunk_id} | **Source Document ID:** ${r.source_document_id}`,
    );
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Similar items
// ---------------------------------------------------------------------------

export interface SimilarItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  similarity: number;
  likely_duplicate: boolean;
}

export interface SimilarItemsResult {
  source_item: { id: string; title: string };
  similar_items: SimilarItem[];
}

/**
 * Zod schema for a `SimilarItem` — mirrors the interface for `find`'s
 * `outputSchema` runtime validation (similar_to branch).
 */
const SimilarItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  suggested_title: z.string().nullable(),
  content_type: z.string().nullable(),
  primary_domain: z.string().nullable(),
  similarity: z.number(),
  likely_duplicate: z.boolean(),
});

/**
 * Zod schema for the `find` similar-items structured envelope.
 */
const SimilarItemsResponseSchema = z.object({
  source_item: z.object({ id: z.string(), title: z.string() }),
  similar_items: z.array(SimilarItemSchema),
});

// ---------------------------------------------------------------------------
// `find` consolidated output schema (ID-71.7 / M37)
//
// One outcome-shaped `find` entry collapses the prior search trio +
// find_similar_items. Its `outputSchema` is the union of the three response
// envelopes the consolidated branches produce: item-level search
// (SearchResponseSchema), chunk-level search (ChunkSearchResponseSchema), and
// vector similar-items discovery (SimilarItemsResponseSchema). The branch is
// selected at call time by `granularity` / `similar_to`.
// ---------------------------------------------------------------------------

/**
 * Zod schema for the consolidated `find` structured response. A union over
 * the item / chunk / similar-items envelopes — the new entry's `outputSchema`
 * per M37 (B-INV-37). Declared on `find` only; the retiring trio carried no
 * retrofit.
 */
export const FindResponseSchema = z.union([
  SearchResponseSchema,
  ChunkSearchResponseSchema,
  SimilarItemsResponseSchema,
]);

// (The `find_duplicates` output schema — FindDuplicatesResponseSchema, ID-71.10
// / M32, B-INV-32 — was a z.union([SimilarItemsResponseSchema,
// DuplicatePairsResponseSchema]) covering the two `scope` branches. The
// `scope: 'all'` branch was retired under ID-131.15 (G-DEDUP legacy
// dedup-family retirement, S446), leaving find_duplicates single-item-only —
// the same envelope as SimilarItemsResponseSchema, which callers now use
// directly. The separate export was removed rather than kept as a duplicate
// alias (knip flags exact-reference duplicate exports).)

export function formatSimilarItems(data: SimilarItemsResult): string {
  const lines: string[] = [
    `# Similar Items to "${data.source_item.title}"`,
    '',
  ];

  if (data.similar_items.length === 0) {
    lines.push('No similar items found above the similarity threshold.');
    return lines.join('\n');
  }

  lines.push(
    `Found ${data.similar_items.length} similar item${data.similar_items.length === 1 ? '' : 's'}:`,
    '',
  );

  for (let i = 0; i < data.similar_items.length; i++) {
    const item = data.similar_items[i];
    const title = item.suggested_title || item.title || 'Untitled';
    const similarity = Math.round(item.similarity * 100);
    const type = formatContentType(item.content_type);
    const dupLabel = item.likely_duplicate ? ' **[LIKELY DUPLICATE]**' : '';

    lines.push(`## ${i + 1}. ${title} (${type})${dupLabel}`);
    if (item.primary_domain) lines.push(`**Domain:** ${item.primary_domain}`);
    lines.push(`**Similarity:** ${similarity}%`);
    lines.push(`**ID:** ${item.id}`);
    lines.push('');
  }

  return lines.join('\n');
}
