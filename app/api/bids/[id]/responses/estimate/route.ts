import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { CostEstimateBodySchema } from '@/lib/validation/schemas';
import {
  estimateTokens,
  estimateBatchCost,
  type BatchCostEstimate,
} from '@/lib/coverage/cost-estimation';
import type { BidState } from '@/lib/bid/bid-state-machine';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/responses/estimate -- estimate cost for batch drafting */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(CostEstimateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { skip_existing } = parsed.data;

    // Verify bid exists.
    // Post-T2: discriminator via application_types JOIN.
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select(
        'id, status, domain_metadata, application_types!inner(key)',
      )
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    const bidStatus = (bid.status as BidState) ?? 'draft';
    const draftableStates: BidState[] = [
      'drafting',
      'in_review',
      'ready_for_export',
    ];
    if (!draftableStates.includes(bidStatus)) {
      return NextResponse.json(
        {
          error: `Bid is in "${bidStatus}" state -- must be in drafting or later to estimate costs`,
          current_status: bidStatus,
        },
        { status: 400 },
      );
    }

    // Fetch all questions for this bid.
    // Post-T2: `bid_questions.project_id` → `workspace_id`.
    const { data: questions, error: questionsError } = await supabase
      .from('bid_questions')
      .select('id, question_text, confidence_posture, matched_content_ids')
      .eq('workspace_id', id)
      .order('section_sequence', { ascending: true })
      .order('question_sequence', { ascending: true });

    if (questionsError) {
      logger.error(
        { err: questionsError },
        'Failed to fetch questions for cost estimate',
      );
      return NextResponse.json(
        { error: 'Failed to fetch questions' },
        { status: 500 },
      );
    }

    if (!questions || questions.length === 0) {
      return NextResponse.json({
        total_questions: 0,
        eligible_questions: 0,
        estimated_cost_min: 0,
        estimated_cost_max: 0,
        estimated_input_tokens: 0,
        estimated_output_tokens: 0,
        breakdown: [],
      });
    }

    // Filter out no_content questions
    let eligible = questions.filter(
      (q) => q.confidence_posture !== 'no_content',
    );

    // Optionally filter out already-drafted questions
    if (skip_existing && eligible.length > 0) {
      const eligibleIds = eligible.map((q) => q.id);
      const { data: existingResponses, error: existingError } = await supabase
        .from('bid_responses')
        .select('question_id')
        .in('question_id', eligibleIds);

      if (existingError) {
        logger.error(
          { err: existingError },
          'Failed to fetch existing responses for cost estimate',
        );
        return NextResponse.json(
          {
            error: safeErrorMessage(
              existingError,
              'Failed to fetch existing responses',
            ),
          },
          { status: 500 },
        );
      }

      if (existingResponses && existingResponses.length > 0) {
        const existingIds = new Set(
          existingResponses.map((r) => r.question_id),
        );
        eligible = eligible.filter((q) => !existingIds.has(q.id));
      }
    }

    if (eligible.length === 0) {
      return NextResponse.json({
        total_questions: questions.length,
        eligible_questions: 0,
        estimated_cost_min: 0,
        estimated_cost_max: 0,
        estimated_input_tokens: 0,
        estimated_output_tokens: 0,
        breakdown: [],
      });
    }

    // Collect all unique content IDs across eligible questions
    const allContentIds = new Set<string>();
    for (const q of eligible) {
      const ids = q.matched_content_ids ?? [];
      for (const cid of ids) {
        allContentIds.add(cid);
      }
    }

    // Fetch content lengths in a single query (only need id + content for token estimation)
    const contentLengths = new Map<string, number>();
    if (allContentIds.size > 0) {
      const { data: contentItems, error: contentError } = await supabase
        .from('content_items')
        .select('id, content')
        .in('id', Array.from(allContentIds));

      if (contentError) {
        logger.error(
          { err: contentError },
          'Failed to fetch matched content for cost estimate',
        );
        return NextResponse.json(
          {
            error: safeErrorMessage(
              contentError,
              'Failed to fetch matched content',
            ),
          },
          { status: 500 },
        );
      }

      if (contentItems) {
        for (const item of contentItems) {
          contentLengths.set(item.id, estimateTokens(item.content ?? ''));
        }
      }
    }

    // Build estimation input
    const estimationInput = eligible.map((q) => {
      const matchedIds = q.matched_content_ids ?? [];
      let contentTokens = 0;
      for (const cid of matchedIds) {
        contentTokens += contentLengths.get(cid) ?? 0;
      }

      return {
        id: q.id,
        questionText: q.question_text,
        contentTokens,
        contentItemCount: matchedIds.length,
      };
    });

    const estimate: BatchCostEstimate = estimateBatchCost(estimationInput);

    return NextResponse.json({
      total_questions: questions.length,
      eligible_questions: estimate.eligibleQuestions,
      estimated_cost_min: Math.round(estimate.estimatedCostMin * 100) / 100,
      estimated_cost_max: Math.round(estimate.estimatedCostMax * 100) / 100,
      estimated_input_tokens: estimate.estimatedInputTokens,
      estimated_output_tokens: estimate.estimatedOutputTokens,
      breakdown: estimate.breakdown,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to estimate cost') },
      { status: 500 },
    );
  }
}
