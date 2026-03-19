/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 30 tools:
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
 *  14. get_entity_relationships — Query entity relationships from the entity graph
 *  15. cite_content — Record that a content item was used in a bid response (editor+)
 *  16. get_content_effectiveness — Get win rate stats for a content item
 *  17. get_coverage_gaps — Identify domains/subtopics with thin or zero coverage
 *  18. audit_content — Find items matching quality criteria (thin, low confidence, etc.)
 *  19. update_content_item — Edit content item metadata and fields (editor+)
 *  20. find_similar_items — Find similar items by cosine similarity
 *  21. get_content_items — Batch fetch multiple content items by ID array
 *  22. show_coverage_matrix — Interactive coverage matrix app (app trigger)
 *  23. show_bid_dashboard — Interactive bid dashboard app (app trigger)
 *  24. show_reorient_me — Interactive personal briefing app (app trigger)
 *  25. delete_content_item — Archive or permanently delete an item (editor+)
 *  26. find_all_duplicates — Scan for high-similarity duplicate pairs
 *  27. list_templates — Available bid template definitions with requirement counts
 *  28. get_template_coverage — Per-section coverage for a template against current KB
 *  29. get_template_gaps — Gap-only view for content creation workflow
 *  30. update_governance_status — Batch publish/draft content items (editor+)
 *
 * All tools use per-user Supabase clients via extra.authInfo so that
 * RLS policies are applied based on the authenticated user.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { createMcpClient, getMcpUserId, getMcpUserRole, checkMcpRole } from '@/lib/mcp/auth';
import type { Database, Json } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Lazy imports — all heavy modules are loaded on-demand to prevent Vercel
// serverless cold start crashes. Module-level imports of OpenAI SDK,
// dashboard queries, and Anthropic SDK cause the function to crash at the
// V8/Node level before any application code runs.
// ---------------------------------------------------------------------------

async function getGenerateEmbedding() {
  const { generateEmbedding } = await import('@/lib/ai/embed');
  return generateEmbedding;
}
async function getClassifyContent() {
  const { classifyContent } = await import('@/lib/ai/classify');
  return classifyContent;
}
async function getGenerateSummary() {
  const { generateSummary } = await import('@/lib/ai/summarise');
  return generateSummary;
}
async function getDashboardModule() {
  return await import('@/lib/dashboard');
}
async function getBidQueriesModule() {
  return await import('@/lib/bid-queries');
}
async function getReorientModule() {
  return await import('@/lib/reorient');
}
async function getAIErrors() {
  const { AIServiceError } = await import('@/lib/ai/errors');
  return AIServiceError;
}
async function getExtAppsServer() {
  return await import('@modelcontextprotocol/ext-apps/server');
}
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
  formatEntitySummary,
  formatCitation,
  formatContentEffectiveness,
  formatCoverageGaps,
  formatAuditResult,
  formatUpdatedItem,
  formatSimilarItems,
  formatBatchContentItems,
  formatCoverageMatrix,
  formatBidDashboard,
  formatTemplateCoverage,
  formatTemplateList,
  formatTemplateGaps,
  formatDeleteContent,
  formatDuplicatePairs,
  formatGovernanceStatusUpdate,
  CHARACTER_LIMIT,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  SearchResult,
  ContentItemDetail,
  BidDetail,
  BidQuestionDetail,
  BidQuestionSummary,
  BidSection,
  QualitySummary,
  FreshnessReport,
  CreatedItem,
  EntitySummaryResult,
  EntityRelationship,
  CitationResult,
  ContentEffectiveness,
  CoverageGapResult,
  AuditItem,
  AuditResult,
  UpdatedItemResult,
  SimilarItem,
  SimilarItemsResult,
  BatchContentItemsResult,
  DuplicatePairsResult,
  DeleteContentResult,
  GovernanceStatusItemResult,
  GovernanceStatusUpdateResult,
  CoverageMatrixData,
  BidDashboardData,
  TemplateCoverageData,
  TemplateListData,
  TemplateGapsData,
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

export async function registerTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // Tool naming: names intentionally omit a service prefix (e.g. kb_). The
  // Knowledge Hub MCP server is designed as a single-purpose connector —
  // users won't have multiple KB servers. Adding prefixes would make names
  // unnecessarily verbose for Claude. Revisit if multi-server scenarios arise.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Shared helper: fetch questions and responses for a bid, returning
  // sections grouped by section_name plus status/confidence breakdowns.
  // Used by both tool #6 (get_bid_detail) and tool #23 (show_bid_dashboard).
  // -------------------------------------------------------------------------

  async function fetchBidSections(
    supabase: ReturnType<typeof createMcpClient>,
    bidId: string,
  ): Promise<{
    sections: BidSection[];
    status_breakdown: Record<string, number>;
    confidence_breakdown: Record<string, number>;
  }> {
    // Fetch individual questions with ordering
    const { data: questions } = await supabase
      .from('bid_questions')
      .select('id, question_text, section_name, section_sequence, question_sequence, status, confidence_posture, word_limit')
      .eq('project_id', bidId)
      .order('section_sequence')
      .order('question_sequence');

    // Fetch responses for all questions in this bid (avoids N+1)
    const questionIds = (questions ?? []).map((q: { id: string }) => q.id);
    const { data: responses } = questionIds.length > 0
      ? await supabase
          .from('bid_responses')
          .select('question_id, response_text, review_status')
          .in('question_id', questionIds)
      : { data: [] as Array<{ question_id: string; response_text: string | null; review_status: string | null }> };

    // Build a response lookup map
    const responseMap = new Map<string, { response_text: string | null; review_status: string | null }>();
    for (const r of (responses ?? [])) {
      responseMap.set(r.question_id, r);
    }

    // Group questions into sections
    const sectionMap = new Map<string, BidQuestionSummary[]>();
    for (const q of (questions ?? [])) {
      const sectionName = q.section_name ?? 'Ungrouped';
      if (!sectionMap.has(sectionName)) {
        sectionMap.set(sectionName, []);
      }
      const resp = responseMap.get(q.id);
      sectionMap.get(sectionName)!.push({
        id: q.id,
        question_text: q.question_text,
        status: q.status ?? 'not_started',
        confidence_posture: q.confidence_posture ?? null,
        word_limit: q.word_limit ?? null,
        has_response: !!resp?.response_text,
        review_status: resp?.review_status ?? null,
      });
    }

    const sections: BidSection[] = [];
    for (const [name, qs] of sectionMap) {
      sections.push({ name, questions: qs });
    }

    // Compute breakdowns
    const status_breakdown: Record<string, number> = {};
    const confidence_breakdown: Record<string, number> = {};
    for (const q of (questions ?? [])) {
      const s = q.status ?? 'not_started';
      status_breakdown[s] = (status_breakdown[s] ?? 0) + 1;
      const c = q.confidence_posture ?? 'unmatched';
      confidence_breakdown[c] = (confidence_breakdown[c] ?? 0) + 1;
    }

    return { sections, status_breakdown, confidence_breakdown };
  }

  // -------------------------------------------------------------------------
  // 1. search_knowledge_base
  // -------------------------------------------------------------------------
  server.registerTool(
    'search_knowledge_base',
    {
      title: 'Search Knowledge Base',
      description: 'Search the knowledge base using semantic and keyword search. Returns content items matching your query, ranked by relevance. Use this to find articles, policies, case studies, Q&A pairs, and other knowledge base content. For Q&A pairs specifically, prefer search_qa_library instead. Valid domains: security, compliance, implementation, support, corporate, product-feature, methodology. Use the kb://taxonomy resource for the full subtopic list.',
      inputSchema: {
        query: z.string().describe('The search query — use natural language for best results'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 10, max: 50)'),
        offset: z.number().optional().describe('Number of results to skip for pagination (default: 0)'),
        domain: z.string().optional().describe('Filter results to a specific domain. Valid values: security, compliance, implementation, support, corporate, product-feature, methodology'),
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

        const markdown = truncateResponse(formatSearchResults(args.query, searchResults));

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
        const { fetchDashboardData } = await getDashboardModule();
        const data = await fetchDashboardData(supabase, userId, isAdmin, role);
        const markdown = truncateResponse(formatDashboardSummary(data));

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
        const { fetchActiveBidsWithStats } = await getBidQueriesModule();
        const { workspaces, statsMap } = await fetchActiveBidsWithStats(supabase);

        // Map to ActiveBidSummary type
        const { getDeadlineUrgency, getDaysUntilDeadline } = await getDashboardModule();
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

        const markdown = truncateResponse(formatActiveBids(bids));

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
      description: 'Retrieve a specific content item from the knowledge base by its ID. Returns the full item including title, type, domain, summary, keywords, freshness status, content text, and entity relationships. For Q&A pairs, includes standard and advanced answers. Use this after searching to get the complete details of a specific item. Use get_entity_relationships to explore connected entities.',
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

        const markdown = truncateResponse(formatContentItem(itemDetail));

        // Truncate content in structuredContent to prevent oversized responses
        // from large PDFs (which can exceed 500KB)
        const structuredItem = { ...item };
        if (typeof structuredItem.content === 'string' && structuredItem.content.length > CHARACTER_LIMIT) {
          structuredItem.content = structuredItem.content.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated)';
        }

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(structuredItem),
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
        const { fetchReorientData, resolveDisplayNames } = await getReorientModule();
        const data = await fetchReorientData(supabase, userId, isAdmin, role);

        // Resolve team member display names server-side
        const userIds = data.team_changes.map(c => c.user_id).filter(Boolean);
        const displayNames = await resolveDisplayNames(userIds);
        for (const change of data.team_changes) {
          if (change.user_id && displayNames.has(change.user_id)) {
            change.user_name = displayNames.get(change.user_id)!;
          }
        }

        const markdown = truncateResponse(formatReorientation(data));

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

        // Fetch individual questions grouped by section
        const { sections, status_breakdown, confidence_breakdown } = await fetchBidSections(supabase, args.id);

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
          sections,
          status_breakdown,
          confidence_breakdown,
        };

        const markdown = truncateResponse(formatBidDetail(bidDetail));
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
        const classifyContent = await getClassifyContent();
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
        const AIServiceError = await getAIErrors();
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
      description: 'Generate an AI summary for a content item including executive summary, detailed summary, and key takeaways. Requires editor or admin role. If a summary already exists, pass force=true to regenerate it — otherwise the call will return an error.',
      inputSchema: {
        item_id: z.string().uuid().describe('The UUID of the content item to summarise'),
        force: z.boolean().optional().describe('Regenerate even if a summary already exists. Set to true when you want to refresh an existing summary (default: false)'),
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
        const generateSummary = await getGenerateSummary();
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
        const AIServiceError = await getAIErrors();
        const message = err instanceof AIServiceError ? err.message : (err instanceof Error ? err.message : 'Unknown error');
        // Provide actionable guidance for common error cases
        const isConflict = err instanceof AIServiceError && err.status === 409;
        const hint = isConflict
          ? ' To regenerate an existing summary, call again with force=true.'
          : ' Ensure you have editor or admin permissions.';
        return {
          content: [{ type: 'text' as const, text: `Summary generation failed: ${message}.${hint}` }],
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
      description: 'Create a new content item in the knowledge base. Requires editor or admin role. The item will be automatically embedded for search unless created as a draft. Set governance_review_status to "draft" to create items that are excluded from search and visible only in the review queue\'s Drafts filter — useful for batch content creation that needs review before going live. Use batch_tag to group related draft items (e.g. "reorient-2026-03") and source_document to record provenance. Choose content_type carefully: use q_a_pair for question-answer pairs, case_study for project examples, policy for governance documents, certification for accreditations, capability for service descriptions. Use the kb://taxonomy resource to see valid domain and subtopic values.',
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
        governance_review_status: z.enum(['draft']).optional().describe('Set to "draft" to create as a draft item (excluded from search, no embedding generated). Publish later via update_governance_status.'),
        batch_tag: z.string().max(200).optional().describe('Tag to group related items (e.g. "reorient-2026-03"). Stored in metadata.batch_tag for filtering.'),
        source_document: z.string().max(500).optional().describe('Source document name or path for provenance tracking. Stored in metadata.source_document.'),
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
        const isDraft = args.governance_review_status === 'draft';

        // Skip embedding for drafts — generated on publish to save API cost
        let embedding: number[] | null = null;
        if (!isDraft) {
          try {
            const generateEmbedding = await getGenerateEmbedding();
            embedding = await generateEmbedding(args.title + ' ' + args.content.slice(0, 5000));
          } catch (error) {
            // Embedding failure is non-fatal — item is still created but invisible to search
            console.error('Failed to generate embeddings:', error);
          }
        }

        // Build metadata with optional batch_tag and source_document
        const metadata: Record<string, string> = {};
        if (args.batch_tag) metadata.batch_tag = args.batch_tag;
        if (args.source_document) metadata.source_document = args.source_document;

        const insertData: Database['public']['Tables']['content_items']['Insert'] = {
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
          ...(isDraft && { governance_review_status: 'draft' }),
          ...(Object.keys(metadata).length > 0 && { metadata: metadata as unknown as Json }),
        };

        const { data: item, error } = await supabase
          .from('content_items')
          .insert(insertData)
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

        // AI processing — awaited to avoid serverless truncation
        const warnings: string[] = [];

        if (!isDraft) {
          try {
            const classifyContent = await getClassifyContent();
            await classifyContent({ supabase, itemId: item.id, force: true, userId });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            warnings.push(`Classification failed: ${msg}`);
            console.error(`MCP create_content_item classification failed for ${item.id}:`, err);
          }

          try {
            const generateSummary = await getGenerateSummary();
            await generateSummary({ supabase, itemId: item.id, force: true, userId });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            warnings.push(`Summary generation failed: ${msg}`);
            console.error(`MCP create_content_item summary failed for ${item.id}:`, err);
          }
        }

        const draftNote = isDraft
          ? '\n\n**Status:** Draft — excluded from search. Use `update_governance_status` to publish when ready.'
          : '';
        const warningNote = warnings.length > 0
          ? `\n\n**Warnings:**\n${warnings.map(w => `- ${w}`).join('\n')}`
          : '';
        const markdown = formatCreatedItem(created) + draftNote + warningNote;
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...created,
            governance_review_status: isDraft ? 'draft' : null,
            batch_tag: args.batch_tag ?? null,
            source_document: args.source_document ?? null,
            warnings: warnings.length > 0 ? warnings : undefined,
          }),
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
      description: 'Search the Q&A library for reusable answers. Unlike search_knowledge_base which searches all content types, this tool filters to Q&A pairs only — ideal for finding existing answers to use in bid responses. Q&A pairs have standard and advanced answer levels. Use get_content_item to retrieve the full answer text after finding relevant pairs.',
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

  // -------------------------------------------------------------------------
  // 14. get_entity_relationships
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_entity_relationships',
    {
      title: 'Entity Relationships',
      description: 'Query entity relationships in the knowledge base. Find what certifications the company holds, what technologies are used, what sectors are served, and how entities connect to each other. Returns structured data from the entity graph at zero AI cost.',
      inputSchema: {
        entity_name: z.string().optional().describe('Entity name to search for (partial match supported)'),
        entity_type: z.string().optional().describe('Filter by entity type: organisation, certification, regulation, framework, capability, person, technology, project, sector'),
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

        // Resolve entity name aliases before querying
        const { canonicalise } = await import('@/lib/entity-dedup');
        const { resolveAlias } = await import('@/lib/entity-aliases');
        const resolvedName = args.entity_name
          ? resolveAlias(canonicalise(args.entity_name))
          : undefined;

        // Call get_entity_summary RPC
        const rpcArgs: Record<string, string> = {};
        if (resolvedName) rpcArgs.p_entity_name = resolvedName;
        if (args.entity_type) rpcArgs.p_entity_type = args.entity_type;

        const { data: summaryRows, error: summaryError } = await supabase.rpc(
          'get_entity_summary',
          rpcArgs as { p_entity_name?: string; p_entity_type?: string },
        );

        if (summaryError) {
          return {
            content: [{ type: 'text' as const, text: `Entity query failed: ${summaryError.message}. The database function may be temporarily unavailable.` }],
            isError: true,
          };
        }

        const summaries: EntitySummaryResult[] = ((summaryRows ?? []) as Record<string, unknown>[]).map((row) => ({
          canonical_name: row.canonical_name as string,
          entity_type: row.entity_type as string,
          mention_count: Number(row.mention_count),
          content_item_ids: (row.content_item_ids as string[]) ?? [],
          related_entities: (row.related_entities as Array<{ relationship: string; target?: string; source?: string }>) ?? [],
        }));

        // If a specific entity_name was provided, also fetch relationship details
        let relationships: EntityRelationship[] = [];
        if (resolvedName && summaries.length > 0) {
          const { data: relRows, error: relError } = await supabase.rpc(
            'get_entity_relationships_rpc',
            { p_entity_name: resolvedName },
          );

          if (!relError && relRows) {
            relationships = ((relRows ?? []) as Record<string, unknown>[]).map((row) => ({
              source_entity: row.source_entity as string,
              relationship_type: row.relationship_type as string,
              target_entity: row.target_entity as string,
              source_item_id: row.source_item_id as string,
              confidence: Number(row.confidence),
            }));
          }
        }

        const markdown = truncateResponse(
          formatEntitySummary(args.entity_name, args.entity_type, summaries, relationships),
        );

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            entity_name: args.entity_name ?? null,
            entity_type: args.entity_type ?? null,
            entity_count: summaries.length,
            summaries,
            relationships,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Entity query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 15. cite_content (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'cite_content',
    {
      title: 'Cite Content',
      description: 'Record that a knowledge base content item was used when drafting a bid response. This tracks which content contributes to bids and enables win rate analysis. Requires editor or admin role. Note: if the same content_item_id + bid_response_id pair is cited again, the existing citation is updated (upsert) — re-citing with a different citation_type will silently overwrite the previous type.',
      inputSchema: {
        content_item_id: z.string().uuid().describe('The UUID of the content item that was used'),
        bid_response_id: z.string().uuid().describe('The UUID of the bid response it was used in'),
        citation_type: z.enum(['reference', 'copied', 'adapted', 'inspired']).optional().describe('How the content was used (default: reference)'),
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

        const insertData: Database['public']['Tables']['content_citations']['Insert'] = {
          content_item_id: args.content_item_id,
          bid_response_id: args.bid_response_id,
          citation_type: args.citation_type ?? 'reference',
          created_by: userId,
        };

        const { data: citation, error } = await supabase
          .from('content_citations')
          .upsert(insertData, {
            onConflict: 'content_item_id,bid_response_id',
          })
          .select('id, content_item_id, bid_response_id, citation_type')
          .single();

        if (error || !citation) {
          return {
            content: [{ type: 'text' as const, text: `Failed to record citation: ${error?.message ?? 'Unknown error'}. Ensure both the content item and bid response exist.` }],
            isError: true,
          };
        }

        const citationRow = citation as Record<string, string>;
        const result: CitationResult = {
          id: citationRow.id,
          content_item_id: citationRow.content_item_id,
          bid_response_id: citationRow.bid_response_id,
          citation_type: citationRow.citation_type,
        };

        const markdown = formatCitation(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to record citation: ${message}. Ensure you have editor or admin permissions.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 16. get_content_effectiveness
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_content_effectiveness',
    {
      title: 'Content Effectiveness',
      description: 'Get win rate statistics for a content item — how often it has been cited in bid responses and what proportion of those bids were won. Use this to identify high-performing content and content that may need improvement.',
      inputSchema: {
        content_item_id: z.string().uuid().describe('The UUID of the content item to check'),
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

        const { data: rows, error } = await supabase.rpc('get_content_win_rate', {
          p_content_item_id: args.content_item_id,
        });

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Effectiveness query failed: ${error.message}. The database function may be temporarily unavailable.` }],
            isError: true,
          };
        }

        const row = (rows as Array<{ total_citations: number; winning_citations: number; win_rate: number }> | null)?.[0];

        const effectiveness: ContentEffectiveness = {
          content_item_id: args.content_item_id,
          total_citations: Number(row?.total_citations ?? 0),
          winning_citations: Number(row?.winning_citations ?? 0),
          win_rate: Number(row?.win_rate ?? 0),
        };

        const markdown = formatContentEffectiveness(effectiveness);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(effectiveness),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Effectiveness query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 17. get_coverage_gaps
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_coverage_gaps',
    {
      title: 'Coverage Gaps',
      description: 'Identify domains and subtopics with zero or thin content coverage. Compares the full taxonomy against actual content items to find gaps. Use this to understand where the knowledge base needs more content. Returns empty subtopics (0 items), thin subtopics (below threshold), and optionally subtopics where all items are stale or expired.',
      inputSchema: {
        min_items: z.number().optional().describe('Threshold below which a subtopic is considered "thin" (default: 3)'),
        include_stale: z.boolean().optional().describe('Whether to flag subtopics where all items are stale/expired (default: true)'),
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
        const minItems = args.min_items ?? 3;
        const includeStale = args.include_stale ?? true;

        // Fetch full taxonomy
        const { data: domains } = await supabase
          .from('taxonomy_domains')
          .select('id, name, display_order')
          .order('display_order');

        const { data: subtopics } = await supabase
          .from('taxonomy_subtopics')
          .select('id, name, domain_id, display_order')
          .order('display_order');

        // Fetch content items grouped by domain + subtopic
        const { data: items } = await supabase
          .from('content_items')
          .select('primary_domain, primary_subtopic, freshness');

        // Build domain ID-to-name map
        const domainMap = new Map<string, string>();
        for (const d of (domains ?? []) as Array<{ id: string; name: string }>) {
          domainMap.set(d.id, d.name);
        }

        // Count items per domain+subtopic
        type ItemRow = { primary_domain: string | null; primary_subtopic: string | null; freshness: string | null };
        const countMap = new Map<string, { total: number; stale: number; expired: number }>();
        for (const item of (items ?? []) as ItemRow[]) {
          if (!item.primary_domain || !item.primary_subtopic) continue;
          const key = `${item.primary_domain}|${item.primary_subtopic}`;
          const existing = countMap.get(key) ?? { total: 0, stale: 0, expired: 0 };
          existing.total++;
          if (item.freshness === 'stale') existing.stale++;
          if (item.freshness === 'expired') existing.expired++;
          countMap.set(key, existing);
        }

        // Analyse gaps
        const emptySubtopics: Array<{ domain: string; subtopic: string }> = [];
        const thinSubtopics: Array<{ domain: string; subtopic: string; item_count: number }> = [];
        const staleOnlySubtopics: Array<{ domain: string; subtopic: string; stale_count: number; expired_count: number }> = [];

        for (const st of (subtopics ?? []) as Array<{ id: string; name: string; domain_id: string }>) {
          const domainName = domainMap.get(st.domain_id);
          if (!domainName) continue;

          const key = `${domainName}|${st.name}`;
          const counts = countMap.get(key);

          if (!counts || counts.total === 0) {
            emptySubtopics.push({ domain: domainName, subtopic: st.name });
          } else if (counts.total < minItems) {
            thinSubtopics.push({ domain: domainName, subtopic: st.name, item_count: counts.total });
          }

          // Check stale-only (all items are stale or expired)
          if (includeStale && counts && counts.total > 0) {
            if (counts.stale + counts.expired === counts.total) {
              staleOnlySubtopics.push({
                domain: domainName,
                subtopic: st.name,
                stale_count: counts.stale,
                expired_count: counts.expired,
              });
            }
          }
        }

        const result: CoverageGapResult = {
          total_gaps: emptySubtopics.length + thinSubtopics.length + staleOnlySubtopics.length,
          empty_subtopics: emptySubtopics,
          thin_subtopics: thinSubtopics,
          stale_only_subtopics: staleOnlySubtopics,
        };

        const markdown = truncateResponse(formatCoverageGaps(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Coverage gap analysis failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 18. audit_content
  // -------------------------------------------------------------------------
  server.registerTool(
    'audit_content',
    {
      title: 'Audit Content',
      description: 'Find content items with quality issues: thin content (under 20 chars), brief content (under 200-500 chars depending on content type), low classification confidence (under 60%), missing AI summary, missing keywords, no domain assigned, or stale/expired freshness. Use this to identify items that need attention. Filter by issue type or domain for targeted audits. Note: scans up to 500 items — for larger knowledge bases, use the domain filter to target specific areas.',
      inputSchema: {
        issue_type: z.enum([
          'thin_content', 'low_confidence', 'missing_summary',
          'missing_keywords', 'no_domain', 'stale', 'brief_content',
        ]).optional().describe('Filter to a specific issue type (default: all issues)'),
        domain: z.string().optional().describe('Filter to a specific domain (exact match)'),
        limit: z.number().optional().describe('Maximum items to return (default: 25, max: 100)'),
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
        const auditLimit = Math.min(args.limit ?? 25, 100);

        // Fetch audit data via RPC — returns char_length(content) instead of
        // the full content body, avoiding megabytes of unnecessary transfer.
        const { data: rows, error } = await supabase.rpc('get_audit_content_items', {
          p_domain: args.domain ?? undefined,
          p_limit: 500,
        });

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Audit query failed: ${error.message}.` }],
            isError: true,
          };
        }

        // Categorise issues for each item
        type Row = {
          id: string; title: string | null; suggested_title: string | null;
          content_type: string | null; primary_domain: string | null;
          content_length: number; ai_summary: string | null;
          ai_keywords: string[] | null; classification_confidence: number | null;
          freshness: string | null;
        };

        const auditItems: AuditItem[] = [];
        const byIssueType: Record<string, number> = {};

        for (const row of (rows ?? []) as Row[]) {
          const issues: string[] = [];
          const contentLen = row.content_length ?? 0;

          if (contentLen < 20) {
            issues.push('thin_content');
          } else {
            // brief_content: content-type-aware minimum length
            const briefThreshold = (() => {
              switch (row.content_type) {
                case 'article': case 'blog': case 'research':
                  return 500;
                case 'policy': case 'compliance': case 'certification':
                  return 300;
                default:
                  return 200;
              }
            })();
            if (contentLen < briefThreshold) {
              issues.push('brief_content');
            }
          }
          if (row.classification_confidence !== null && row.classification_confidence < 0.6) issues.push('low_confidence');
          if (!row.ai_summary) issues.push('missing_summary');
          if (!row.ai_keywords || row.ai_keywords.length === 0) issues.push('missing_keywords');
          if (!row.primary_domain) issues.push('no_domain');
          if (row.freshness === 'stale' || row.freshness === 'expired') issues.push('stale');

          // Filter by specific issue type if requested
          if (args.issue_type && !issues.includes(args.issue_type)) continue;

          if (issues.length > 0) {
            for (const issue of issues) {
              byIssueType[issue] = (byIssueType[issue] ?? 0) + 1;
            }
            auditItems.push({
              id: row.id,
              title: row.title,
              suggested_title: row.suggested_title,
              content_type: row.content_type,
              primary_domain: row.primary_domain,
              issues,
              content_length: contentLen,
              classification_confidence: row.classification_confidence,
              freshness: row.freshness,
            });
          }
        }

        // Apply limit
        const limited = auditItems.slice(0, auditLimit);

        const result: AuditResult = {
          total_flagged: auditItems.length,
          by_issue_type: byIssueType,
          items: limited,
        };

        const markdown = truncateResponse(formatAuditResult(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Audit failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 19. update_content_item (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'update_content_item',
    {
      title: 'Update Content Item',
      description: 'Edit an existing content item\'s metadata and content fields. Updates are applied immediately and auto-versioned in content_history. Requires editor or admin role. Updatable fields: title, suggested_title, content, answer_standard, answer_advanced, primary_domain, primary_subtopic, priority, notes. Use the kb://taxonomy resource for valid domain and subtopic values.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the content item to update'),
        fields: z.object({
          title: z.string().optional().describe('Display title'),
          suggested_title: z.string().optional().describe('AI-suggested title'),
          content: z.string().max(500000).optional().describe('Main content text'),
          answer_standard: z.string().optional().describe('Standard answer (Q&A pairs)'),
          answer_advanced: z.string().optional().describe('Advanced answer (Q&A pairs)'),
          primary_domain: z.string().optional().describe('Domain classification'),
          primary_subtopic: z.string().optional().describe('Subtopic classification'),
          priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
          notes: z.string().optional().describe('Editorial notes'),
        }).describe('Fields to update — only include fields you want to change'),
        reason: z.string().optional().describe('Explanation of why the update was made (stored for audit trail)'),
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

        // Validate that at least one field is being updated
        const allowedFields = [
          'title', 'suggested_title', 'content', 'answer_standard',
          'answer_advanced', 'primary_domain', 'primary_subtopic',
          'priority', 'notes',
        ] as const;

        const updateData: Record<string, unknown> = {};
        const updatedFields: string[] = [];

        for (const field of allowedFields) {
          if (args.fields[field] !== undefined) {
            updateData[field] = args.fields[field];
            updatedFields.push(field);
          }
        }

        if (updatedFields.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No fields to update. Provide at least one field in the fields object.' }],
            isError: true,
          };
        }

        // Fetch current values for the updated fields (for audit trail)
        const { data: current, error: fetchError } = await supabase
          .from('content_items')
          .select(updatedFields.join(', '))
          .eq('id', args.id)
          .single();

        if (fetchError || !current) {
          return {
            content: [{ type: 'text' as const, text: `Content item not found: ${args.id}` }],
            isError: true,
          };
        }

        // Add updated_by
        updateData.updated_by = userId;

        // Apply update
        const { error: updateError } = await supabase
          .from('content_items')
          .update(updateData as Database['public']['Tables']['content_items']['Update'])
          .eq('id', args.id);

        if (updateError) {
          return {
            content: [{ type: 'text' as const, text: `Update failed: ${updateError.message}. Check the ID is valid and you have permissions.` }],
            isError: true,
          };
        }

        const result: UpdatedItemResult = {
          id: args.id,
          updated_fields: updatedFields,
          previous_values: JSON.parse(JSON.stringify(current)) as Record<string, unknown>,
          reason: args.reason ?? null,
        };

        const markdown = formatUpdatedItem(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Update failed: ${message}. Ensure you have editor or admin permissions.` }],
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
      description: 'Find content items similar to a given item using vector cosine similarity. Useful for duplicate detection and related-content discovery. Items above 95% similarity are flagged as likely duplicates. Uses the existing embedding index — no AI cost.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the content item to find similar items for'),
        threshold: z.number().optional().describe('Minimum cosine similarity (default: 0.8, range: 0.5–1.0)'),
        limit: z.number().optional().describe('Maximum results (default: 10, max: 25)'),
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
            content: [{ type: 'text' as const, text: `Content item not found: ${args.id}` }],
            isError: true,
          };
        }

        if (!sourceItem.embedding) {
          return {
            content: [{ type: 'text' as const, text: `No embedding found for item ${args.id}. The item may not have been embedded yet.` }],
            isError: true,
          };
        }

        // Use the embedding to search for similar items
        const { data: results, error: searchError } = await supabase.rpc('hybrid_search', {
          query_embedding: typeof sourceItem.embedding === 'string'
            ? sourceItem.embedding
            : JSON.stringify(sourceItem.embedding),
          query_text: '',
          similarity_threshold: threshold,
          limit_count: resultLimit + 1, // +1 to exclude self
        });

        if (searchError) {
          return {
            content: [{ type: 'text' as const, text: `Similarity search failed: ${searchError.message}.` }],
            isError: true,
          };
        }

        // Filter out the source item itself
        const similar: SimilarItem[] = ((results ?? []) as Record<string, unknown>[])
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

        const sourceTitle = sourceItem.suggested_title || sourceItem.title || 'Untitled';
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
          content: [{ type: 'text' as const, text: `Similarity search failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 21. get_content_items (batch)
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_content_items',
    {
      title: 'Get Content Items (Batch)',
      description: 'Fetch multiple content items by ID array in a single call. Eliminates the need for multiple get_content_item calls when auditing or reviewing several items. Returns the same detail level as get_content_item for each item. Maximum 50 IDs per call.',
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1).max(50).describe('Array of content item UUIDs to fetch (max: 50)'),
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

        const { data: rows, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_summary, ai_keywords, freshness, classification_confidence, source_url, content, created_at, updated_at, governance_review_status, priority',
          )
          .in('id', args.ids);

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Batch fetch failed: ${error.message}.` }],
            isError: true,
          };
        }

        const foundIds = new Set((rows ?? []).map((r: Record<string, unknown>) => r.id as string));
        const notFound = args.ids.filter((id) => !foundIds.has(id));

        const items: ContentItemDetail[] = ((rows ?? []) as Record<string, unknown>[]).map((item) => {
          // Truncate content in results to prevent oversized responses
          let content = item.content as string | null;
          if (typeof content === 'string' && content.length > CHARACTER_LIMIT) {
            content = content.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated)';
          }

          return {
            id: item.id as string,
            title: item.title as string | null,
            suggested_title: item.suggested_title as string | null,
            content_type: item.content_type as string | null,
            primary_domain: item.primary_domain as string | null,
            primary_subtopic: item.primary_subtopic as string | null,
            ai_summary: item.ai_summary as string | null,
            ai_keywords: item.ai_keywords as string[] | null,
            freshness: item.freshness as string | null,
            classification_confidence: item.classification_confidence as number | null,
            source_url: item.source_url as string | null,
            content,
            created_at: item.created_at as string | null,
            updated_at: item.updated_at as string | null,
            governance_review_status: item.governance_review_status as string | null,
            priority: item.priority as string | null,
          };
        });

        // Reorder to match input ID order
        const idOrder = new Map(args.ids.map((id, index) => [id, index]));
        items.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

        const result: BatchContentItemsResult = {
          count: items.length,
          items,
          not_found: notFound,
        };

        const markdown = truncateResponse(formatBatchContentItems(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Batch fetch failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 22. show_coverage_matrix (App trigger tool — renders Coverage Matrix MCP App)
  // -------------------------------------------------------------------------
  const { registerAppTool } = await getExtAppsServer();
  const coverageMatrixUri = 'ui://coverage-matrix/app.html';
  registerAppTool(
    server,
    'show_coverage_matrix',
    {
      title: 'Show Coverage Matrix',
      description: 'Display an interactive coverage matrix showing taxonomy domains, freshness breakdown, quality issues, and gaps. This tool renders a visual grid inside the conversation. Use it when the user asks to see coverage, analyse gaps, or wants a visual overview of knowledge base health.',
      inputSchema: {
        include_gaps: z.boolean().optional().describe('Whether to include gap analysis (default: true)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: coverageMatrixUri } },
    },
    async (args: { include_gaps?: boolean }, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const includeGaps = args.include_gaps ?? true;

        // Aggregate data from multiple sources
        const { fetchDashboardData } = await getDashboardModule();
        const dashData = await fetchDashboardData(supabase, userId, isAdmin, role);

        // Freshness breakdown
        const freshness = dashData.freshness_summary;
        const totalItems = freshness.fresh + freshness.aging + freshness.stale + freshness.expired;

        // Domain-level freshness breakdown — query content_items
        const { data: items } = await supabase
          .from('content_items')
          .select('primary_domain, primary_subtopic, freshness');

        // Build domain map from taxonomy
        const { data: taxonomyDomains } = await supabase
          .from('taxonomy_domains')
          .select('id, name, display_order')
          .order('display_order');

        const { data: taxonomySubtopics } = await supabase
          .from('taxonomy_subtopics')
          .select('id, name, domain_id, display_order')
          .order('display_order');

        // Build domain name -> subtopics map
        const domainMap = new Map<string, string>();
        for (const d of (taxonomyDomains ?? []) as unknown as Array<{ id: string; name: string }>) {
          domainMap.set(d.id, d.name);
        }

        // Group subtopics by domain
        const subtopicsByDomain = new Map<string, Array<{ name: string }>>();
        for (const st of (taxonomySubtopics ?? []) as unknown as Array<{ id: string; name: string; domain_id: string }>) {
          const domainName = domainMap.get(st.domain_id);
          if (!domainName) continue;
          const existing = subtopicsByDomain.get(domainName) ?? [];
          existing.push({ name: st.name });
          subtopicsByDomain.set(domainName, existing);
        }

        // Count items per domain+subtopic+freshness
        type ItemRow = { primary_domain: string | null; primary_subtopic: string | null; freshness: string | null };
        type FreshnessCounts = { total: number; fresh: number; aging: number; stale: number; expired: number };
        const domainCounts = new Map<string, FreshnessCounts>();
        const subtopicCounts = new Map<string, FreshnessCounts>();

        for (const item of (items ?? []) as ItemRow[]) {
          if (!item.primary_domain) continue;

          // Domain level
          const dc = domainCounts.get(item.primary_domain) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
          dc.total++;
          if (item.freshness === 'fresh') dc.fresh++;
          else if (item.freshness === 'aging') dc.aging++;
          else if (item.freshness === 'stale') dc.stale++;
          else if (item.freshness === 'expired') dc.expired++;
          domainCounts.set(item.primary_domain, dc);

          // Subtopic level
          if (item.primary_subtopic) {
            const stKey = `${item.primary_domain}|${item.primary_subtopic}`;
            const sc = subtopicCounts.get(stKey) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
            sc.total++;
            if (item.freshness === 'fresh') sc.fresh++;
            else if (item.freshness === 'aging') sc.aging++;
            else if (item.freshness === 'stale') sc.stale++;
            else if (item.freshness === 'expired') sc.expired++;
            subtopicCounts.set(stKey, sc);
          }
        }

        // Build domains array
        const domains: CoverageMatrixData['domains'] = [];
        const allDomainNames = [...new Set([
          ...((taxonomyDomains ?? []) as unknown as Array<{ name: string }>).map(d => d.name),
          ...domainCounts.keys(),
        ])];

        // Sort by taxonomy display_order
        const domainOrder = new Map<string, number>();
        for (const d of (taxonomyDomains ?? []) as unknown as Array<{ name: string; display_order: number }>) {
          domainOrder.set(d.name, d.display_order);
        }
        allDomainNames.sort((a, b) => (domainOrder.get(a) ?? 999) - (domainOrder.get(b) ?? 999));

        for (const domainName of allDomainNames) {
          const dc = domainCounts.get(domainName) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
          const subtopics = subtopicsByDomain.get(domainName) ?? [];

          const subtopicData = subtopics.map(st => {
            const stKey = `${domainName}|${st.name}`;
            const sc = subtopicCounts.get(stKey) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
            return {
              name: st.name,
              total_items: sc.total,
              fresh: sc.fresh,
              aging: sc.aging,
              stale: sc.stale,
              expired: sc.expired,
            };
          });

          domains.push({
            name: domainName,
            total_items: dc.total,
            fresh: dc.fresh,
            aging: dc.aging,
            stale: dc.stale,
            expired: dc.expired,
            subtopics: subtopicData,
          });
        }

        // Quality summary
        const { data: qualityData } = await supabase
          .from('ingestion_quality_log')
          .select('flag_type, severity')
          .eq('status', 'open');

        const qualityByType: Record<string, number> = {};
        let totalFlagged = 0;
        for (const row of (qualityData ?? []) as Array<{ flag_type: string }>) {
          qualityByType[row.flag_type] = (qualityByType[row.flag_type] ?? 0) + 1;
          totalFlagged++;
        }

        // Coverage gaps
        const gaps: CoverageMatrixData['gaps'] = [];
        if (includeGaps) {
          for (const domain of domains) {
            if (domain.total_items === 0) {
              gaps.push({ domain: domain.name, subtopic: null, item_count: 0, issue: 'empty' });
            }
            for (const st of domain.subtopics) {
              if (st.total_items === 0) {
                gaps.push({ domain: domain.name, subtopic: st.name, item_count: 0, issue: 'empty' });
              } else if (st.total_items < 3) {
                gaps.push({ domain: domain.name, subtopic: st.name, item_count: st.total_items, issue: 'thin' });
              } else if (st.stale + st.expired === st.total_items && st.total_items > 0) {
                gaps.push({ domain: domain.name, subtopic: st.name, item_count: st.total_items, issue: 'stale_only' });
              }
            }
          }
        }

        const result: CoverageMatrixData = {
          total_items: totalItems,
          freshness: {
            fresh: freshness.fresh,
            aging: freshness.aging,
            stale: freshness.stale,
            expired: freshness.expired,
          },
          domains,
          quality: {
            total_flagged: totalFlagged,
            by_issue_type: qualityByType,
          },
          gaps,
        };

        const markdown = truncateResponse(formatCoverageMatrix(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Coverage matrix failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 23. show_bid_dashboard (App trigger tool — renders Bid Dashboard MCP App)
  // -------------------------------------------------------------------------
  const bidDashboardUri = 'ui://bid-dashboard/app.html';
  registerAppTool(
    server,
    'show_bid_dashboard',
    {
      title: 'Show Bid Dashboard',
      description: 'Display an interactive bid dashboard showing active bids with progress bars, deadline countdowns, and question completion stats. This tool renders a visual dashboard inside the conversation. Use it when the user asks about bid status, pipeline overview, or wants to see all active bids at a glance.',
      inputSchema: {
        bid_id: z.string().uuid().optional().describe('Optionally focus on a specific bid (auto-expands that card)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: bidDashboardUri } },
    },
    async (args: { bid_id?: string }, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';

        // Fetch active bids
        const { fetchDashboardData } = await getDashboardModule();
        const dashData = await fetchDashboardData(supabase, userId, isAdmin, role);
        const bids = dashData.active_bids as ActiveBidSummary[];

        const result: BidDashboardData = {
          offset: 0,
          count: bids.length,
          total_count: bids.length,
          has_more: false,
          bids: bids.map(bid => ({
            id: bid.id,
            name: bid.name,
            buyer: bid.buyer,
            status: bid.status,
            deadline: bid.deadline,
            days_until_deadline: bid.days_until_deadline,
            total_questions: bid.total_questions,
            answered_questions: bid.answered_questions,
            approved_questions: bid.approved_questions,
          })),
        };

        // If a specific bid_id is requested, fetch detail
        if (args.bid_id) {
          const { data: workspace } = await supabase
            .from('workspaces')
            .select('id, name, description, domain_metadata')
            .eq('id', args.bid_id)
            .eq('type', 'bid')
            .single();

          if (workspace) {
            const { data: stats } = await supabase.rpc('get_bid_question_stats', {
              p_project_id: args.bid_id,
            });
            const { sections, status_breakdown, confidence_breakdown } = await fetchBidSections(supabase, args.bid_id);
            const meta = workspace.domain_metadata as Record<string, unknown> | null;
            (result as unknown as Record<string, unknown>).focused_bid_detail = {
              id: workspace.id,
              name: workspace.name ?? 'Untitled Bid',
              buyer: (meta?.buyer as string) ?? null,
              status: (meta?.status as string) ?? 'draft',
              deadline: (meta?.deadline as string) ?? null,
              reference_number: (meta?.reference_number as string) ?? null,
              description: workspace.description,
              question_stats: stats?.[0] ?? null,
              sections,
              status_breakdown,
              confidence_breakdown,
            };
          }
        }

        const markdown = truncateResponse(formatBidDashboard(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Bid dashboard failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );
  // -------------------------------------------------------------------------
  // 24. show_reorient_me (App trigger tool — renders Reorient Me MCP App)
  // -------------------------------------------------------------------------
  const reorientMeUri = 'ui://reorient-me/app.html';
  registerAppTool(
    server,
    'show_reorient_me',
    {
      title: 'Show Reorient Me',
      description: 'Display an interactive personal briefing showing what has changed since your last visit, urgent items needing attention, team activity, and active bid status. This tool renders a visual briefing inside the conversation. Use it when the user says "reorient me", "catch me up", "what did I miss?", "what should I focus on?", or wants a personal briefing.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: reorientMeUri } },
    },
    async (_args: Record<string, unknown>, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';

        const { fetchReorientData, resolveDisplayNames } = await getReorientModule();
        const data = await fetchReorientData(supabase, userId, isAdmin, role);

        // Resolve team member display names server-side
        // Note: resolveDisplayNames creates its own service-role client internally
        // — the user-scoped MCP client cannot access auth.admin
        const userIds = data.team_changes.map(c => c.user_id).filter(Boolean);
        const displayNames = await resolveDisplayNames(userIds);
        for (const change of data.team_changes) {
          if (change.user_id && displayNames.has(change.user_id)) {
            change.user_name = displayNames.get(change.user_id)!;
          }
        }

        const markdown = truncateResponse(formatReorientation(data));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Reorient Me failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 25. delete_content_item (Write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'delete_content_item',
    {
      title: 'Delete or Archive Content Item',
      description: 'Archive or permanently delete a content item. Use "archive" (soft-delete) to hide it from search and analytics while preserving history. Use "delete" (hard-delete) to permanently remove the item and its history — only for mistakes or GDPR requests. Archive requires editor role; delete requires admin role.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the content item to archive/delete'),
        mode: z.enum(['archive', 'delete']).describe('Type of deletion: archive (soft) or delete (hard)'),
        reason: z.string().describe('Explanation for the deletion (stored in audit trail)'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);

        // Permission check
        if (args.mode === 'delete') {
          if (role !== 'admin') {
            return {
              content: [{ type: 'text' as const, text: 'Hard-delete requires admin role.' }],
              isError: true,
            };
          }
        } else {
          // Archive requires editor or admin
          if (role !== 'admin' && role !== 'editor') {
            return {
              content: [{ type: 'text' as const, text: 'Archive requires editor or admin role.' }],
              isError: true,
            };
          }
        }

        // Fetch item first for audit logging
        const { data: item, error: fetchError } = await supabase
          .from('content_items')
          .select('id, title, suggested_title, content, brief, detail, reference, metadata, archived_at')
          .eq('id', args.id)
          .single();

        if (fetchError || !item) {
          return {
            content: [{ type: 'text' as const, text: `Item not found: ${args.id}` }],
            isError: true,
          };
        }

        const displayTitle = item.title || item.suggested_title || 'Untitled';

        // Check if already archived
        if (args.mode === 'archive' && item.archived_at) {
          return {
            content: [{ type: 'text' as const, text: `Item "${displayTitle}" (${args.id}) is already archived.` }],
          };
        }

        if (args.mode === 'archive') {
          // Get latest version
          const { data: history } = await supabase
            .from('content_history')
            .select('version')
            .eq('content_item_id', args.id)
            .order('version', { ascending: false })
            .limit(1);
          
          const nextVersion = (history?.[0]?.version ?? 0) + 1;

          // Archive logic
          const { error: updateError } = await supabase
            .from('content_items')
            .update({
              archived_at: new Date().toISOString(),
              archived_by: userId,
              archive_reason: args.reason,
            })
            .eq('id', args.id);

          if (updateError) {
            return {
              content: [{ type: 'text' as const, text: `Archive failed: ${updateError.message}` }],
              isError: true,
            };
          }

          // Record history for archive
          await supabase.from('content_history').insert({
            content_item_id: args.id,
            version: nextVersion,
            title: item.title || item.suggested_title || 'Untitled',
            content: item.content || '',
            brief: item.brief,
            detail: item.detail,
            reference: item.reference,
            metadata: item.metadata,
            change_type: 'archive',
            change_summary: `Item archived: ${args.reason || 'No reason provided'}`,
            created_by: userId,
          });

          const result: DeleteContentResult = {
            id: args.id,
            title: displayTitle,
            mode: 'archive',
            reason: args.reason,
            archived_at: new Date().toISOString(),
          };

          const markdown = formatDeleteContent(result);
          return {
            content: [{ type: 'text' as const, text: markdown }],
            structuredContent: toStructuredContent(result),
          };
        } else {
          // Hard Delete: Record history before deletion (preserved via ON DELETE SET NULL)
          const { data: history } = await supabase
            .from('content_history')
            .select('version')
            .eq('content_item_id', args.id)
            .order('version', { ascending: false })
            .limit(1);
          
          const nextVersion = (history?.[0]?.version ?? 0) + 1;

          await supabase.from('content_history').insert({
            content_item_id: args.id,
            version: nextVersion,
            title: item.title || item.suggested_title || 'Untitled',
            content: item.content || '',
            brief: item.brief,
            detail: item.detail,
            reference: item.reference,
            metadata: item.metadata,
            change_type: 'delete',
            change_summary: `Item hard-deleted: ${args.reason}`,
            created_by: userId,
          });

          // Delete logic (hard delete)
          const { error: deleteError } = await supabase
            .from('content_items')
            .delete()
            .eq('id', args.id);

          if (deleteError) {
            return {
              content: [{ type: 'text' as const, text: `Delete failed: ${deleteError.message}` }],
              isError: true,
            };
          }

          const result: DeleteContentResult = {
            id: args.id,
            title: displayTitle,
            mode: 'delete',
            reason: args.reason,
          };

          const markdown = formatDeleteContent(result);
          return {
            content: [{ type: 'text' as const, text: markdown }],
            structuredContent: toStructuredContent(result),
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Operation failed: ${message}.` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // 26. find_all_duplicates (Read tool — all roles)
  // -------------------------------------------------------------------------
  server.registerTool(
    'find_all_duplicates',
    {
      title: 'Find All Duplicate Content',
      description: 'Scan the entire knowledge base for duplicate pairs using high-similarity vector matching. Returns potential duplicates sorted by similarity. Use domain filter to target specific areas. Excludes archived items. Above 95% similarity is flagged as LIKELY DUPLICATE.',
      inputSchema: {
        threshold: z.number().min(0.7).max(0.99).optional().describe('Similarity threshold (default: 0.95)'),
        domain: z.string().optional().describe('Filter by primary domain'),
        limit: z.number().min(1).max(200).optional().describe('Maximum pairs to return (default: 50, max: 200)'),
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
        const threshold = args.threshold ?? 0.95;
        const limit = args.limit ?? 50;
        const domain = args.domain || undefined;

        const { data: pairs, error } = await supabase.rpc('find_duplicate_pairs', {
          similarity_threshold: threshold,
          p_domain: domain,
          limit_count: limit,
        });

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Duplicate scan failed: ${error.message}` }],
            isError: true,
          };
        }

        const result: DuplicatePairsResult = {
          count: (pairs ?? []).length,
          threshold,
          domain_filter: args.domain || undefined,
          pairs: (pairs ?? []).map((p: Record<string, unknown>) => ({
            item_a: {
              id: p.id1 as string,
              title: (p.title1 as string) ?? 'Untitled',
              content_type: (p.type1 as string | null) ?? null,
              domain: (p.domain1 as string | null) ?? null,
            },
            item_b: {
              id: p.id2 as string,
              title: (p.title2 as string) ?? 'Untitled',
              content_type: (p.type2 as string | null) ?? null,
              domain: (p.domain2 as string | null) ?? null,
            },
            similarity: p.similarity as number,
          })),
        };

        const markdown = truncateResponse(formatDuplicatePairs(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Duplicate scan failed: ${message}.` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // 27. list_templates (Read tool — all roles)
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_templates',
    {
      title: 'List Templates',
      description: 'List available bid template definitions with requirement counts. Use to see which templates can be checked for coverage. Templates include Standard Selection Questionnaire, G-Cloud applications, and other procurement templates.',
      inputSchema: {
        template_type: z.string().optional().describe('Filter by template type: sq, rfp, eqq, gcloud, method_statement, dos, dps, framework, other'),
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
        const { listAvailableTemplates } = await import('@/lib/template-coverage');
        const templates = await listAvailableTemplates(supabase, args.template_type);

        const result: TemplateListData = {
          templates: templates.map(t => ({
            template_name: t.template_name,
            template_version: t.template_version,
            template_type: t.template_type,
            requirement_count: t.requirement_count,
            is_current: t.is_current,
          })),
        };

        const markdown = formatTemplateList(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to list templates: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 28. get_template_coverage (Read tool — all roles)
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_template_coverage',
    {
      title: 'Template Coverage',
      description: 'Check how well the knowledge base covers a specific bid template. Returns per-section coverage status (strong/partial/gap) and an overall completeness score. Use to understand readiness for a specific template type. Use list_templates first to see available templates.',
      inputSchema: {
        template_name: z.string().describe('The template name (e.g. "Standard Selection Questionnaire")'),
        template_version: z.string().optional().describe('Specific version (e.g. "PPN 03/24"). Defaults to current version.'),
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
        const { fetchTemplateRequirements, fetchContentForMatching, computeTemplateCoverage } =
          await import('@/lib/template-coverage');

        const requirements = await fetchTemplateRequirements(
          supabase, args.template_name, args.template_version,
        );

        if (requirements.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No requirements found for template "${args.template_name}"${args.template_version ? ` version ${args.template_version}` : ''}. Use list_templates to see available templates.` }],
            isError: true,
          };
        }

        const contentItems = await fetchContentForMatching(supabase);

        const coverage = computeTemplateCoverage(
          args.template_name,
          args.template_version ?? requirements[0].template_version,
          requirements[0].template_type,
          requirements,
          contentItems,
        );

        const result: TemplateCoverageData = coverage;
        const markdown = truncateResponse(formatTemplateCoverage(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Template coverage query failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 29. get_template_gaps (Read tool — all roles)
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_template_gaps',
    {
      title: 'Template Gaps',
      description: 'Show only the gaps and partial matches for a template — requirements where the knowledge base is missing or has insufficient content. Use this when planning what content to create next.',
      inputSchema: {
        template_name: z.string().describe('The template name (e.g. "Standard Selection Questionnaire")'),
        template_version: z.string().optional().describe('Specific version. Defaults to current version.'),
        include_partial: z.boolean().optional().describe('Include partial matches alongside gaps (default: true)'),
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
        const { fetchTemplateRequirements, fetchContentForMatching, computeTemplateCoverage } =
          await import('@/lib/template-coverage');

        const requirements = await fetchTemplateRequirements(
          supabase, args.template_name, args.template_version,
        );

        if (requirements.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No requirements found for template "${args.template_name}"${args.template_version ? ` version ${args.template_version}` : ''}. Use list_templates to see available templates.` }],
            isError: true,
          };
        }

        const contentItems = await fetchContentForMatching(supabase);
        const includePartial = args.include_partial ?? true;

        const coverage = computeTemplateCoverage(
          args.template_name,
          args.template_version ?? requirements[0].template_version,
          requirements[0].template_type,
          requirements,
          contentItems,
        );

        // Flatten all requirements, filter to gaps (and optionally partial)
        const allReqs = coverage.sections.flatMap(s => s.requirements);
        const gapReqs = allReqs.filter(r =>
          r.coverage_status === 'gap' || (includePartial && r.coverage_status === 'partial'),
        );

        const gapCount = allReqs.filter(r => r.coverage_status === 'gap').length;
        const partialCount = includePartial
          ? allReqs.filter(r => r.coverage_status === 'partial').length
          : 0;

        const result: TemplateGapsData = {
          template_name: coverage.template_name,
          template_version: coverage.template_version,
          template_type: coverage.template_type,
          total_requirements: coverage.total_requirements,
          gap_count: gapCount,
          partial_count: partialCount,
          gaps: gapReqs,
        };

        const markdown = truncateResponse(formatTemplateGaps(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Template gaps query failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 30. update_governance_status (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'update_governance_status',
    {
      title: 'Update Governance Status',
      description: 'Batch publish or draft content items. Use "publish" to move draft items into the live knowledge base (generates embeddings and clears governance_review_status). Use "draft" to pull live items back to draft status. Publishing generates embeddings synchronously before making items searchable — items that fail embedding are reported but do not block other items. Requires editor or admin role.',
      inputSchema: {
        item_ids: z.array(z.string().uuid()).min(1).max(50).describe('UUIDs of content items to update (1–50)'),
        status: z.enum(['publish', 'draft']).describe('Target status: "publish" makes items live and searchable, "draft" hides them from search'),
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
        const items: GovernanceStatusItemResult[] = [];

        // Fetch all items in one query
        const { data: rows, error: fetchError } = await supabase
          .from('content_items')
          .select('id, title, suggested_title, content, governance_review_status')
          .in('id', args.item_ids);

        if (fetchError) {
          return {
            content: [{ type: 'text' as const, text: `Failed to fetch items: ${fetchError.message}` }],
            isError: true,
          };
        }

        const rowMap = new Map(
          ((rows ?? []) as Array<{ id: string; title: string | null; suggested_title: string | null; content: string | null; governance_review_status: string | null }>)
            .map(r => [r.id, r]),
        );

        // Process each item
        for (const itemId of args.item_ids) {
          const row = rowMap.get(itemId);
          const displayTitle = row?.title || row?.suggested_title || 'Untitled';

          if (!row) {
            items.push({ id: itemId, title: 'Not found', success: false, error: 'Item not found' });
            continue;
          }

          try {
            if (args.status === 'publish') {
              // CRITICAL: embed-then-commit ordering
              // Generate embedding BEFORE clearing governance_review_status
              // to prevent items appearing in search without embeddings
              let embedding: number[] | null = null;
              try {
                const generateEmbedding = await getGenerateEmbedding();
                const textForEmbedding = (row.title || row.suggested_title || '') + ' ' + (row.content ?? '').slice(0, 5000);
                embedding = await generateEmbedding(textForEmbedding);
              } catch (embErr) {
                const embMsg = embErr instanceof Error ? embErr.message : 'Unknown embedding error';
                items.push({ id: itemId, title: displayTitle, success: false, error: `Embedding failed: ${embMsg}` });
                continue;
              }

              // Update: set embedding and clear governance_review_status in one operation
              const { error: updateError } = await supabase
                .from('content_items')
                .update({
                  embedding: JSON.stringify(embedding),
                  governance_review_status: null,
                  updated_by: userId,
                } satisfies Database['public']['Tables']['content_items']['Update'])
                .eq('id', itemId);

              if (updateError) {
                items.push({ id: itemId, title: displayTitle, success: false, error: updateError.message });
                continue;
              }
            } else {
              // Draft: set governance_review_status to 'draft'
              const { error: updateError } = await supabase
                .from('content_items')
                .update({
                  governance_review_status: 'draft',
                  updated_by: userId,
                } satisfies Database['public']['Tables']['content_items']['Update'])
                .eq('id', itemId);

              if (updateError) {
                items.push({ id: itemId, title: displayTitle, success: false, error: updateError.message });
                continue;
              }
            }

            // Record content_history entry
            const { data: history } = await supabase
              .from('content_history')
              .select('version')
              .eq('content_item_id', itemId)
              .order('version', { ascending: false })
              .limit(1);

            const nextVersion = (history?.[0]?.version ?? 0) + 1;
            const changeType = args.status === 'publish' ? 'publish' : 'draft';

            await supabase.from('content_history').insert({
              content_item_id: itemId,
              version: nextVersion,
              title: displayTitle,
              content: row.content || '',
              change_type: changeType,
              change_summary: args.status === 'publish'
                ? 'Item published from draft to live'
                : 'Item moved to draft status',
              created_by: userId,
            });

            items.push({ id: itemId, title: displayTitle, success: true });
          } catch (itemErr) {
            const msg = itemErr instanceof Error ? itemErr.message : 'Unknown error';
            items.push({ id: itemId, title: displayTitle, success: false, error: msg });
          }
        }

        const succeeded = items.filter(i => i.success).length;
        const failed = items.filter(i => !i.success).length;

        const result: GovernanceStatusUpdateResult = {
          action: args.status,
          total: args.item_ids.length,
          succeeded,
          failed,
          items,
        };

        const markdown = formatGovernanceStatusUpdate(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Governance status update failed: ${message}. Ensure you have editor or admin permissions.` }],
          isError: true,
        };
      }
    },
  );
}

