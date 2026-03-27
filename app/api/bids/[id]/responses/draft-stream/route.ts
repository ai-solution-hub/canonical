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
import type { BidResponseMetadata } from '@/types/bid-metadata';
import type { BidState } from '@/lib/bid/bid-state-machine';
import type { Json } from '@/supabase/types/database.types';

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
      return new Response(
        JSON.stringify({ error: 'Invalid bid ID' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const rl = checkRateLimit(`draft-stream:${user.id}`, 5, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(ResponseDraftStreamBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { question_id, model_tier } = parsed.data;

    // Verify bid exists and is in an appropriate state
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id, status, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return new Response(
        JSON.stringify({ error: 'Bid not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const bidStatus = (bid.status as BidState) ?? 'draft';
    const draftableStates: BidState[] = ['drafting', 'in_review', 'ready_for_export'];
    if (!draftableStates.includes(bidStatus)) {
      return new Response(
        JSON.stringify({ error: `Bid is in "${bidStatus}" state -- must be drafting or later` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Fetch the question
    const { data: question, error: qError } = await supabase
      .from('bid_questions')
      .select('id, question_text, word_limit, section_name, confidence_posture, matched_content_ids')
      .eq('id', question_id)
      .eq('project_id', id)
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
      const { data: contentItems } = await supabase
        .from('content_items')
        .select('id, suggested_title, content, content_type, ai_summary')
        .in('id', matchedIds);

      matchedContent = (contentItems ?? []).map((item) => ({
        id: item.id,
        title: item.suggested_title,
        content: item.content,
        content_type: item.content_type,
        ai_summary: item.ai_summary,
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
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
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
          const responseMetadata: BidResponseMetadata = {
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
            .from('bid_responses')
            .upsert(
              {
                question_id: question.id,
                response_text: pass2Result.responseText,
                source_content_ids: matchedContent.map((c) => c.id),
                metadata: responseMetadata as unknown as Json,
                review_status: 'ai_drafted',
                drafted_by: null,
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

          // Update question status
          await supabase
            .from('bid_questions')
            .update({ status: 'ai_drafted' })
            .eq('id', question.id)
            .eq('project_id', id);

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
      JSON.stringify({ error: safeErrorMessage(err, 'Failed to start streaming draft') }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
