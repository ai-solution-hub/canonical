import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import {
  estimateBatchCost,
  estimateTokens,
  type BatchCostEstimate,
} from '@/lib/coverage/cost-estimation';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { fetchMatchedContentForDrafting } from '@/lib/domains/procurement/draft-response';
import { parseBody } from '@/lib/validation';
import { CostEstimateBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

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
      // ID-145 {145.23} round-2 (DR-056, mirrors the {145.21} draft-stream
      // route): workspaces/procurement_workspaces are wholesale-deleted for
      // procurement (W1e, {145.6}) — [id] IS the form_instances PK now.
      const { data: bid, error: procurementError } = await supabase
        .from('form_instances')
        .select('id, workflow_state')
        .eq('id', id)
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      const procurementStatus =
        (bid.workflow_state as ProcurementWorkflowState) ?? 'draft';
      const draftableStates: ProcurementWorkflowState[] = [
        'drafting',
        'in_review',
        'ready_for_export',
      ];
      if (!draftableStates.includes(procurementStatus)) {
        return NextResponse.json(
          {
            error: `Procurement is in "${procurementStatus}" state -- must be in drafting or later to estimate costs`,
            current_status: procurementStatus,
          },
          { status: 400 },
        );
      }

      // Fetch all questions for this bid.
      // ID-145 {145.23} round-2: form_questions.workspace_id -> form_instance_id
      // (W1c); matched_record_ids (dropped W1c STEP 4) is no longer selected —
      // matches are resolved per-question below via question_match_search
      // (R7 substrate, BI-37), mirroring the {145.21}/draftSingleQuestion
      // precedent.
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select('id, question_text, confidence_posture')
        .eq('form_instance_id', id)
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
          .from('form_responses')
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

      // Resolve matched content ids per eligible question via
      // question_match_search (form_questions.matched_record_ids dropped
      // W1c STEP 4; R7 substrate, BI-37 — mirrors the draftSingleQuestion/
      // draft-stream precedent). A per-question RPC failure degrades to zero
      // matched ids for that question rather than failing the whole estimate.
      const matchedIdsByQuestion = new Map<string, string[]>();
      if (eligible.length > 0) {
        await Promise.all(
          eligible.map(async (q) => {
            const { data: matchRows, error: matchError } = await supabase.rpc(
              'question_match_search',
              { p_form_question_id: q.id, p_limit: 20 },
            );
            if (matchError) {
              logger.warn(
                { err: matchError, questionId: q.id },
                'Failed to read question_matches for cost estimate; treated as zero matches',
              );
            }
            matchedIdsByQuestion.set(
              q.id,
              (matchRows ?? []).map((row) => row.q_a_pair_id),
            );
          }),
        );
      }

      // Collect all unique content IDs across eligible questions
      const allContentIds = new Set<string>();
      for (const ids of matchedIdsByQuestion.values()) {
        for (const cid of ids) {
          allContentIds.add(cid);
        }
      }

      // Fetch content lengths (only need id + content for token estimation).
      // Post-{131.16} BI-29: re-pointed off content_items onto q_a_pairs/
      // reference_items via the shared drafting-content fetch.
      const contentLengths = new Map<string, number>();
      if (allContentIds.size > 0) {
        let matchedContent;
        try {
          matchedContent = await fetchMatchedContentForDrafting(
            supabase,
            Array.from(allContentIds),
          );
        } catch (contentError) {
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

        for (const item of matchedContent) {
          contentLengths.set(item.id, estimateTokens(item.content ?? ''));
        }
      }

      // Build estimation input
      const estimationInput = eligible.map((q) => {
        const matchedIds = matchedIdsByQuestion.get(q.id) ?? [];
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
  },
);
