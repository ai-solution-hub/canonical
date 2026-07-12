/**
 * Procurement tool registrations (5 tools):
 *   3. list_active_procurement
 *   6. get_procurement_detail
 *   7. get_form_question
 *  15. cite_content
 *  16. get_content_effectiveness
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, checkMcpRole } from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import {
  formatActiveProcurements,
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
import type { ActiveProcurementSummary } from '@/lib/dashboard';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { isActive } from '@/lib/domains/procurement/procurement-workflow';
import {
  type ToolExtra,
  toStructuredContent,
  getDashboardModule,
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
      title: 'List Active Procurements',
      description:
        'List all active (non-terminal workflow state) procurements with their workflow state, buyer, deadline, and question completion progress. Use this to see which procurements are in progress and which need attention.',
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe(
            'Maximum number of procurements to return (default: 20, max: 50)',
          ),
        offset: z
          .number()
          .optional()
          .describe(
            'Number of procurements to skip for pagination (default: 0)',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const procurementLimit = Math.min(args.limit ?? 20, 50);
        const procurementOffset = args.offset ?? 0;

        // DR-056 re-key: the umbrella tool KEEPS its name but its underlying
        // read moves workspace -> form_instances (the item IS the form,
        // BI-1). `workspaces`/`procurement_workspaces` are wholesale-deleted
        // for procurement (W1e, {145.6}) so this can no longer go through the
        // shared `fetchActiveProcurementWithStats` helper (which stays
        // workspace-shaped for its OTHER two callers, lib/dashboard.ts and
        // lib/reorient.ts, owned outside this Subtask) — the form-scoped read
        // is inlined here instead. "Active" = non-terminal `workflow_state`
        // (PROCUREMENT_WORKFLOW_STATES is the single source, BI-18); there is
        // no `is_archived` concept on `form_instances`.
        const forms = await sb(
          supabase
            .from('form_instances')
            .select('id, name, issuing_organisation, deadline, workflow_state')
            .order('updated_at', { ascending: false }),
          'mcp.procurement.list_active_forms',
        );
        const activeForms = (forms ?? []).filter((form) =>
          isActive(
            (form.workflow_state as ProcurementWorkflowState) ?? 'draft',
          ),
        );

        const formIds = activeForms.map((form) => form.id);
        const batchStats =
          formIds.length > 0
            ? await sb(
                supabase.rpc('get_form_question_stats_batch', {
                  p_project_ids: formIds,
                }),
                'mcp.procurement.question_stats_batch',
              )
            : [];
        const statsMap = new Map<
          string,
          {
            total_questions: number;
            drafted_count: number;
            complete_count: number;
          }
        >();
        for (const row of batchStats ?? []) {
          statsMap.set(row.workspace_id, {
            total_questions: row.total_questions,
            drafted_count: row.drafted_count,
            complete_count: row.complete_count,
          });
        }

        // Map to ActiveProcurementSummary type
        const { getDeadlineUrgency, getDaysUntilDeadline } =
          await getDashboardModule();
        const allProcurements: ActiveProcurementSummary[] = activeForms.map(
          (form) => {
            const stats = statsMap.get(form.id);
            const deadline = form.deadline;

            return {
              id: form.id,
              name: form.name ?? 'Untitled Procurement',
              buyer: form.issuing_organisation ?? null,
              status: form.workflow_state,
              deadline,
              days_until_deadline: getDaysUntilDeadline(deadline),
              total_questions: stats?.total_questions ?? 0,
              answered_questions:
                (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0),
              approved_questions: stats?.complete_count ?? 0,
            };
          },
        );

        // Sort by deadline urgency
        const urgencyOrder: Record<string, number> = {
          overdue: 0,
          urgent: 1,
          approaching: 2,
          normal: 3,
          unknown: 4,
        };
        allProcurements.sort((a, b) => {
          const aUrgency = urgencyOrder[getDeadlineUrgency(a.deadline)] ?? 4;
          const bUrgency = urgencyOrder[getDeadlineUrgency(b.deadline)] ?? 4;
          return aUrgency - bUrgency;
        });

        // Apply pagination
        const totalCount = allProcurements.length;
        const hasMore = totalCount > procurementOffset + procurementLimit;
        const bids = allProcurements.slice(
          procurementOffset,
          procurementOffset + procurementLimit,
        );

        const markdown = truncateResponse(formatActiveProcurements(bids));

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
              text: `Failed to list procurements: ${message}. Try simplifying your query or removing filters.`,
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
        'Get detailed information about a specific procurement including buyer, deadline, status, and question completion progress. Use this after listing procurements to drill into a specific one.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the procurement form'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // DR-056 re-key: the id argument + underlying read move
        // workspace -> form_instances (the item IS the form, BI-1).
        // `workspaces`/`procurement_workspaces` are wholesale-deleted for
        // procurement (W1e, {145.6}) — there is no application_types
        // discriminator to join through any more.
        const { data: form, error: formError } = await supabase
          .from('form_instances')
          .select(
            'id, name, description, issuing_organisation, deadline, reference_number, workflow_state',
          )
          .eq('id', args.id)
          .single();

        if (formError || !form) {
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
          supabase.rpc('get_form_question_stats', {
            p_project_id: args.id,
          }),
          'mcp.procurement.question_stats',
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
              .from('form_responses')
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

        const procurementDetail: ProcurementDetail = {
          id: form.id,
          name: form.name ?? 'Untitled Procurement',
          buyer: form.issuing_organisation ?? null,
          status: form.workflow_state,
          deadline: form.deadline,
          reference_number: form.reference_number,
          description: form.description,
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
              text: `Failed to get procurement detail: ${message}. Check the ID is a valid UUID.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 7. get_form_question
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_form_question',
    {
      title: 'Get Procurement Question',
      description:
        'Get a specific form question with its response text, confidence posture, and review status. Use this to see the detail of a particular question within a form.',
      inputSchema: {
        question_id: z
          .string()
          .uuid()
          .describe('The UUID of the form question'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // Fetch question
        const { data: question, error: qError } = await supabase
          .from('form_questions')
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
            .from('form_responses')
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
              text: `Failed to get procurement question: ${message}. Check the ID is a valid UUID.`,
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
        'Record that a knowledge base Q&A pair was used when drafting a form response. This tracks which content contributes to responses and enables win rate analysis. Requires editor or admin role. Note: if the same q_a_pair_id + form_response_id pair is cited again, the existing citation is updated (upsert) — re-citing with a different citation_type will silently overwrite the previous type.',
      inputSchema: {
        q_a_pair_id: z
          .string()
          .uuid()
          .describe('The UUID of the Q&A pair that was used'),
        form_response_id: z
          .string()
          .uuid()
          .describe('The UUID of the form response it was used in'),
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

        // ID-131.19 (M6, S450 GO tail): cited_kind='content_item' +
        // cited_content_item_id were DROPPED at M6 — the CHECK constraint no
        // longer permits the 'content_item' branch at all. Re-anchored onto
        // 'q_a_pair' (cited_q_a_pair_id), mirroring the ALREADY-shipped
        // production writer at app/api/procurement/[id]/responses/
        // draft-stream/route.ts ({131.16} BI-29), which stopped writing
        // content_item rows before this column even dropped.
        //
        // ID-145 {145.21} (DR-056/BI-37): the external arg is now BREAKINGLY
        // renamed content_item_id -> q_a_pair_id (no alias, R8 no-aliases
        // posture) — the `content_item` vocabulary no longer names any part
        // of this tool's contract.
        const insertData: Database['public']['Tables']['citations']['Insert'] =
          {
            citing_kind: 'form_response',
            citing_form_response_id: args.form_response_id,
            cited_kind: 'q_a_pair',
            cited_q_a_pair_id: args.q_a_pair_id,
            citation_type: args.citation_type ?? 'reference',
            created_by: userId,
          };

        const { data: citation, error } = await supabase
          .from('citations')
          .upsert(insertData, {
            onConflict: 'citing_form_response_id,cited_q_a_pair_id',
          })
          .select(
            // ID-131.28 (G-CITE-READERS): select all four per-kind target
            // columns from the extended cited_target_kind contract ({131.10}
            // M4b) — this tool only ever writes cited_kind='q_a_pair' rows
            // itself, but CitationResult/formatCitation are the shared
            // read/display shape for ANY citations row, so the reader must
            // not assume q_a_pair is the only populated kind.
            'id, cited_kind, cited_q_a_pair_id, cited_reference_item_id, cited_source_document_id, cited_concept_path, citing_kind, citing_form_response_id, citation_type, cited_version',
          )
          .single();

        if (error || !citation) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to record citation: ${error?.message ?? 'Unknown error'}. Ensure both the Q&A pair and form response exist.`,
              },
            ],
            isError: true,
          };
        }

        const result: CitationResult = {
          id: citation.id,
          cited_kind: citation.cited_kind,
          cited_q_a_pair_id: citation.cited_q_a_pair_id,
          cited_reference_item_id: citation.cited_reference_item_id,
          cited_source_document_id: citation.cited_source_document_id,
          cited_concept_path: citation.cited_concept_path,
          citing_kind: citation.citing_kind,
          citing_form_response_id: citation.citing_form_response_id,
          citation_type: citation.citation_type,
          cited_version: citation.cited_version,
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
        'Get win rate statistics for a Q&A pair — how often it has been cited in procurement responses and what proportion of those procurements were won. Use this to identify high-performing content and content that may need improvement.',
      inputSchema: {
        q_a_pair_id: z
          .string()
          .uuid()
          .describe('The UUID of the Q&A pair to check'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // ID-131.10 (BI-26): get_content_win_rate re-anchored content_item ->
        // q_a_pair; the RPC arg is p_q_a_pair_id.
        //
        // ID-145 {145.21} (DR-056/BI-37): the TOOL's own external arg is now
        // BREAKINGLY renamed content_item_id -> q_a_pair_id (no alias) — the
        // tool surface is fully re-anchored to the q_a_pair grain, matching
        // the RPC it wraps; `content_item` no longer names any part of this
        // contract.
        const { data: rows, error } = await supabase.rpc(
          'get_content_win_rate',
          {
            p_q_a_pair_id: args.q_a_pair_id,
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
          q_a_pair_id: args.q_a_pair_id,
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
