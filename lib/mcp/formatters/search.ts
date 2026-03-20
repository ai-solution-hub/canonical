/**
 * Search result formatters for MCP tool responses.
 */
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
  ai_summary: string | null;
  similarity: number;
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
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

    if (r.ai_summary) {
      lines.push(truncate(r.ai_summary, 300));
    }

    lines.push(`**ID:** ${r.id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Q&A search results
// ---------------------------------------------------------------------------

export function formatQASearchResults(query: string, results: SearchResult[]): string {
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

    if (r.ai_summary) {
      lines.push(truncate(r.ai_summary, 300));
    }

    lines.push(`**ID:** ${r.id}`);
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

export function formatSimilarItems(data: SimilarItemsResult): string {
  const lines: string[] = [
    `# Similar Items to "${data.source_item.title}"`,
    '',
  ];

  if (data.similar_items.length === 0) {
    lines.push('No similar items found above the similarity threshold.');
    return lines.join('\n');
  }

  lines.push(`Found ${data.similar_items.length} similar item${data.similar_items.length === 1 ? '' : 's'}:`, '');

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
