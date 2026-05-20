import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  BidOutcomeBodySchema,
  parseBidMetadata,
} from '@/lib/validation/schemas';
import { canTransition } from '@/lib/procurement/procurement-workflow';
import type { BidState } from '@/lib/procurement/procurement-workflow';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/outcome -- record bid outcome (won/lost/withdrawn) */
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
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(BidOutcomeBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { outcome, notes, integrate_to_kb } = parsed.data;

    // Fetch the bid. Post-T2: discriminator via application_types JOIN.
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id, status, domain_metadata, application_types!inner(key)')
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    const bidMetadata =
      parseBidMetadata(bid.domain_metadata) ??
      (bid.domain_metadata as Record<string, unknown>) ??
      {};
    const currentStatus = (bid.status as BidState) ?? 'draft';

    // Validate state transition
    if (!canTransition(currentStatus, outcome as BidState)) {
      return NextResponse.json(
        {
          error: `Cannot transition from "${currentStatus}" to "${outcome}"`,
          current_status: currentStatus,
          requested_outcome: outcome,
        },
        { status: 400 },
      );
    }

    // Update bid with outcome
    const updatedMetadata = {
      ...bidMetadata,
      outcome,
      outcome_notes: notes ?? null,
      outcome_recorded_at: new Date().toISOString(),
      outcome_recorded_by: user.id,
    };

    // UPDATE narrows on id only (prior read enforces procurement-type).
    const { error: updateError } = await supabase
      .from('workspaces')
      .update({
        status: outcome,
        domain_metadata: updatedMetadata,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      logger.error({ err: updateError }, 'Failed to record bid outcome');
      return NextResponse.json(
        { error: 'Failed to record outcome' },
        { status: 500 },
      );
    }

    // If won and KB integration requested, return candidate responses
    let kbCandidates: Array<{
      question_id: string;
      question_text: string;
      response_text: string | null;
      source_content_ids: string[] | null;
      recommendation: 'new_entry' | 'update_existing' | 'skip';
    }> = [];

    if (outcome === 'won' && integrate_to_kb) {
      // Fetch all approved/edited responses for this bid.
      // Post-T2: `bid_questions.project_id` → `workspace_id`.
      const { data: questions, error: questionsError } = await supabase
        .from('bid_questions')
        .select('id, question_text')
        .eq('workspace_id', id);

      if (questionsError) {
        logger.error(
          { err: questionsError },
          'Failed to fetch questions for KB integration',
        );
        return NextResponse.json(
          {
            error: safeErrorMessage(
              questionsError,
              'Failed to fetch bid questions for KB integration',
            ),
          },
          { status: 500 },
        );
      }

      if (questions && questions.length > 0) {
        const questionIds = questions.map((q) => q.id);
        const { data: responses, error: responsesError } = await supabase
          .from('bid_responses')
          .select(
            'question_id, response_text, source_content_ids, review_status',
          )
          .in('question_id', questionIds)
          .in('review_status', ['approved', 'edited']);

        if (responsesError) {
          logger.error(
            { err: responsesError },
            'Failed to fetch responses for KB integration',
          );
          return NextResponse.json(
            {
              error: safeErrorMessage(
                responsesError,
                'Failed to fetch bid responses for KB integration',
              ),
            },
            { status: 500 },
          );
        }

        if (responses) {
          const questionMap = new Map(
            questions.map((q) => [q.id, q.question_text]),
          );

          kbCandidates = responses.map((r) => {
            // Recommend based on whether sources exist
            const hasExistingSources =
              r.source_content_ids && r.source_content_ids.length > 0;
            const recommendation = hasExistingSources
              ? ('update_existing' as const)
              : ('new_entry' as const);

            return {
              question_id: r.question_id,
              question_text: questionMap.get(r.question_id) ?? '',
              response_text: r.response_text,
              source_content_ids: r.source_content_ids,
              recommendation,
            };
          });
        }
      }
    }

    return NextResponse.json({
      status: outcome,
      kb_candidates: kbCandidates,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to record bid outcome') },
      { status: 500 },
    );
  }
}
