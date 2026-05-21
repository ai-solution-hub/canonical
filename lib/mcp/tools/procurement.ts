/**
 * Procurement tool registrations (5 tools):
 *   3. list_active_procurement
 *   6. get_procurement_detail
 *   7. get_bid_question
 *  15. cite_content
 *  16. get_content_effectiveness
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, checkMcpRole } from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';
import { parseProcurementMetadata } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import {
  formatActiveBids,
  formatProcurementDetail,
  formatProcurementQuestion,
  formatCitation,
  formatContentEffectiveness,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  ProcurementDetail,
  ProcurementQuestionDetail,
  CitationResult,
  ContentEffectiveness,
} from '@/lib/mcp/formatters';
import type {
  ProcurementResponseMetadata,
  QualityData,
} from '@/types/procurement-metadata';
import type { ActiveBidSummary } from '@/lib/dashboard';
import {
  type ToolExtra,
  toStructuredContent,
  getDashboardModule,
  getProcurementQueriesModule,
  fetchProcurementSections,
  defineTool,
  READ_ONLY_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
} from './shared';

export async function registerProcurementTools(
  server: McpServer,
): Promise<void> {
  // -------------------------------------------------------------------------
  // 3. list_active_procurement
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'list_active_procurement',
    {
      title: 'List Active Bids',
      description:
        'List all active (non-archived) bids with their status, buyer, deadline, and question completion progress. Use this to see which bids are in progress and which need attention.',
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe('Maximum number of bids to return (default: 20, max: 50)'),
        offset: z
          .number()
          .optional()
          .describe('Number of bids to skip for pagination (default: 0)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const procurementLimit = Math.min(args.limit ?? 20, 50);
        const procurementOffset = args.offset ?? 0;
        const { fetchActiveProcurementWithStats } =
          await getProcurementQueriesModule();
        const { workspaces, statsMap } =
          await fetchActiveProcurementWithStats(supabase);

        // Map to ActiveBidSummary type
        const { getDeadlineUrgency, getDaysUntilDeadline } =
          await getDashboardModule();
        const allBids: ActiveBidSummary[] = workspaces.map((workspace) => {
          const meta = parseProcurementMetadata(workspace.domain_metadata);
          const stats = statsMap.get(workspace.id);
          const deadline = meta?.deadline ?? null;

          return {
            id: workspace.id,
            name: workspace.name ?? 'Untitled Procurement',
            buyer: meta?.buyer ?? null,
            status: meta?.status ?? 'draft',
            deadline,
            days_until_deadline: getDaysUntilDeadline(deadline),
            total_questions: stats?.total_questions ?? 0,
            answered_questions:
              (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0),
            approved_questions: stats?.complete_count ?? 0,
          };
        });

        // Sort by deadline urgency
        const urgencyOrder: Record<string, number> = {
          overdue: 0,
          urgent: 1,
          approaching: 2,
          normal: 3,
          unknown: 4,
        };
        allBids.sort((a, b) => {
          const aUrgency = urgencyOrder[getDeadlineUrgency(a.deadline)] ?? 4;
          const bUrgency = urgencyOrder[getDeadlineUrgency(b.deadline)] ?? 4;
          return aUrgency - bUrgency;
        });

        // Apply pagination
        const totalCount = allBids.length;
        const hasMore = totalCount > procurementOffset + procurementLimit;
        const bids = allBids.slice(
          procurementOffset,
          procurementOffset + procurementLimit,
        );

        const markdown = truncateResponse(formatActiveBids(bids));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            offset: procurementOffset,
            count: bids.length,
            total_count: totalCount,
            has_more: hasMore,
            bids,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to list bids: ${message}. Try simplifying your query or removing filters.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 6. get_procurement_detail
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_procurement_detail',
    {
      title: 'Get Procurement Detail',
      description:
        'Get detailed information about a specific bid including buyer, deadline, status, and question completion progress. Use this after listing bids to drill into a specific one.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the bid workspace'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // Fetch workspace (post-T2: discriminator is application_types.key via
        // JOIN, not the dropped workspaces.type col. 'bid' → 'procurement').
        const { data: workspace, error: wsError } = await supabase
          .from('workspaces')
          .select(
            'id, name, description, domain_metadata, is_archived, application_types!inner(key)',
          )
          .eq('id', args.id)
          .eq('application_types.key', 'procurement')
          .single();

        if (wsError || !workspace) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Procurement not found: ${args.id}`,
              },
            ],
            isError: true,
          };
        }

        // Fetch question stats
        const stats = await sb(
          supabase.rpc('get_bid_question_stats', {
            p_project_id: args.id,
          }),
          'mcp.bid.question_stats',
        );

        // Fetch individual questions grouped by section
        const { sections, status_breakdown, confidence_breakdown } =
          await fetchProcurementSections(supabase, args.id);

        // Compute readiness summary from responses with metadata
        const allQuestionIds = sections.flatMap((s) =>
          s.questions.map((q) => q.id),
        );
        let readinessSummary: {
          ready: boolean;
          summary: {
            total_questions: number;
            answered: number;
            approved: number;
            quality_checked: number;
            passing_quality: number;
          };
        } | null = null;

        if (allQuestionIds.length > 0) {
          const responses = await sb(
            supabase
              .from('bid_responses')
              .select(
                'question_id, response_text, review_status, metadata, overall_score',
              )
              .in('question_id', allQuestionIds),
            'mcp.bid.responses_by_questions',
          );

          const responseMap = new Map<
            string,
            {
              response_text: string | null;
              review_status: string | null;
              metadata: unknown;
              overall_score?: number | null;
            }
          >();
          for (const r of responses ?? []) {
            responseMap.set(r.question_id, r);
          }

          let answered = 0;
          let approved = 0;
          let qualityChecked = 0;
          let passingQuality = 0;
          const QUALITY_THRESHOLD = 60;

          for (const qId of allQuestionIds) {
            const resp = responseMap.get(qId);
            if (resp?.response_text && resp.response_text.trim().length > 0)
              answered++;
            if (
              resp?.review_status === 'approved' ||
              resp?.review_status === 'edited'
            )
              approved++;

            const meta2 = (resp?.metadata ?? {}) as ProcurementResponseMetadata;
            const qd: QualityData | null = meta2.quality_data ?? null;
            if (qd) {
              qualityChecked++;
              // Prefer overall_score from dedicated column; fall back to metadata
              const score = resp?.overall_score ?? qd.overall_score ?? 0;
              if (score >= QUALITY_THRESHOLD) passingQuality++;
            }
          }

          const totalQ = allQuestionIds.length;
          readinessSummary = {
            ready:
              answered === totalQ &&
              approved === totalQ &&
              (qualityChecked === 0 || passingQuality === qualityChecked),
            summary: {
              total_questions: totalQ,
              answered,
              approved,
              quality_checked: qualityChecked,
              passing_quality: passingQuality,
            },
          };
        }

        const meta = parseProcurementMetadata(workspace.domain_metadata);
        const procurementDetail: ProcurementDetail = {
          id: workspace.id,
          name: workspace.name ?? 'Untitled Procurement',
          buyer: meta?.buyer ?? null,
          status: meta?.status ?? 'draft',
          deadline: meta?.deadline ?? null,
          reference_number: meta?.reference_number ?? null,
          description: workspace.description,
          question_stats: stats?.[0] ?? null,
          sections,
          status_breakdown,
          confidence_breakdown,
        };

        const readinessLine = readinessSummary
          ? `\n\n**Readiness:** ${readinessSummary.ready ? 'Ready to export' : 'Not ready'} (${readinessSummary.summary.answered}/${readinessSummary.summary.total_questions} answered, ${readinessSummary.summary.approved}/${readinessSummary.summary.total_questions} approved)`
          : '';
        const markdown = truncateResponse(
          formatProcurementDetail(procurementDetail) + readinessLine,
        );
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...procurementDetail,
            readiness_summary: readinessSummary,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get bid detail: ${message}. Check the ID is a valid UUID.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 7. get_bid_question
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_bid_question',
    {
      title: 'Get Procurement Question',
      description:
        'Get a specific bid question with its response text, confidence posture, and review status. Use this to see the detail of a particular question within a bid.',
      inputSchema: {
        question_id: z.string().uuid().describe('The UUID of the bid question'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // Fetch question
        const { data: question, error: qError } = await supabase
          .from('bid_questions')
          .select(
            'id, question_text, section_name, word_limit, confidence_posture, status',
          )
          .eq('id', args.question_id)
          .single();

        if (qError || !question) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Question not found: ${args.question_id}`,
              },
            ],
            isError: true,
          };
        }

        // Fetch response if exists
        const response = await sb(
          supabase
            .from('bid_responses')
            .select('response_text, review_status')
            .eq('question_id', args.question_id)
            .maybeSingle(),
          'mcp.bid.response_by_question',
        );

        const detail: ProcurementQuestionDetail = {
          id: question.id,
          question_text: question.question_text,
          section_name: question.section_name,
          word_limit: question.word_limit,
          confidence_posture: question.confidence_posture,
          status: question.status,
          response_text: response?.response_text ?? null,
          review_status: response?.review_status ?? null,
        };

        const markdown = formatProcurementQuestion(detail);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(detail),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get bid question: ${message}. Check the ID is a valid UUID.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 15. cite_content (write tool — editor+ only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'cite_content',
    {
      title: 'Cite Content',
      description:
        'Record that a knowledge base content item was used when drafting a bid response. This tracks which content contributes to bids and enables win rate analysis. Requires editor or admin role. Note: if the same content_item_id + bid_response_id pair is cited again, the existing citation is updated (upsert) — re-citing with a different citation_type will silently overwrite the previous type.',
      inputSchema: {
        content_item_id: z
          .string()
          .uuid()
          .describe('The UUID of the content item that was used'),
        bid_response_id: z
          .string()
          .uuid()
          .describe('The UUID of the bid response it was used in'),
        citation_type: z
          .enum(['reference', 'copied', 'adapted', 'inspired'])
          .optional()
          .describe('How the content was used (default: reference)'),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);

        const insertData: Database['public']['Tables']['content_citations']['Insert'] =
          {
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
            content: [
              {
                type: 'text' as const,
                text: `Failed to record citation: ${error?.message ?? 'Unknown error'}. Ensure both the content item and bid response exist.`,
              },
            ],
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
          content: [
            {
              type: 'text' as const,
              text: `Failed to record citation: ${message}. Ensure you have editor or admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 16. get_content_effectiveness
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_content_effectiveness',
    {
      title: 'Content Effectiveness',
      description:
        'Get win rate statistics for a content item — how often it has been cited in bid responses and what proportion of those bids were won. Use this to identify high-performing content and content that may need improvement.',
      inputSchema: {
        content_item_id: z
          .string()
          .uuid()
          .describe('The UUID of the content item to check'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        const { data: rows, error } = await supabase.rpc(
          'get_content_win_rate',
          {
            p_content_item_id: args.content_item_id,
          },
        );

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Effectiveness query failed: ${error.message}. The database function may be temporarily unavailable.`,
              },
            ],
            isError: true,
          };
        }

        const row = (
          rows as Array<{
            total_citations: number;
            winning_citations: number;
            losing_citations: number;
            pending_citations: number;
            win_rate: number;
          }> | null
        )?.[0];

        const effectiveness: ContentEffectiveness = {
          content_item_id: args.content_item_id,
          total_citations: Number(row?.total_citations ?? 0),
          winning_citations: Number(row?.winning_citations ?? 0),
          losing_citations: Number(row?.losing_citations ?? 0),
          pending_citations: Number(row?.pending_citations ?? 0),
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
          content: [
            {
              type: 'text' as const,
              text: `Effectiveness query failed: ${message}. The database function may be temporarily unavailable.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
