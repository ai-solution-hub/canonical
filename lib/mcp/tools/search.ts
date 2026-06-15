/**
 * Search tool registrations (3 tools):
 *   1.  find                       — ONE outcome-shaped entry (ID-71.7, M27/M33/M37,
 *                                     B-INV-27/B-INV-33). Collapses the former search
 *                                     trio (search_knowledge_base / search_qa_library /
 *                                     search_content_chunks) + find_similar_items into
 *                                     `type` / `scope` / `granularity` / `similar_to`
 *                                     branches. Preserves the two-step list/preview →
 *                                     verbatim-on-accept retrieval contract (B-INV-33);
 *                                     declares an `outputSchema` (M37).
 *   20b. find_duplicate_candidates — admin dedup workflow (admin default: every state).
 *                                     NOT consolidated here — dedup consolidation is a
 *                                     later slice (M32 / {71.10}); it continues to share
 *                                     `findSimilarItemsImpl` with `find`'s similar_to
 *                                     branch.
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
import { FindResponseSchema } from '@/lib/mcp/formatters/search';
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
  // Internal: item-granularity search (whole-item). Substrate for `find`'s
  // default (`granularity: 'item'`) branch — collapses the former
  // `search_knowledge_base` + `search_qa_library` registrations. The `type`
  // param reproduces `search_qa_library` (q_a_pair corpus filter); `scope`
  // reproduces `search_knowledge_base`'s `domain` corpus filter.
  // -------------------------------------------------------------------------
  async function runItemSearch(
    args: {
      query: string;
      limit?: number;
      offset?: number;
      scope?: string;
      type?: string;
      workspace_id?: string;
      visibility_filter?: 'default' | 'all' | 'admin';
    },
    extra: ToolExtra,
  ) {
    try {
      const supabase = createMcpClient(extra.authInfo);
      const searchLimit = Math.min(args.limit ?? 10, 50);
      const searchOffset = args.offset ?? 0;
      // A content-type filter (e.g. type='q_a_pair') over-fetches like the
      // former search_qa_library so the type slice survives pagination.
      const overFetch = args.type
        ? (searchOffset + searchLimit) * 3 + 1
        : searchOffset + searchLimit + 1; // +1 to detect has_more

      // Generate embedding for semantic search (lazy-loaded to avoid cold start crash)
      const generateEmbedding = await getGenerateEmbedding();
      const embedding = await generateEmbedding(args.query.trim());

      const { data: results, error } = await supabase.rpc('hybrid_search', {
        query_embedding: JSON.stringify(embedding),
        query_text: args.query.trim(),
        similarity_threshold: 0.3,
        limit_count: overFetch,
        // §5.2 Phase 3 — pass-through. Omitted = 'default' (published-only)
        // by RPC default. `?? undefined` keeps payload clean.
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

      let filtered = results ?? [];

      // type filter — preserves the former search_qa_library semantics
      // (content_type corpus slice; q_a_pair is the canonical case).
      if (args.type) {
        filtered = filtered.filter(
          (r: Record<string, unknown>) => r.content_type === args.type,
        );
      }

      // scope filter — preserves the former search_knowledge_base `domain`
      // corpus filter (scope_tag semantics).
      if (args.scope) {
        const scopeLower = args.scope.toLowerCase();
        filtered = filtered.filter((r: Record<string, unknown>) => {
          const domain = r.primary_domain as string | null;
          return domain && domain.toLowerCase().includes(scopeLower);
        });
      }

      // Post-filter by workspace if specified (AND logic with scope/type)
      if (args.workspace_id) {
        const junctionResult = await tryQuery(
          supabase
            .from('content_item_workspaces')
            .select('content_item_id')
            .eq('workspace_id', args.workspace_id),
          'mcp.find.workspace_junction',
        );
        if (!junctionResult.ok) {
          logger.warn(
            { err: junctionResult.error.message },
            '[mcp.find.workspace_junction] degraded — no workspace filter applied',
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

      // Map to SearchResult type for formatting — list/preview metadata only;
      // verbatim fetch is the caller's follow-up get_content_item step (B-INV-33).
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

      // q_a_pair callers get the Q&A-styled markdown; otherwise the general
      // search markdown — both preserved verbatim from the retired trio.
      const markdown = truncateResponse(
        args.type === 'q_a_pair'
          ? formatQASearchResults(args.query, searchResults)
          : formatSearchResults(args.query, searchResults),
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
  }

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
  // 20b. find_duplicate_candidates — admin dedup workflow (every state default)
  //
  // LLM semantic-discovery (published-only similar items) is now served by the
  // consolidated `find` tool's `similar_to` branch (ID-71.7). This admin-dedup
  // surface is NOT consolidated here — dedup consolidation is a later slice
  // (M32 / {71.10}). It continues to share `findSimilarItemsImpl` with `find`.
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'find_duplicate_candidates',
    {
      title: 'Find Duplicate Candidates (Admin)',
      description:
        "Find content items similar to a given item across every publication state — draft, in_review, published, AND archived. Useful for admin dedup workflows where you need to detect duplicates of items that aren't (yet) published. Items above 95% similarity are flagged as likely duplicates. For LLM semantic discovery (published content only), use the `find` tool with the `similar_to` parameter. Uses the existing embedding index — no AI cost.",
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
  // Internal: chunk-granularity search (section-level). Substrate for `find`'s
  // `granularity: 'chunk'` branch — collapses the former
  // `search_content_chunks` registration. Returns chunk previews (truncated
  // excerpts), preserving the section-level two-step retrieval contract.
  // -------------------------------------------------------------------------
  async function runChunkSearch(
    args: {
      query: string;
      limit?: number;
      content_item_id?: string;
      overdue_review?: boolean;
      review_due_within_days?: number;
      visibility_filter?: 'default' | 'all' | 'admin';
    },
    extra: ToolExtra,
  ) {
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
          // §5.5 Phase 4 — pass-through to the RPC params. `?? undefined`
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
  }

  // -------------------------------------------------------------------------
  // 1. find — ONE outcome-shaped entry (ID-71.7, M27/M33/M37, B-INV-27/33).
  //
  // Collapses the former search trio + find_similar_items. Branch selection:
  //   - `similar_to` present  → vector similar-items discovery (reuses the
  //     shared findSimilarItemsImpl, published-only default).
  //   - `granularity: 'chunk'`→ section-level chunk search (runChunkSearch).
  //   - otherwise (item)      → whole-item search (runItemSearch), with `type`
  //     reproducing the q_a_pair corpus slice and `scope` the domain corpus
  //     filter.
  //
  // Two-step retrieval (B-INV-33): `find` returns list/preview metadata (and
  // chunk excerpts) only — never verbatim item bodies; the caller's follow-up
  // get_content_item step fetches verbatim content on accept. Declares an
  // outputSchema (M37) — the union of the three branch envelopes.
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'find',
    {
      title: 'Find Knowledge',
      description: `Find content in the knowledge base — the single entry for search, Q&A lookup, section-level retrieval, and similar-item discovery. Returns ranked list/preview metadata (title, domain, summary, relevance); use get_content_item afterwards to fetch the verbatim content of an accepted result. Parameters: \`granularity\` ('item' default | 'chunk' for section-level breadcrumbs); \`type\` filters by content type (e.g. 'q_a_pair' to find reusable answers); \`scope\` filters by domain corpus (valid domains: ${domainList} — use the kb://taxonomy resource for the full subtopic list); \`similar_to\` finds published items similar to a given item id via vector cosine similarity (items above 95% similarity flagged as likely duplicates).`,
      outputSchema: FindResponseSchema,
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'The search query — use natural language for best results. Required unless `similar_to` is supplied.',
          ),
        granularity: z
          .enum(['item', 'chunk'])
          .optional()
          .describe(
            "Retrieval granularity. 'item' (default) returns whole content items. 'chunk' returns individual document sections with heading-path breadcrumbs — fine-grained retrieval for finding a specific section within a long document.",
          ),
        type: z
          .string()
          .optional()
          .describe(
            "Filter results to a specific content type. Use 'q_a_pair' to find reusable Q&A answers (replaces the former Q&A library search). Applies to item granularity.",
          ),
        scope: z
          .string()
          .optional()
          .describe(
            `Filter results to a specific domain corpus. Valid values: ${domainList}. Applies to item granularity.`,
          ),
        similar_to: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Find published items similar to this content item id via vector cosine similarity (no AI cost). When set, `query`/`scope`/`type`/`granularity` are ignored. Items above 95% similarity are flagged as likely duplicates.',
          ),
        threshold: z
          .number()
          .optional()
          .describe(
            'For `similar_to`: minimum cosine similarity (default: 0.8, range: 0.5–1.0).',
          ),
        limit: z
          .number()
          .optional()
          .describe(
            'Maximum number of results (item: default 10/max 50; chunk: default 10/max 30; similar_to: default 10/max 25).',
          ),
        offset: z
          .number()
          .optional()
          .describe(
            'Number of results to skip for pagination (default: 0). Applies to item granularity.',
          ),
        workspace_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Filter results to a specific workspace (item granularity). Items matched via the content_item_workspaces junction table.',
          ),
        content_item_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'For chunk granularity: restrict search to chunks within a specific content item. Useful for navigating within a known document.',
          ),
        overdue_review: z
          .boolean()
          .optional()
          .describe(
            'Chunk granularity review-cadence filter. If true, only return chunks from content items overdue for review; if false, exclude overdue items. Omit for no filter.',
          ),
        review_due_within_days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe(
            'Chunk granularity review-cadence filter. Only return chunks from content items whose next_review_date is within this many days from today.',
          ),
        visibility_filter: z
          .enum(['default', 'all', 'admin'])
          .optional()
          .describe(
            'Publication visibility filter. Omit (or "default") for published-only (live content). "all" returns draft + in_review + published (non-archived). "admin" returns every publication state including archived.',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      // Branch 1 — vector similar-items discovery (former find_similar_items).
      if (args.similar_to) {
        return findSimilarItemsImpl(
          {
            id: args.similar_to,
            threshold: args.threshold,
            limit: args.limit,
            visibility_filter: args.visibility_filter,
          },
          extra,
          'default',
        );
      }

      // `query` is required for the search branches (it is optional in the
      // schema only so `similar_to` can be supplied alone).
      if (!args.query || args.query.trim().length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'A `query` is required unless `similar_to` is supplied. Provide a natural-language query, or pass `similar_to` with a content item id.',
            },
          ],
          isError: true,
        };
      }

      // Branch 2 — section-level chunk search (former search_content_chunks).
      if (args.granularity === 'chunk') {
        return runChunkSearch(
          {
            query: args.query,
            limit: args.limit,
            content_item_id: args.content_item_id,
            overdue_review: args.overdue_review,
            review_due_within_days: args.review_due_within_days,
            visibility_filter: args.visibility_filter,
          },
          extra,
        );
      }

      // Branch 3 (default) — whole-item search (former search_knowledge_base +
      // search_qa_library, with the q_a_pair slice driven by `type`).
      return runItemSearch(
        {
          query: args.query,
          limit: args.limit,
          offset: args.offset,
          scope: args.scope,
          type: args.type,
          workspace_id: args.workspace_id,
          visibility_filter: args.visibility_filter,
        },
        extra,
      );
    },
  );
}
