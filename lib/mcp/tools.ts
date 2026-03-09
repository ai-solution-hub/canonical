/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 5 core tools:
 *   1. search_knowledge_base — Semantic + keyword search across all KB content
 *   2. get_dashboard_summary — Overview of KB health and attention items
 *   3. list_active_bids — Active bids with status, progress, and deadlines
 *   4. get_content_item — Retrieve a specific content item by ID
 *   5. get_reorientation — Personal briefing on what changed and what needs attention
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServiceClient } from '@/lib/mcp/auth';
import { generateEmbedding } from '@/lib/ai/embed';
import { fetchDashboardData } from '@/lib/dashboard';
import { fetchActiveBidsWithStats } from '@/lib/bid-queries';
import { fetchReorientData } from '@/lib/reorient';
import { getDeadlineUrgency, getDaysUntilDeadline } from '@/lib/dashboard';
import {
  formatSearchResults,
  formatDashboardSummary,
  formatActiveBids,
  formatContentItem,
  formatReorientation,
} from '@/lib/mcp/formatters';
import type { SearchResult, ContentItemDetail } from '@/lib/mcp/formatters';
import type { ActiveBidSummary } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Placeholder admin user ID for MVP (service-role queries).
 * When OAuth is added, this will be replaced with the authenticated user's ID.
 */
const MCP_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Helper — safely convert typed objects to structuredContent
// ---------------------------------------------------------------------------

/**
 * The MCP SDK requires structuredContent to have a `[x: string]: unknown`
 * index signature. This helper performs a safe cast via JSON round-trip.
 */
function toStructuredContent(data: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // 1. search_knowledge_base
  // -------------------------------------------------------------------------
  server.registerTool(
    'search_knowledge_base',
    {
      description: 'Search the knowledge base using semantic and keyword search. Returns content items matching your query, ranked by relevance. Use this to find articles, policies, case studies, Q&A pairs, and other knowledge base content.',
      inputSchema: {
        query: z.string().describe('The search query — use natural language for best results'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 10, max: 50)'),
        domain: z.string().optional().describe('Filter results to a specific domain (e.g. "Security", "Construction", "HR")'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const supabase = createMcpServiceClient();
        const searchLimit = Math.min(args.limit ?? 10, 50);

        // Generate embedding for semantic search
        const embedding = await generateEmbedding(args.query.trim());

        // Call hybrid_search RPC (embedding must be JSON-stringified for vector params)
        const { data: results, error } = await supabase.rpc('hybrid_search', {
          query_embedding: JSON.stringify(embedding),
          query_text: args.query.trim(),
          similarity_threshold: 0.3,
          limit_count: searchLimit,
        });

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Search failed: ${error.message}` }],
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

        // Map to SearchResult type for formatting
        const searchResults: SearchResult[] = filtered.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          title: r.title as string | null,
          suggested_title: r.suggested_title as string | null,
          content_type: r.content_type as string | null,
          primary_domain: r.primary_domain as string | null,
          primary_subtopic: r.primary_subtopic as string | null,
          ai_summary: r.ai_summary as string | null,
          similarity: r.similarity as number,
        }));

        const markdown = formatSearchResults(args.query, searchResults);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            query: args.query,
            count: searchResults.length,
            results: searchResults,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Search failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 2. get_dashboard_summary
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_dashboard_summary',
    {
      description: 'Get an overview of the knowledge base health including items needing attention, content freshness breakdown, active bids, and recent activity. Use this to understand the current state of the knowledge base at a glance.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const supabase = createMcpServiceClient();
        const data = await fetchDashboardData(supabase, MCP_ADMIN_USER_ID, true, 'admin');
        const markdown = formatDashboardSummary(data);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Dashboard query failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 3. list_active_bids
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_active_bids',
    {
      description: 'List all active (non-archived) bids with their status, buyer, deadline, and question completion progress. Use this to see which bids are in progress and which need attention.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const supabase = createMcpServiceClient();
        const { workspaces, statsMap } = await fetchActiveBidsWithStats(supabase);

        // Map to ActiveBidSummary type
        const bids: ActiveBidSummary[] = workspaces.map((workspace) => {
          const meta = workspace.domain_metadata as Record<string, unknown> | null;
          const stats = statsMap.get(workspace.id);
          const deadline = (meta?.deadline as string) ?? null;

          return {
            id: workspace.id,
            name: workspace.name ?? 'Untitled Bid',
            buyer: (meta?.buyer as string) ?? null,
            status: (meta?.status as string) ?? 'draft',
            deadline,
            days_until_deadline: getDaysUntilDeadline(deadline),
            total_questions: stats?.total_questions ?? 0,
            answered_questions: (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0),
            approved_questions: stats?.complete_count ?? 0,
          };
        });

        // Sort by deadline urgency
        const urgencyOrder: Record<string, number> = {
          overdue: 0, urgent: 1, approaching: 2, normal: 3, unknown: 4,
        };
        bids.sort((a, b) => {
          const aUrgency = urgencyOrder[getDeadlineUrgency(a.deadline)] ?? 4;
          const bUrgency = urgencyOrder[getDeadlineUrgency(b.deadline)] ?? 4;
          return aUrgency - bUrgency;
        });

        const markdown = formatActiveBids(bids);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({ count: bids.length, bids }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to list bids: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 4. get_content_item
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_content_item',
    {
      description: 'Retrieve a specific content item from the knowledge base by its ID. Returns the full item including title, type, domain, summary, keywords, freshness status, and content text. Use this after searching to get the complete details of a specific item.',
      inputSchema: {
        id: z.string().describe('The UUID of the content item to retrieve'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const supabase = createMcpServiceClient();

        const { data: item, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_summary, ai_keywords, freshness, classification_confidence, source_url, content, created_at, updated_at, governance_review_status, priority',
          )
          .eq('id', args.id)
          .single();

        if (error || !item) {
          return {
            content: [{ type: 'text' as const, text: `Content item not found: ${args.id}` }],
            isError: true,
          };
        }

        const itemDetail: ContentItemDetail = {
          id: item.id,
          title: item.title,
          suggested_title: item.suggested_title,
          content_type: item.content_type,
          primary_domain: item.primary_domain,
          primary_subtopic: item.primary_subtopic,
          ai_summary: item.ai_summary,
          ai_keywords: item.ai_keywords,
          freshness: item.freshness,
          classification_confidence: item.classification_confidence,
          source_url: item.source_url,
          content: item.content,
          created_at: item.created_at,
          updated_at: item.updated_at,
          governance_review_status: item.governance_review_status,
          priority: item.priority,
        };

        const markdown = formatContentItem(itemDetail);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(item),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to retrieve content item: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 5. get_reorientation
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_reorientation',
    {
      description: 'Get a personal briefing on what has changed in the knowledge base since your last visit. Includes urgent items needing attention, team activity, your recent work, and active bid status. Use this to quickly catch up on what happened while you were away.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const supabase = createMcpServiceClient();
        const data = await fetchReorientData(supabase, MCP_ADMIN_USER_ID, true, 'admin');
        const markdown = formatReorientation(data);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Reorientation briefing failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
