/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 13 tools:
 *   1. search_knowledge_base — Semantic + keyword search across all KB content
 *   2. get_dashboard_summary — Overview of KB health and attention items
 *   3. list_active_bids — Active bids with status, progress, and deadlines
 *   4. get_content_item — Retrieve a specific content item by ID
 *   5. get_reorientation — Personal briefing on what changed and what needs attention
 *   6. get_bid_detail — Bid with questions, responses, progress, and gaps
 *   7. get_bid_question — Specific question with response and confidence
 *   8. get_quality_summary — Quality issue counts and breakdown
 *   9. get_freshness_report — Content freshness breakdown
 *  10. classify_content — Trigger AI classification of an item (editor+)
 *  11. generate_summary — Generate AI summary for an item (editor+)
 *  12. create_content_item — Create a new KB content item (editor+)
 *  13. search_qa_library — Search Q&A pairs specifically
 *
 * All tools use per-user Supabase clients via extra.authInfo so that
 * RLS policies are applied based on the authenticated user.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { createMcpClient, getMcpUserId, getMcpUserRole, checkMcpRole } from '@/lib/mcp/auth';
import { generateEmbedding } from '@/lib/ai/embed';
import { classifyContent } from '@/lib/ai/classify';
import { generateSummary } from '@/lib/ai/summarise';
import { fetchDashboardData } from '@/lib/dashboard';
import { fetchActiveBidsWithStats } from '@/lib/bid-queries';
import { fetchReorientData } from '@/lib/reorient';
import { getDeadlineUrgency, getDaysUntilDeadline } from '@/lib/dashboard';
import { AIServiceError } from '@/lib/ai/errors';
import {
  formatSearchResults,
  formatDashboardSummary,
  formatActiveBids,
  formatContentItem,
  formatReorientation,
  formatBidDetail,
  formatBidQuestion,
  formatQualitySummary,
  formatFreshnessReport,
  formatClassification,
  formatSummaryResult,
  formatCreatedItem,
  formatQASearchResults,
} from '@/lib/mcp/formatters';
import type {
  SearchResult,
  ContentItemDetail,
  BidDetail,
  BidQuestionDetail,
  QualitySummary,
  FreshnessReport,
  CreatedItem,
} from '@/lib/mcp/formatters';
import type { ActiveBidSummary } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Type alias for the extra parameter in tool callbacks
// ---------------------------------------------------------------------------

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

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
      title: 'Search Knowledge Base',
      description: 'Search the knowledge base using semantic and keyword search. Returns content items matching your query, ranked by relevance. Use this to find articles, policies, case studies, Q&A pairs, and other knowledge base content.',
      inputSchema: {
        query: z.string().describe('The search query — use natural language for best results'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 10, max: 50)'),
        offset: z.number().optional().describe('Number of results to skip for pagination (default: 0)'),
        domain: z.string().optional().describe('Filter results to a specific domain (e.g. "Security", "Construction", "HR")'),
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

        // Generate embedding for semantic search
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
            content: [{ type: 'text' as const, text: `Search failed: ${error.message}. Try simplifying your query or removing filters.` }],
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

        // Apply pagination via slice
        const totalFiltered = filtered.length;
        const hasMore = totalFiltered > searchOffset + searchLimit;
        const paged = filtered.slice(searchOffset, searchOffset + searchLimit);

        // Map to SearchResult type for formatting
        const searchResults: SearchResult[] = paged.map((r: Record<string, unknown>) => ({
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
            offset: searchOffset,
            count: searchResults.length,
            has_more: hasMore,
            results: searchResults,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Search failed: ${message}. Try simplifying your query or removing filters.` }],
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
      title: 'Dashboard Summary',
      description: 'Get an overview of the knowledge base health including items needing attention, content freshness breakdown, active bids, and recent activity. Use this to understand the current state of the knowledge base at a glance.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const data = await fetchDashboardData(supabase, userId, isAdmin, role);
        const markdown = formatDashboardSummary(data);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Dashboard query failed: ${message}. The database function may be temporarily unavailable.` }],
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
      title: 'List Active Bids',
      description: 'List all active (non-archived) bids with their status, buyer, deadline, and question completion progress. Use this to see which bids are in progress and which need attention.',
      inputSchema: {
        limit: z.number().optional().describe('Maximum number of bids to return (default: 20, max: 50)'),
        offset: z.number().optional().describe('Number of bids to skip for pagination (default: 0)'),
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
        const bidLimit = Math.min(args.limit ?? 20, 50);
        const bidOffset = args.offset ?? 0;
        const { workspaces, statsMap } = await fetchActiveBidsWithStats(supabase);

        // Map to ActiveBidSummary type
        const allBids: ActiveBidSummary[] = workspaces.map((workspace) => {
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
        allBids.sort((a, b) => {
          const aUrgency = urgencyOrder[getDeadlineUrgency(a.deadline)] ?? 4;
          const bUrgency = urgencyOrder[getDeadlineUrgency(b.deadline)] ?? 4;
          return aUrgency - bUrgency;
        });

        // Apply pagination
        const totalCount = allBids.length;
        const hasMore = totalCount > bidOffset + bidLimit;
        const bids = allBids.slice(bidOffset, bidOffset + bidLimit);

        const markdown = formatActiveBids(bids);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            offset: bidOffset,
            count: bids.length,
            total_count: totalCount,
            has_more: hasMore,
            bids,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to list bids: ${message}. Try simplifying your query or removing filters.` }],
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
      title: 'Get Content Item',
      description: 'Retrieve a specific content item from the knowledge base by its ID. Returns the full item including title, type, domain, summary, keywords, freshness status, and content text. Use this after searching to get the complete details of a specific item.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the content item to retrieve'),
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
          content: [{ type: 'text' as const, text: `Failed to retrieve content item: ${message}. Check the ID is a valid UUID.` }],
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
      title: 'Reorientation Briefing',
      description: 'Get a personal briefing on what has changed in the knowledge base since your last visit. Includes urgent items needing attention, team activity, your recent work, and active bid status. Use this to quickly catch up on what happened while you were away.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const data = await fetchReorientData(supabase, userId, isAdmin, role);
        const markdown = formatReorientation(data);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Reorientation briefing failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 6. get_bid_detail
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_bid_detail',
    {
      title: 'Get Bid Detail',
      description: 'Get detailed information about a specific bid including buyer, deadline, status, and question completion progress. Use this after listing bids to drill into a specific one.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the bid workspace'),
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

        // Fetch workspace
        const { data: workspace, error: wsError } = await supabase
          .from('workspaces')
          .select('id, name, description, domain_metadata, is_archived')
          .eq('id', args.id)
          .eq('type', 'bid')
          .single();

        if (wsError || !workspace) {
          return {
            content: [{ type: 'text' as const, text: `Bid not found: ${args.id}` }],
            isError: true,
          };
        }

        // Fetch question stats
        const { data: stats } = await supabase.rpc('get_bid_question_stats', {
          p_project_id: args.id,
        });

        const meta = workspace.domain_metadata as Record<string, unknown> | null;
        const bidDetail: BidDetail = {
          id: workspace.id,
          name: workspace.name ?? 'Untitled Bid',
          buyer: (meta?.buyer as string) ?? null,
          status: (meta?.status as string) ?? 'draft',
          deadline: (meta?.deadline as string) ?? null,
          reference_number: (meta?.reference_number as string) ?? null,
          description: workspace.description,
          question_stats: stats?.[0] ?? null,
        };

        const markdown = formatBidDetail(bidDetail);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(bidDetail),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to get bid detail: ${message}. Check the ID is a valid UUID.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 7. get_bid_question
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_bid_question',
    {
      title: 'Get Bid Question',
      description: 'Get a specific bid question with its response text, confidence posture, and review status. Use this to see the detail of a particular question within a bid.',
      inputSchema: {
        question_id: z.string().uuid().describe('The UUID of the bid question'),
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

        // Fetch question
        const { data: question, error: qError } = await supabase
          .from('bid_questions')
          .select('id, question_text, section_name, word_limit, confidence_posture, status')
          .eq('id', args.question_id)
          .single();

        if (qError || !question) {
          return {
            content: [{ type: 'text' as const, text: `Question not found: ${args.question_id}` }],
            isError: true,
          };
        }

        // Fetch response if exists
        const { data: response } = await supabase
          .from('bid_responses')
          .select('response_text, review_status')
          .eq('question_id', args.question_id)
          .single();

        const detail: BidQuestionDetail = {
          id: question.id,
          question_text: question.question_text,
          section_name: question.section_name,
          word_limit: question.word_limit,
          confidence_posture: question.confidence_posture,
          status: question.status,
          response_text: response?.response_text ?? null,
          review_status: response?.review_status ?? null,
        };

        const markdown = formatBidQuestion(detail);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(detail),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to get bid question: ${message}. Check the ID is a valid UUID.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 8. get_quality_summary
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_quality_summary',
    {
      title: 'Quality Summary',
      description: 'Get a summary of open quality issues in the knowledge base, grouped by type and severity. Use this to understand what content quality problems need attention.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { data: details, error } = await supabase.rpc('get_quality_issue_counts');

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Quality query failed: ${error.message}` }],
            isError: true,
          };
        }

        const rows = (details ?? []) as Array<{ flag_type: string; severity: string; open_count: number }>;
        const totalOpen = rows.reduce((sum, r) => sum + Number(r.open_count), 0);
        const byType: Record<string, number> = {};
        for (const r of rows) {
          byType[r.flag_type] = (byType[r.flag_type] ?? 0) + Number(r.open_count);
        }

        const summary: QualitySummary = { total_open: totalOpen, by_type: byType, details: rows };
        const markdown = formatQualitySummary(summary);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(summary),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Quality query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 9. get_freshness_report
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_freshness_report',
    {
      title: 'Freshness Report',
      description: 'Get a breakdown of content freshness across the knowledge base — how many items are fresh, aging, stale, or expired. Use this to understand the health of your content.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { data: rows, error } = await supabase.rpc('get_freshness_breakdown');

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Freshness query failed: ${error.message}` }],
            isError: true,
          };
        }

        const report: FreshnessReport = { fresh: 0, aging: 0, stale: 0, expired: 0 };
        for (const row of (rows ?? []) as Array<{ freshness: string; count: number }>) {
          const key = row.freshness as keyof FreshnessReport;
          if (key in report) {
            report[key] = Number(row.count);
          }
        }

        const markdown = formatFreshnessReport(report);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(report),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Freshness query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 10. classify_content (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'classify_content',
    {
      title: 'Classify Content',
      description: 'Trigger AI classification of a content item. Assigns domain, subtopic, keywords, summary, and a suggested title. Requires editor or admin role.',
      inputSchema: {
        item_id: z.string().uuid().describe('The UUID of the content item to classify'),
        force: z.boolean().optional().describe('Re-classify even if already classified (default: false)'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [{ type: 'text' as const, text: 'Permission denied: editor or admin role required.' }],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const result = await classifyContent({
          supabase,
          itemId: args.item_id,
          force: args.force ?? false,
          userId,
        });

        const markdown = formatClassification(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof AIServiceError ? err.message : (err instanceof Error ? err.message : 'Unknown error');
        return {
          content: [{ type: 'text' as const, text: `Classification failed: ${message}. Ensure you have editor or admin permissions.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 11. generate_summary (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'generate_summary',
    {
      title: 'Generate Summary',
      description: 'Generate an AI summary for a content item including executive summary, detailed summary, and key takeaways. Requires editor or admin role.',
      inputSchema: {
        item_id: z.string().uuid().describe('The UUID of the content item to summarise'),
        force: z.boolean().optional().describe('Regenerate even if summary exists (default: false)'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [{ type: 'text' as const, text: 'Permission denied: editor or admin role required.' }],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const result = await generateSummary({
          supabase,
          itemId: args.item_id,
          force: args.force ?? false,
          userId,
        });

        const markdown = formatSummaryResult(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof AIServiceError ? err.message : (err instanceof Error ? err.message : 'Unknown error');
        return {
          content: [{ type: 'text' as const, text: `Summary generation failed: ${message}. Ensure you have editor or admin permissions.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 12. create_content_item (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_content_item',
    {
      title: 'Create Content Item',
      description: 'Create a new content item in the knowledge base. Requires editor or admin role. The item will be automatically embedded for search.',
      inputSchema: {
        title: z.string().min(1).max(500).describe('Title of the content item'),
        content: z.string().min(1).max(500000).describe('The content text'),
        content_type: z.enum([
          'article', 'blog', 'pdf', 'note', 'research', 'other',
          'q_a_pair', 'case_study', 'policy', 'certification',
          'compliance', 'methodology', 'capability', 'product_description',
        ]).describe('Type of content'),
        primary_domain: z.string().optional().describe('Primary domain category'),
        primary_subtopic: z.string().optional().describe('Primary subtopic'),
        priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [{ type: 'text' as const, text: 'Permission denied: editor or admin role required.' }],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);

        // Generate embedding for search
        let embedding: number[] | null = null;
        try {
          embedding = await generateEmbedding(args.title + ' ' + args.content.slice(0, 5000));
        } catch {
          // Embedding failure is non-fatal — item is still created
        }

        const insertData: Record<string, unknown> = {
          title: args.title,
          suggested_title: args.title,
          content: args.content,
          content_type: args.content_type,
          platform: 'manual',
          captured_date: new Date().toISOString(),
          created_by: userId,
          ...(args.primary_domain && { primary_domain: args.primary_domain }),
          ...(args.primary_subtopic && { primary_subtopic: args.primary_subtopic }),
          ...(args.priority && { priority: args.priority }),
          ...(embedding && { embedding: JSON.stringify(embedding) }),
        };

        const { data: item, error } = await supabase
          .from('content_items')
          .insert(insertData as never)
          .select('id, title, content_type')
          .single();

        if (error || !item) {
          return {
            content: [{ type: 'text' as const, text: `Failed to create item: ${error?.message ?? 'Unknown error'}` }],
            isError: true,
          };
        }

        const created: CreatedItem = {
          id: item.id,
          title: item.title ?? args.title,
          content_type: item.content_type ?? args.content_type,
        };

        const markdown = formatCreatedItem(created);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(created),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to create item: ${message}. Ensure you have editor or admin permissions.` }],
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
      description: 'Search the Q&A library specifically. Returns Q&A pairs from the knowledge base matching your query, useful for finding reusable answers for bid responses.',
      inputSchema: {
        query: z.string().describe('The search query — use natural language for best results'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 10, max: 50)'),
        offset: z.number().optional().describe('Number of results to skip for pagination (default: 0)'),
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
            content: [{ type: 'text' as const, text: `Q&A search failed: ${error.message}. Try simplifying your query or removing filters.` }],
            isError: true,
          };
        }

        // Filter to Q&A pairs only, then apply pagination
        const allQaResults = ((results ?? []) as Record<string, unknown>[])
          .filter((r) => r.content_type === 'q_a_pair');

        const hasMore = allQaResults.length > searchOffset + searchLimit;
        const paged = allQaResults.slice(searchOffset, searchOffset + searchLimit);

        const qaResults: SearchResult[] = paged.map((r) => ({
          id: r.id as string,
          title: r.title as string | null,
          suggested_title: r.suggested_title as string | null,
          content_type: r.content_type as string | null,
          primary_domain: r.primary_domain as string | null,
          primary_subtopic: r.primary_subtopic as string | null,
          ai_summary: r.ai_summary as string | null,
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
          content: [{ type: 'text' as const, text: `Q&A search failed: ${message}. Try simplifying your query or removing filters.` }],
          isError: true,
        };
      }
    },
  );
}
