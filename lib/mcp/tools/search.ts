/**
 * Search tool registrations (5 tools):
 *   1. search_knowledge_base
 *  13. search_qa_library
 *  20. find_similar_items          — LLM semantic-discovery (published-only default)
 *  20b. find_duplicate_candidates  — admin dedup workflow (admin default: every state)
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
  SearchResponseSchema,
  ChunkSearchResponseSchema,
} from '@/lib/mcp/formatters/search';
import {
  type ToolExtra,
  toStructuredContent,
  getGenerateEmbedding,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';
import { logger } from '@/lib/logger';

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
  defineTool(
    server,
    'search_knowledge_base',
    {
      title: 'Search Knowledge Base',
      description: `Search the knowledge base using semantic and keyword search. Returns content items matching your query, ranked by relevance. Use this to find articles, policies, case studies, Q&A pairs, and other knowledge base content. For Q&A pairs specifically, prefer search_qa_library instead. Supports optional domain and workspace_id filters (AND logic when both provided). Valid domains: ${domainList}. Use the kb://taxonomy resource for the full subtopic list.`,
      outputSchema: SearchResponseSchema,
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
        // §5.2 Phase 3 (S216 W3) — publication visibility filter.
        // Spec: docs/specs/publication-lifecycle-state-machine-spec.md §5.3.
        // 'default' (omitted) returns only published items. 'all' returns
        // draft + in_review + published (excludes archived). 'admin' returns
        // every state including archived. RPC-level filter; pass-through to
        // hybrid_search.visibility_filter param.
        visibility_filter: z
          .enum(['default', 'all', 'admin'])
          .optional()
          .describe(
            'Publication visibility filter. Omit (or "default") for published-only (live content). "all" returns draft + in_review + published (non-archived). "admin" returns every publication state. Default behaviour matches the prior pre-§5.2-Phase-3 search semantics.',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
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
          // §5.2 Phase 3 — pass-through. Omitted = 'default' (published-only)
          // by RPC default. `?? undefined` keeps payload clean (matches
          // existing convention used by search_content_chunks below).
          visibility_filter: args.visibility_filter ?? undefined,
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
            logger.warn(
              { err: junctionResult.error.message },
              '[mcp.search.workspace_junction] degraded — no workspace filter applied',
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
  defineTool(
    server,
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
        // §5.2 Phase 3 (S216 W3) — publication visibility filter.
        visibility_filter: z
          .enum(['default', 'all', 'admin'])
          .optional()
          .describe(
            'Publication visibility filter. Omit (or "default") for published-only (live content). "all" returns draft + in_review + published. "admin" returns every state.',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
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
          // §5.2 Phase 3 — pass-through.
          visibility_filter: args.visibility_filter ?? undefined,
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
        const allQaResults = (results ?? []).filter(
          (r) => r.content_type === 'q_a_pair',
        );

        const hasMore = allQaResults.length > searchOffset + searchLimit;
        const paged = allQaResults.slice(
          searchOffset,
          searchOffset + searchLimit,
        );

        const qaResults: SearchResult[] = paged.map((r) => ({
          id: r.id,
          title: r.title,
          suggested_title: r.suggested_title,
          content_type: r.content_type,
          primary_domain: r.primary_domain,
          primary_subtopic: r.primary_subtopic,
          summary: r.summary,
          similarity: r.similarity,
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
  // 20 / 20b. find_similar_items + find_duplicate_candidates
  //
  // Both tools share an implementation body (`findSimilarItemsImpl`) and
  // differ only by the visibility_filter default fed to `hybrid_search`.
  // Splitting the surface follows MCP best practice — one tool, one job —
  // so an LLM picks the right tool from name + description rather than a
  // hidden mode flag. Spec authority: archived
  // `.planning/.archive/.specs/publication-lifecycle-state-machine-spec.md`
  // §5.3.2 (S216 V_W3 audit deviation carried into S217).
  // -------------------------------------------------------------------------

  // Both tools share the same input contract; the `visibility_filter` param
  // remains overridable on both, with only the per-tool fallback differing
  // (handled inside `findSimilarItemsImpl`). The schema is inlined at each
  // `defineTool` call site rather than extracted to a shared const so
  // `scripts/lib/mcp-parser.ts` (which extracts inventory params via
  // `inputSchema: { ... }` literal-block matching) can resolve both tools'
  // params for `docs/generated/mcp-inventory.{md,json}`.
  type SimilarItemsArgs = {
    id: string;
    threshold?: number;
    limit?: number;
    visibility_filter?: 'default' | 'all' | 'admin';
  };

  /**
   * Shared implementation for `find_similar_items` and
   * `find_duplicate_candidates`. The only difference between the two tools
   * is `defaultVisibility`, applied when the caller omits
   * `args.visibility_filter`.
   */
  async function findSimilarItemsImpl(
    args: SimilarItemsArgs,
    extra: ToolExtra,
    defaultVisibility: 'default' | 'admin',
  ) {
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

      // Use the embedding to search for similar items.
      // §5.2 Phase 3 — pass-through. Caller-supplied filter wins; otherwise
      // the per-tool default (published-only for find_similar_items, every
      // state for find_duplicate_candidates) is sent to the RPC. We pass
      // `undefined` only when defaultVisibility itself is 'default' AND no
      // override is present — this preserves the existing JSON-RPC payload
      // shape used by other tools (no `null` values on the wire).
      const visibilityForRpc =
        args.visibility_filter ??
        (defaultVisibility === 'admin' ? 'admin' : undefined);

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
          visibility_filter: visibilityForRpc,
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
      const similar: SimilarItem[] = (results ?? [])
        .filter((r) => r.id !== args.id)
        .slice(0, resultLimit)
        .map((r) => ({
          id: r.id,
          title: r.title,
          suggested_title: r.suggested_title,
          content_type: r.content_type,
          primary_domain: r.primary_domain,
          similarity: r.similarity,
          likely_duplicate: r.similarity > 0.95,
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
  }

  // -------------------------------------------------------------------------
  // 20. find_similar_items — LLM semantic-discovery (published-only default)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'find_similar_items',
    {
      title: 'Find Similar Items',
      description:
        'Find published content items similar to a given item using vector cosine similarity. Use this for LLM semantic-discovery and related-content workflows where the caller wants live, citable knowledge-base material. Items above 95% similarity are flagged as likely duplicates. Uses the existing embedding index — no AI cost. For admin dedup workflows that need to match against draft, in_review, or archived siblings, use `find_duplicate_candidates` instead.',
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
        // §5.2 Phase 3 (S216 W3) — publication visibility filter.
        visibility_filter: z
          .enum(['default', 'all', 'admin'])
          .optional()
          .describe(
            'Publication visibility filter. Default: "default" (published-only — matches the LLM-discovery semantics of this tool). Override with "all" for draft + in_review + published or "admin" for every state including archived.',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) =>
      findSimilarItemsImpl(args as SimilarItemsArgs, extra, 'default'),
  );

  // -------------------------------------------------------------------------
  // 20b. find_duplicate_candidates — admin dedup workflow (every state default)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'find_duplicate_candidates',
    {
      title: 'Find Duplicate Candidates (Admin)',
      description:
        "Find content items similar to a given item across every publication state — draft, in_review, published, AND archived. Useful for admin dedup workflows where you need to detect duplicates of items that aren't (yet) published. Items above 95% similarity are flagged as likely duplicates. For LLM semantic discovery (published content only), use `find_similar_items`. Uses the existing embedding index — no AI cost.",
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
        // §5.2 Phase 3 (S216 W3) — publication visibility filter.
        visibility_filter: z
          .enum(['default', 'all', 'admin'])
          .optional()
          .describe(
            'Publication visibility filter. Default: "admin" (every state including archived — matches dedup-against-every-state semantics). Override with "default" for published-only or "all" for draft + in_review + published (non-archived).',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) =>
      findSimilarItemsImpl(args as SimilarItemsArgs, extra, 'admin'),
  );

  // -------------------------------------------------------------------------
  // 21. search_content_chunks
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'search_content_chunks',
    {
      title: 'Search Content Chunks',
      outputSchema: ChunkSearchResponseSchema,
      description:
        'Search within content at the section level using semantic search. Returns individual sections (chunks) of documents rather than whole items, enabling fine-grained retrieval. Each chunk includes its heading path (breadcrumb) showing where it sits in the document structure. Useful for finding specific sections within long documents — e.g. "the Risk Assessment section of a health and safety policy". Use search_knowledge_base for whole-document search, use this for section-level precision. Optional review-cadence filters (`overdue_review`, `review_due_within_days`) restrict results to chunks from items with active document-control review obligations.',
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
        // §5.5 Phase 4 — review-cadence filters (S208 WP1)
        // Spec: docs/specs/p0-document-control-lifecycle-spec.md §8.2
        // Both pass through to the RPC's filter_overdue_review +
        // filter_review_due_within_days params (Option A — RPC-level filter
        // via existing JOIN, zero round-trip cost).
        overdue_review: z
          .boolean()
          .optional()
          .describe(
            'If true, only return chunks from content items that are overdue for review (governance_review_status = "review_overdue"). If false, exclude overdue items (return only items not in "review_overdue" status). Omit (undefined) for no filter.',
          ),
        review_due_within_days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe(
            'Only return chunks from content items whose next_review_date is within this many days from today. Useful for finding items approaching their review date.',
          ),
        // §5.2 Phase 3 (S216 W3) — publication visibility filter.
        // Orthogonal to the §5.5 review-cadence filters above — both axes
        // can be combined (e.g. visibility_filter='all' + overdue_review=true
        // returns chunks from non-archived items overdue for review,
        // including drafts).
        visibility_filter: z
          .enum(['default', 'all', 'admin'])
          .optional()
          .describe(
            'Publication visibility filter. Omit (or "default") for published-only chunks. "all" returns chunks from draft + in_review + published items. "admin" returns every state including archived. Orthogonal to overdue_review and review_due_within_days.',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
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
            // §5.5 Phase 4 — pass-through to the new RPC params. `?? undefined`
            // keeps the JSON-RPC payload free of `null` values (matches the
            // existing `filter_content_item_id` convention and the
            // search-chunks-tool.test.ts assertion that null-omits send
            // `undefined`, not `null`).
            filter_overdue_review: args.overdue_review ?? undefined,
            filter_review_due_within_days:
              args.review_due_within_days ?? undefined,
            // §5.2 Phase 3 — visibility filter pass-through. Omitted = 'default'
            // (published-only) by RPC default.
            visibility_filter: args.visibility_filter ?? undefined,
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
            // §5.5 Phase 4 — surface the review-cadence filters so callers
            // can trace which slice of the index they're looking at.
            // `null` (not `undefined`) when omitted to match the existing
            // `content_item_id` convention.
            overdue_review_filter: args.overdue_review ?? null,
            review_due_within_days_filter: args.review_due_within_days ?? null,
            // §5.2 Phase 3 — surface visibility filter for trace-ability.
            visibility_filter: args.visibility_filter ?? 'default',
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
