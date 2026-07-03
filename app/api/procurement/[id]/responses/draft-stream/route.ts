import type {
  DraftableContent,
  DraftableQuestion,
} from '@/lib/domains/procurement/ai/draft';
import {
  analyseQuestion,
  draftResponseStreaming,
} from '@/lib/domains/procurement/ai/draft';
import { fetchMatchedContentForDrafting } from '@/lib/domains/procurement/draft-response';
import type { QualityCheckQuestion } from '@/lib/ai/quality-check';
import { checkResponseQuality } from '@/lib/ai/quality-check';
import { getModelForTier } from '@/lib/anthropic';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import { logger } from '@/lib/logger';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ResponseDraftStreamBodySchema } from '@/lib/validation/schemas';
import type { Database, Json } from '@/supabase/types/database.types';
import type { ProcurementResponseMetadata } from '@/types/procurement-metadata';
import { NextRequest } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return new Response(JSON.stringify({ error: 'Invalid bid ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rl = checkRateLimit(`draft-stream:${user.id}`, 5, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const parsed = parseBody(ResponseDraftStreamBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { question_id, model_tier } = parsed.data;

      // Verify bid exists and is in an appropriate state.
      // Post-T2: discriminator via application_types JOIN.
      const { data: bid, error: procurementError } = await supabase
        .from('workspaces')
        .select('id, status, domain_metadata, application_types!inner(key)')
        .eq('id', id)
        .eq('application_types.key', 'procurement')
        .single();

      if (procurementError || !bid) {
        return new Response(
          JSON.stringify({ error: 'Procurement not found' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      const procurementStatus =
        (bid.status as ProcurementWorkflowState) ?? 'draft';
      const draftableStates: ProcurementWorkflowState[] = [
        'drafting',
        'in_review',
        'ready_for_export',
      ];
      if (!draftableStates.includes(procurementStatus)) {
        return new Response(
          JSON.stringify({
            error: `Procurement is in "${procurementStatus}" state -- must be drafting or later`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Fetch the question.
      // Post-T2: `form_questions.workspace_id` → `workspace_id`.
      const { data: question, error: qError } = await supabase
        .from('form_questions')
        .select(
          'id, question_text, word_limit, section_name, confidence_posture, matched_content_ids',
        )
        .eq('id', question_id)
        .eq('workspace_id', id)
        .single();

      if (qError || !question) {
        return new Response(
          JSON.stringify({ error: 'Question not found in this bid' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Fetch matched content (post-{131.16} BI-29: q_a_pairs + reference_items;
      // `content_type` on each item doubles as the cited_kind discriminator
      // for the citations writer below).
      const matchedIds = question.matched_content_ids ?? [];
      let matchedContent: DraftableContent[] = [];
      // ID-58 R1 (re-pointed {131.16}): neither q_a_pairs nor reference_items
      // carries an inline `version` column, so the cited version is the
      // highest `version` recorded in `q_a_pair_history` for each matched
      // q_a_pair (0 if the pair has no history rows yet, or if the matched
      // item is a reference_item — reference_items has no history table).
      // Captured here so the citations writer can stamp `cited_version` at
      // draft time.
      const citedVersionById = new Map<string, number>();
      if (matchedIds.length > 0) {
        try {
          matchedContent = await fetchMatchedContentForDrafting(
            supabase,
            matchedIds,
          );
        } catch (contentError) {
          // S151 WP4 (C3): never stream a draft built on empty source content
          // when a DB error masked the matched content. Surface as a 500
          // before the SSE stream opens so the client can retry.
          return new Response(
            JSON.stringify({
              error: 'Failed to fetch matched content',
              details:
                contentError instanceof Error
                  ? contentError.message
                  : String(contentError),
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const matchedQAPairIds = matchedContent
          .filter((item) => item.content_type === 'q_a_pair')
          .map((item) => item.id);

        // ID-58 R1/R4: read the per-pair MAX(q_a_pair_history.version). A
        // failure here must not throw — the version stamp degrades to 0
        // rather than blocking the draft (the citations write stays
        // non-fatal, see below).
        if (matchedQAPairIds.length > 0) {
          const { data: historyRows, error: historyError } = await supabase
            .from('q_a_pair_history')
            .select('q_a_pair_id, version')
            .in('q_a_pair_id', matchedQAPairIds);

          if (historyError) {
            logger.warn(
              { err: historyError },
              'Failed to read q_a_pair_history versions; cited_version defaults to 0',
            );
          } else {
            for (const row of historyRows ?? []) {
              const current = citedVersionById.get(row.q_a_pair_id) ?? 0;
              if (row.version > current) {
                citedVersionById.set(row.q_a_pair_id, row.version);
              }
            }
          }
        }
      }

      const draftableQuestion: DraftableQuestion = {
        id: question.id,
        question_text: question.question_text,
        word_limit: question.word_limit,
        section_name: question.section_name,
        confidence_posture: question.confidence_posture,
      };

      // Create the SSE stream
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          function send(event: string, data: unknown) {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          }

          try {
            let totalTokens = 0;
            let totalCost = 0;
            let totalInputTokens = 0;
            let totalOutputTokens = 0;

            // Pass 1: Analysis (non-streamed)
            const {
              analysis,
              tokensUsed: analysisTokens,
              inputTokens: analysisInput,
              outputTokens: analysisOutput,
              cost: analysisCost,
            } = await analyseQuestion(draftableQuestion, matchedContent);

            totalTokens += analysisTokens;
            totalInputTokens += analysisInput;
            totalOutputTokens += analysisOutput;
            totalCost += analysisCost;

            send('pass1_complete', { analysis });

            // Pass 2: Stream the draft response
            const { textStream, finalise } = await draftResponseStreaming(
              draftableQuestion,
              matchedContent,
              analysis,
              model_tier,
            );

            for await (const chunk of textStream) {
              send('token', { text: chunk });
            }

            const pass2Result = await finalise();
            totalTokens += pass2Result.tokensUsed;
            totalInputTokens += pass2Result.inputTokens;
            totalOutputTokens += pass2Result.outputTokens;
            totalCost += pass2Result.cost;

            send('pass2_complete', {
              citations: pass2Result.citations,
              tokens: pass2Result.tokensUsed,
              cost: pass2Result.cost,
            });

            // Pass 3: Quality check (non-streamed)
            const qualityQuestion: QualityCheckQuestion = {
              question_text: question.question_text,
              word_limit: question.word_limit,
            };
            const {
              qualityData,
              tokensUsed: qualityTokens,
              inputTokens: qualityInput,
              outputTokens: qualityOutput,
              cost: qualityCost,
            } = await checkResponseQuality(
              qualityQuestion,
              pass2Result.responseText,
              pass2Result.citations,
              matchedContent.length,
            );

            totalTokens += qualityTokens;
            totalInputTokens += qualityInput;
            totalOutputTokens += qualityOutput;
            totalCost += qualityCost;

            send('pass3_complete', { quality: qualityData });

            // Save the response
            const responseMetadata: ProcurementResponseMetadata = {
              citations_data: {
                citations: pass2Result.citations,
                source_content_ids: matchedContent.map((c) => c.id),
              },
              quality_data: qualityData,
              ai_metadata: {
                model: pass2Result.model,
                tokens_input: totalInputTokens,
                tokens_output: totalOutputTokens,
                cost_estimate: totalCost,
                generated_at: new Date().toISOString(),
                analysis_model: getModelForTier('analysis'),
                quality_model: getModelForTier('quality'),
              },
            };

            // Write overall_score to both column and metadata for backward compat
            const overallScore = qualityData?.overall_score ?? null;
            const { data: response, error: upsertError } = await supabase
              .from('form_responses')
              .upsert(
                {
                  question_id: question.id,
                  response_text: pass2Result.responseText,
                  source_content_ids: matchedContent.map((c) => c.id),
                  metadata: responseMetadata as unknown as Json,
                  review_status: 'ai_drafted',
                  drafted_by: PIPELINE_SYSTEM_USER_ID,
                  updated_at: new Date().toISOString(),
                  overall_score: overallScore,
                },
                { onConflict: 'question_id' },
              )
              .select('id')
              .single();

            if (upsertError) {
              send('error', { error: 'Failed to save response' });
              controller.close();
              return;
            }

            // Record citations for win-rate tracking (ID-58 polymorphic
            // `public.citations` table). One row per DISTINCT matched content
            // item so the win-rate RPC's COUNT(DISTINCT cited_q_a_pair_id)
            // stays regression-free (Inv-14). Items that yielded an Anthropic
            // CitationEntry carry the captured span; items that were matched but
            // never cited still get a citation_type='reference' row with NULL
            // span columns, preserving coverage cardinality (Inv-10).
            //
            // {131.16} BI-29 re-anchor: matched items are now q_a_pairs
            // (primary) or reference_items (optional) — never content_items —
            // so cited_kind/the per-kind target column are derived from each
            // item's `content_type` discriminator (set by
            // fetchMatchedContentForDrafting) rather than hardcoded to
            // 'content_item'. cited_content_item_id is NEVER written for new
            // citations going forward (the column + enum label survive to
            // M6/G-API per {131.10}'s deferral, but nothing new targets them).
            if (response?.id && matchedContent.length > 0) {
              try {
                const responseId = response.id;
                type CitationInsert =
                  Database['public']['Tables']['citations']['Insert'];

                // Seed one base row per distinct matched item (no span).
                const rowByItemId = new Map<string, CitationInsert>();
                type CitedTarget = Pick<
                  CitationInsert,
                  'cited_kind' | 'cited_q_a_pair_id' | 'cited_reference_item_id'
                >;
                for (const item of matchedContent) {
                  if (rowByItemId.has(item.id)) continue;
                  const citedTarget: CitedTarget =
                    item.content_type === 'reference_item'
                      ? {
                          cited_kind: 'reference_item',
                          cited_reference_item_id: item.id,
                        }
                      : { cited_kind: 'q_a_pair', cited_q_a_pair_id: item.id };
                  rowByItemId.set(item.id, {
                    citing_kind: 'form_response',
                    citing_form_response_id: responseId,
                    ...citedTarget,
                    cited_version: citedVersionById.get(item.id) ?? 0,
                    citation_type: 'reference',
                    cited_text: null,
                    cited_location_kind: null,
                    cited_start: null,
                    cited_end: null,
                    created_by: user.id,
                  });
                }

                // Overlay the FIRST Anthropic CitationEntry span per content
                // item. Cardinality stays one-row-per-item (partial-unique index
                // on (citing_form_response_id, cited_q_a_pair_id) — cited_kind
                // determines which per-kind target column is populated); full
                // multi-span fidelity remains in form_responses.metadata JSONB.
                const spannedItemIds = new Set<string>();
                for (const entry of pass2Result.citations) {
                  const citedItemId =
                    matchedContent[entry.source_index]?.id ?? entry.source_id;
                  if (!citedItemId) continue;
                  if (spannedItemIds.has(citedItemId)) continue;
                  const base = rowByItemId.get(citedItemId);
                  if (!base) continue;
                  base.cited_text = entry.cited_text;
                  base.cited_location_kind = 'block';
                  base.cited_start = entry.start_block_index;
                  base.cited_end = entry.end_block_index;
                  spannedItemIds.add(citedItemId);
                }

                const citationRows = Array.from(rowByItemId.values());

                // Re-draft idempotency: clear this response's citations, then
                // insert the freshly resolved one-row-per-item set. Equivalent
                // to an upsert on (citing_form_response_id, cited_q_a_pair_id /
                // cited_reference_item_id) for the form_response citing kind.
                const { error: deleteError } = await supabase
                  .from('citations')
                  .delete()
                  .eq('citing_form_response_id', responseId);
                if (deleteError) throw deleteError;

                const { error: insertError } = await supabase
                  .from('citations')
                  .insert(citationRows);
                if (insertError) throw insertError;
              } catch (citationErr) {
                // R4: non-fatal — the response is already saved. Surface the
                // failure to logs AND the client (no silent swallow) so a
                // citation write regression is observable.
                logger.error(
                  { err: citationErr },
                  'Failed to record response citations',
                );
                send('citation_warning', {
                  warning: 'Citations were not recorded for this response',
                });
              }
            }

            // Update question status.
            // Post-T2: `form_questions.workspace_id` → `workspace_id`.
            await supabase
              .from('form_questions')
              .update({ status: 'ai_drafted' })
              .eq('id', question.id)
              .eq('workspace_id', id);

            send('done', {
              response_id: response?.id,
              total_cost: totalCost,
              total_tokens: totalTokens,
            });
          } catch (err) {
            send('error', {
              error: safeErrorMessage(err, 'Streaming draft failed'),
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: safeErrorMessage(err, 'Failed to start streaming draft'),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  },
);
