/**
 * Search tool registrations (4 tools):
 *   1. search_knowledge_base
 *  13. search_qa_library
 *  20. find_similar_items
 *  21. search_content_chunks
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient } from '@/lib/mcp/auth';
import { tryQuery } from '@/lib/supabase/safe';
import {
  formatSearchResults,
  formatQASearchResults,
  formatSimilarItems,
  formatChunkSearchResults,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  SearchResult,
  SimilarItem,
  SimilarItemsResult,
  ChunkSearchResult,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getGenerateEmbedding,
} from './shared';

// ---------------------------------------------------------------------------
// Load domain names from DB at registration time so tool descriptions stay
// in sync with the taxonomy. Uses the service client (no user auth needed
// for taxonomy metadata).
// ---------------------------------------------------------------------------

async function loadDomainNames(): Promise<string[]> {
  try {
    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('taxonomy_domains')
      .select('name')
      .order('display_order');
    if (error) throw error;
    return (data ?? []).map((d: { name: string }) => d.name);
  } catch {
    // Fallback — ensures tool registration never fails even if DB is unreachable
    return [];
  }
}

export async function registerSearchTools(server: McpServer): Promise<void> {
  const domainNames = await loadDomainNames();
  const domainList =
    domainNames.length > 0
      ? domainNames.join(', ')
      : 'security, compliance, implementation, support, corporate, product-feature, methodology';
  // -------------------------------------------------------------------------
  // 1. search_knowledge_base
  // -------------------------------------------------------------------------
  server.registerTool(
    'search_knowledge_base',
    {
      title: 'Search Knowledge Base',
      description: `Search the knowledge base using semantic and keyword search. Returns content items matching your query, ranked by relevance. Use this to find articles, policies, case studies, Q&A pairs, and other knowledge base content. For Q&A pairs specifically, prefer search_qa_library instead. Supports optional domain and workspace_id filters (AND logic when both provided). Valid domains: ${domainList}. Use the kb://taxonomy resource for the full subtopic list.`,
      inputSchema: {
        query: z
          .string()
          .describe('The search query — use natural language for best results'),
        limit: z
          .number()
          .optional()
          .describe(
            'Maximum number of results to return (default: 10, max: 50)',
          ),
        offset: z
          .number()
          .optional()
          .describe('Number of results to skip for pagination (default: 0)'),
        domain: z
          .string()
          .optional()
          .describe(
            `Filter results to a specific domain. Valid values: ${domainList}`,
          ),
        workspace_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Filter results to a specific workspace. Items matched via content_item_workspaces junction table.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const searchLimit = Math.min(args.limit ?? 10, 50);
        const searchOffset = args.offset ?? 0;

        // Generate embedding for semantic search (lazy-loaded to avoid cold start crash)
        const generateEmbedding = await getGenerateEmbedding();
        const embedding = await generateEmbedding(args.query.trim());

        // Over-fetch to support offset-based pagination (hybrid_search has no native offset)
        const { data: results, error } = await supabase.rpc('hybrid_search', {
          query_embedding: JSON.stringify(embedding),
          query_text: args.query.trim(),
          similarity_threshold: 0.3,
          limit_count: searchOffset + searchLimit + 1, // +1 to detect has_more
        });

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Search failed: ${error.message}. Try simplifying your query or removing filters.`,
              },
            ],
            isError: true,
          };
        }

        // Post-filter by domain if specified
        let filtered = results ?? [];
        if (args.domain) {
          const domainLower = args.domain.toLowerCase();
          filtered = filtered.filter((r: Record<string, unknown>) => {
            const domain = r.primary_domain as string | null;
            return domain && domain.toLowerCase().includes(domainLower);
          });
        }

        // Post-filter by workspace if specified (AND logic with domain filter)
        if (args.workspace_id) {
          const junctionResult = await tryQuery(
            supabase
              .from('content_item_workspaces')
              .select('content_item_id')
              .eq('workspace_id', args.workspace_id),
            'mcp.search.workspace_junction',
          );
          if (!junctionResult.ok) {
            console.warn(
              '[mcp.search.workspace_junction] degraded — no workspace filter applied:',
              junctionResult.error.message,
            );
          } else {
            const workspaceItemIds = new Set(
              (junctionResult.data ?? []).map(
                (row: { content_item_id: string }) => row.content_item_id,
              ),
            );
            filtered = filtered.filter((r: Record<string, unknown>) =>
              workspaceItemIds.has(r.id as string),
            );
          }
        }

        // Apply pagination via slice
        const totalFiltered = filtered.length;
        const hasMore = totalFiltered > searchOffset + searchLimit;
        const paged = filtered.slice(searchOffset, searchOffset + searchLimit);

        // Map to SearchResult type for formatting
        const searchResults: SearchResult[] = paged.map(
          (r: Record<string, unknown>) => ({
            id: r.id as string,
            title: r.title as string | null,
            suggested_title: r.suggested_title as string | null,
            content_type: r.content_type as string | null,
            primary_domain: r.primary_domain as string | null,
            primary_subtopic: r.primary_subtopic as string | null,
            summary: r.summary as string | null,
            similarity: r.similarity as number,
          }),
        );

        const markdown = truncateResponse(
          formatSearchResults(args.query, searchResults),
        );

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            query: args.query,
            offset: searchOffset,
            count: searchResults.length,
            has_more: hasMore,
            results: searchResults,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Search failed: ${message}. Try simplifying your query or removing filters.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 13. search_qa_library
  // -------------------------------------------------------------------------
  server.registerTool(
    'search_qa_library',
    {
      title: 'Search Q&A Library',
      description:
        'Search the Q&A library for reusable answers. Unlike search_knowledge_base which searches all content types, this tool filters to Q&A pairs only — ideal for finding existing answers to use in bid responses. Q&A pairs have standard and advanced answer levels. Use get_content_item to retrieve the full answer text after finding relevant pairs.',
      inputSchema: {
        query: z
          .string()
          .describe('The search query — use natural language for best results'),
        limit: z
          .number()
          .optional()
          .describe(
            'Maximum number of results to return (default: 10, max: 50)',
          ),
        offset: z
          .number()
          .optional()
          .describe('Number of results to skip for pagination (default: 0)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const searchLimit = Math.min(args.limit ?? 10, 50);
        const searchOffset = args.offset ?? 0;

        const generateEmbedding = await getGenerateEmbedding();
        const embedding = await generateEmbedding(args.query.trim());

        // Over-fetch to compensate for type filtering and support offset pagination
        const { data: results, error } = await supabase.rpc('hybrid_search', {
          query_embedding: JSON.stringify(embedding),
          query_text: args.query.trim(),
          similarity_threshold: 0.3,
          limit_count: (searchOffset + searchLimit) * 3 + 1, // Over-fetch for type filtering + pagination
        });

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Q&A search failed: ${error.message}. Try simplifying your query or removing filters.`,
              },
            ],
            isError: true,
          };
        }

        // Filter to Q&A pairs only, then apply pagination
        const allQaResults = (
          (results ?? []) as Record<string, unknown>[]
        ).filter((r) => r.content_type === 'q_a_pair');

        const hasMore = allQaResults.length > searchOffset + searchLimit;
        const paged = allQaResults.slice(
          searchOffset,
          searchOffset + searchLimit,
        );

        const qaResults: SearchResult[] = paged.map((r) => ({
          id: r.id as string,
          title: r.title as string | null,
          suggested_title: r.suggested_title as string | null,
          content_type: r.content_type as string | null,
          primary_domain: r.primary_domain as string | null,
          primary_subtopic: r.primary_subtopic as string | null,
          summary: r.summary as string | null,
          similarity: r.similarity as number,
        }));

        const markdown = formatQASearchResults(args.query, qaResults);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            query: args.query,
            offset: searchOffset,
            count: qaResults.length,
            has_more: hasMore,
            results: qaResults,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Q&A search failed: ${message}. Try simplifying your query or removing filters.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 20. find_similar_items
  // -------------------------------------------------------------------------
  server.registerTool(
    'find_similar_items',
    {
      title: 'Find Similar Items',
      description:
        'Find content items similar to a given item using vector cosine similarity. Useful for duplicate detection and related-content discovery. Items above 95% similarity are flagged as likely duplicates. Uses the existing embedding index — no AI cost.',
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe('The UUID of the content item to find similar items for'),
        threshold: z
          .number()
          .optional()
          .describe('Minimum cosine similarity (default: 0.8, range: 0.5–1.0)'),
        limit: z
          .number()
          .optional()
          .describe('Maximum results (default: 10, max: 25)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const threshold = Math.max(0.5, Math.min(1.0, args.threshold ?? 0.8));
        const resultLimit = Math.min(args.limit ?? 10, 25);

        // Fetch source item's embedding and title
        const { data: sourceItem, error: sourceError } = await supabase
          .from('content_items')
          .select('id, title, suggested_title, embedding')
          .eq('id', args.id)
          .single();

        if (sourceError || !sourceItem) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Content item not found: ${args.id}`,
              },
            ],
            isError: true,
          };
        }

        if (!sourceItem.embedding) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No embedding found for item ${args.id}. The item may not have been embedded yet.`,
              },
            ],
            isError: true,
          };
        }

        // Use the embedding to search for similar items
        const { data: results, error: searchError } = await supabase.rpc(
          'hybrid_search',
          {
            query_embedding:
              typeof sourceItem.embedding === 'string'
                ? sourceItem.embedding
                : JSON.stringify(sourceItem.embedding),
            query_text: '',
            similarity_threshold: threshold,
            limit_count: resultLimit + 1, // +1 to exclude self
          },
        );

        if (searchError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Similarity search failed: ${searchError.message}.`,
              },
            ],
            isError: true,
          };
        }

        // Filter out the source item itself
        const similar: SimilarItem[] = (
          (results ?? []) as Record<string, unknown>[]
        )
          .filter((r) => r.id !== args.id)
          .slice(0, resultLimit)
          .map((r) => ({
            id: r.id as string,
            title: r.title as string | null,
            suggested_title: r.suggested_title as string | null,
            content_type: r.content_type as string | null,
            primary_domain: r.primary_domain as string | null,
            similarity: r.similarity as number,
            likely_duplicate: (r.similarity as number) > 0.95,
          }));

        const sourceTitle =
          sourceItem.suggested_title || sourceItem.title || 'Untitled';
        const result: SimilarItemsResult = {
          source_item: { id: args.id, title: sourceTitle },
          similar_items: similar,
        };

        const markdown = truncateResponse(formatSimilarItems(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Similarity search failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 21. search_content_chunks
  // -------------------------------------------------------------------------
  server.registerTool(
    'search_content_chunks',
    {
      title: 'Search Content Chunks',
      description:
        'Search within content at the section level using semantic search. Returns individual sections (chunks) of documents rather than whole items, enabling fine-grained retrieval. Each chunk includes its heading path (breadcrumb) showing where it sits in the document structure. Useful for finding specific sections within long documents — e.g. "the Risk Assessment section of a health and safety policy". Use search_knowledge_base for whole-document search, use this for section-level precision.',
      inputSchema: {
        query: z
          .string()
          .describe('The search query — use natural language for best results'),
        limit: z
          .number()
          .optional()
          .describe(
            'Maximum number of chunk results to return (default: 10, max: 30)',
          ),
        content_item_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Optional: restrict search to chunks within a specific content item. Useful for navigating within a known document.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const searchLimit = Math.min(args.limit ?? 10, 30);

        const generateEmbedding = await getGenerateEmbedding();
        const embedding = await generateEmbedding(args.query.trim());

        const { data: results, error } = await supabase.rpc(
          'search_content_chunks',
          {
            query_embedding: JSON.stringify(embedding),
            similarity_threshold: 0.3,
            limit_count: searchLimit,
            filter_content_item_id: args.content_item_id ?? undefined,
          },
        );

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Chunk search failed: ${error.message}. Try simplifying your query.`,
              },
            ],
            isError: true,
          };
        }

        const chunkResults = (results ?? []) as ChunkSearchResult[];
        const markdown = truncateResponse(
          formatChunkSearchResults(args.query, chunkResults),
        );

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            query: args.query,
            count: chunkResults.length,
            content_item_id: args.content_item_id ?? null,
            results: chunkResults,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Chunk search failed: ${message}. Try simplifying your query.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
