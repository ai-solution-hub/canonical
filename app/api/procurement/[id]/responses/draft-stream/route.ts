import { NextRequest } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ResponseDraftStreamBodySchema } from '@/lib/validation/schemas';
import { analyseQuestion, draftResponseStreaming } from '@/lib/ai/draft';
import { checkResponseQuality } from '@/lib/ai/quality-check';
import { getModelForTier } from '@/lib/anthropic';
import type { DraftableQuestion, DraftableContent } from '@/lib/ai/draft';
import type { QualityCheckQuestion } from '@/lib/ai/quality-check';
import type { ProcurementResponseMetadata } from '@/types/procurement-metadata';
import type { ProcurementWorkflowState } from '@/lib/procurement/procurement-workflow';
import type { Json } from '@/supabase/types/database.types';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import { logger } from '@/lib/logger';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/bids/:id/responses/draft-stream
 *
 * Streams the Pass 2 (drafting) response token-by-token via SSE.
 * Pass 1 (analysis) and Pass 3 (quality) run non-streamed.
 *
 * SSE events:
 *   event: pass1_complete  — analysis finished, data: { analysis }
 *   event: token           — text delta, data: { text }
 *   event: pass2_complete  — drafting finished, data: { citations, tokens, cost }
 *   event: pass3_complete  — quality check finished, data: { quality }
 *   event: done            — all done, data: { response_id, total_cost }
 *   event: error           — error, data: { error }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
      return new Response(JSON.stringify({ error: 'Procurement not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
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

    // Fetch matched content items
    const matchedIds = question.matched_content_ids ?? [];
    let matchedContent: DraftableContent[] = [];
    if (matchedIds.length > 0) {
      const { data: contentItems, error: contentError } = await supabase
        .from('content_items')
        .select('id, suggested_title, content, content_type, summary')
        .in('id', matchedIds);

      if (contentError) {
        // S151 WP4 (C3): never stream a draft built on empty source content
        // when a DB error masked the matched content. Surface as a 500
        // before the SSE stream opens so the client can retry.
        return new Response(
          JSON.stringify({
            error: 'Failed to fetch matched content',
            details: contentError.message,
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }

      matchedContent = (contentItems ?? []).map((item) => ({
        id: item.id,
        title: item.suggested_title,
        content: item.content,
        content_type: item.content_type,
        summary: item.summary,
      }));
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

          // Record content citations for win-rate tracking
          if (response?.id && matchedContent.length > 0) {
            try {
              const citationRows = matchedContent.map((c) => ({
                bid_response_id: response.id,
                content_item_id: c.id,
                citation_type: 'reference' as const,
                created_by: user.id,
              }));

              // Delete existing citations for this response (in case of re-draft)
              await supabase
                .from('content_citations')
                .delete()
                .eq('bid_response_id', response.id);

              await supabase.from('content_citations').insert(citationRows);
            } catch (citationErr) {
              logger.error(
                { err: citationErr },
                'Failed to record content citations',
              );
              // Non-fatal — response is already saved
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
}
