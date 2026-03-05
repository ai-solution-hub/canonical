import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ResponseDraftAllBodySchema } from '@/lib/validation/schemas';
import { runDraftingPipeline } from '@/lib/bid-drafting';
import type { DraftableQuestion, DraftableContent } from '@/lib/bid-drafting';
import { canTransition } from '@/lib/bid-state-machine';
import type { BidState } from '@/lib/bid-state-machine';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/responses/draft-all -- draft all eligible questions in a bid */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const { allowed } = checkRateLimit(`draft-all:${user.id}`, 1, 120_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(ResponseDraftAllBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { model_tier, skip_existing } = parsed.data;

    // Verify bid exists and is in an appropriate state
    const { data: bid, error: bidError } = await supabase
      .from('projects')
      .select('id, status, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json(
        { error: 'Bid not found' },
        { status: 64 },
      );
    }

    const bidStatus = (bid.status as BidState) ?? 'draft';
    const draftableStates: BidState[] = [
      'drafting', 'in_review', 'ready_for_export',
    ];
    if (!draftableStates.includes(bidStatus)) {
      return NextResponse.json(
        {
          error: `Bid is in "${bidStatus}" state -- must be in drafting or later to generate responses`,
          current_status: bidStatus,
        },
        { status: 400 },
      );
    }

    // Fetch all questions for this bid
    const { data: questions, error: questionsError } = await supabase
      .from('bid_questions')
      .select('id, question_text, word_limit, section_name, confidence_posture, matched_content_ids')
      .eq('project_id', id)
      .order('section_sequence', { ascending: true })
      .order('question_sequence', { ascending: true });

    if (questionsError) {
      console.error('Failed to fetch questions for batch drafting:', questionsError);
      return NextResponse.json(
        { error: 'Failed to fetch questions' },
        { status: 500 },
      );
    }

    if (!questions || questions.length === 0) {
      return NextResponse.json({
        total_questions: 0,
        drafted: 0,
        skipped: 0,
        failed: 0,
        results: [],
        total_cost: 0,
        total_tokens: 0,
      });
    }

    // If skipping existing, get all question IDs that already have responses
    const existingResponseIds = new Set<string>();
    if (skip_existing) {
      const questionIds = questions.map((q) => q.id);
      const { data: existingResponses } = await supabase
        .from('bid_responses')
        .select('question_id')
        .in('question_id', questionIds);

      if (existingResponses) {
        for (const r of existingResponses) {
          existingResponseIds.add(r.question_id);
        }
      }
    }

    // Process questions sequentially (respects API rate limits, leverages prompt caching)
    const results: Array<{
      question_id: string;
      status: 'drafted' | 'skipped' | 'failed';
      quality_score?: number;
      reason?: string;
      error?: string;
    }> = [];

    let totalCost = 0;
    let totalTokens = 0;

    for (const question of questions) {
      // Skip no_content questions
      if (question.confidence_posture === 'no_content') {
        results.push({
          question_id: question.id,
          status: 'skipped',
          reason: 'no_content',
        });
        continue;
      }

      // Skip already-drafted if requested
      if (skip_existing && existingResponseIds.has(question.id)) {
        results.push({
          question_id: question.id,
          status: 'skipped',
          reason: 'already_drafted',
        });
        continue;
      }

      try {
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

        const draftResult = await runDraftingPipeline(
          draftableQuestion,
          matchedContent,
          model_tier,
        );

        totalCost += draftResult.total_cost;
        totalTokens += draftResult.total_tokens;

        // Upsert the response
        await supabase
          .from('bid_responses')
          .upsert(
            {
              question_id: question.id,
              response_text: draftResult.response_text,
              source_content_ids: draftResult.source_content_ids,
              metadata: draftResult.metadata as unknown as Json,
              review_status: 'ai_drafted',
              drafted_by: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'question_id' },
          );

        // Update question status
        await supabase
          .from('bid_questions')
          .update({ status: 'ai_drafted' })
          .eq('id', question.id)
          .eq('project_id', id);

        results.push({
          question_id: question.id,
          status: 'drafted',
          quality_score: draftResult.metadata.quality_data?.overall_score,
        });
      } catch (draftErr) {
        console.error(`Batch draft failed for question ${question.id}:`, draftErr);
        results.push({
          question_id: question.id,
          status: 'failed',
          error: draftErr instanceof Error ? draftErr.message : 'Drafting pipeline failed',
        });
      }
    }

    // Transition bid to in_review if all eligible questions are drafted
    const draftedCount = results.filter((r) => r.status === 'drafted').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    if (
      draftedCount > 0 &&
      failedCount === 0 &&
      bidStatus === 'drafting' &&
      canTransition(bidStatus, 'in_review')
    ) {
      // Check if there are any questions still without responses
      const { count: undraftedCount } = await supabase
        .from('bid_questions')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', id)
        .neq('confidence_posture', 'no_content')
        .not('id', 'in', `(${results.filter((r) => r.status === 'drafted' || r.status === 'skipped').map((r) => `"${r.question_id}"`).join(',')})`)
        .is('status', null);

      // If all non-no_content questions have been processed, transition
      if (undraftedCount === null || undraftedCount === 0) {
        await supabase
          .from('projects')
          .update({
            status: 'in_review',
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('type', 'bid');
      }
    }

    return NextResponse.json({
      total_questions: questions.length,
      drafted: draftedCount,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: failedCount,
      results,
      total_cost: totalCost,
      total_tokens: totalTokens,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to batch draft responses') },
      { status: 500 },
    );
  }
}
