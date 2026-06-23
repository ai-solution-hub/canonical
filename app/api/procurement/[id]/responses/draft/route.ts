import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { draftSingleQuestion } from '@/lib/procurement/draft-response';
import type { ProcurementWorkflowState } from '@/lib/procurement/procurement-workflow';
import { checkRateLimit } from '@/lib/rate-limit';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { ResponseDraftBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
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
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const rl = checkRateLimit(`draft:${user.id}`, 5, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const parsed = parseBody(ResponseDraftBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { question_ids, model_tier, force } = parsed.data;

      // Verify bid exists and is in an appropriate state.
      // Post-T2: discriminator via application_types JOIN.
      const { data: bid, error: procurementError } = await supabase
        .from('workspaces')
        .select('id, status, domain_metadata, application_types!inner(key)')
        .eq('id', id)
        .eq('application_types.key', 'procurement')
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
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
        return NextResponse.json(
          {
            error: `Procurement is in "${procurementStatus}" state -- must be in drafting or later to generate responses`,
            current_status: procurementStatus,
          },
          { status: 400 },
        );
      }

      // Fetch questions to draft.
      // Post-T2: `form_questions.workspace_id` → `workspace_id`.
      let questionsQuery = supabase
        .from('form_questions')
        .select(
          'id, question_text, word_limit, section_name, confidence_posture, matched_content_ids',
        )
        .eq('workspace_id', id);

      if (question_ids && question_ids.length > 0) {
        questionsQuery = questionsQuery.in('id', question_ids);
      }

      const { data: questions, error: questionsError } = await questionsQuery;

      if (questionsError) {
        logger.error(
          { err: questionsError },
          'Failed to fetch questions for drafting',
        );
        return NextResponse.json(
          { error: 'Failed to fetch questions' },
          { status: 500 },
        );
      }

      if (!questions || questions.length === 0) {
        return NextResponse.json({
          drafted: 0,
          skipped: 0,
          results: [],
          message: 'No questions to draft',
        });
      }

      // Process each question
      const results: Array<{
        question_id: string;
        status: 'drafted' | 'skipped' | 'failed';
        response_id?: string;
        quality_score?: number;
        reason?: string;
        error?: string;
      }> = [];

      let totalCost = 0;
      let totalTokens = 0;

      for (const question of questions) {
        // Skip no_content questions unless forced
        if (question.confidence_posture === 'no_content' && !force) {
          results.push({
            question_id: question.id,
            status: 'skipped',
            reason: 'no_content',
          });
          continue;
        }

        // Check for existing response unless forced
        if (!force) {
          const existing = await sb(
            supabase
              .from('form_responses')
              .select('id')
              .eq('question_id', question.id)
              .maybeSingle(),
            'bids.response.draft.existingCheck',
          );

          if (existing) {
            results.push({
              question_id: question.id,
              status: 'skipped',
              reason: 'already_drafted',
              response_id: existing.id,
            });
            continue;
          }
        }

        try {
          const outcome = await draftSingleQuestion(
            supabase,
            question,
            id,
            model_tier,
          );

          // Accumulate cost/tokens after the pipeline runs, regardless of the
          // subsequent write outcome (matches the pre-extraction ordering).
          totalCost += outcome.draftResult.total_cost;
          totalTokens += outcome.draftResult.total_tokens;

          if (outcome.outcome === 'upsert_failed') {
            logger.error(
              { err: outcome.error },
              `Failed to save response for question ${question.id}`,
            );
            results.push({
              question_id: question.id,
              status: 'failed',
              error: 'Failed to save response',
            });
            continue;
          }

          if (outcome.outcome === 'update_failed') {
            // The response was upserted, but marking the question `ai_drafted`
            // failed — leaving it stranded (response saved, status not
            // advanced). Surface as failed (aligning with the queue handler)
            // rather than silently reporting it drafted.
            logger.error(
              { err: outcome.error },
              `Failed to mark question ${question.id} as drafted`,
            );
            results.push({
              question_id: question.id,
              status: 'failed',
              response_id: outcome.responseId,
              error: 'Failed to update question status',
            });
            continue;
          }

          // 'drafted' — the response was saved and the question marked.
          results.push({
            question_id: question.id,
            status: 'drafted',
            response_id: outcome.responseId,
            quality_score:
              outcome.draftResult.metadata.quality_data?.overall_score,
          });
        } catch (draftErr) {
          logger.error(
            { err: draftErr },
            `Failed to draft question ${question.id}`,
          );
          results.push({
            question_id: question.id,
            status: 'failed',
            error:
              draftErr instanceof Error
                ? draftErr.message
                : 'Drafting pipeline failed',
          });
        }
      }

      return NextResponse.json({
        drafted: results.filter((r) => r.status === 'drafted').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        failed: results.filter((r) => r.status === 'failed').length,
        results,
        total_cost: totalCost,
        total_tokens: totalTokens,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to draft responses') },
        { status: 500 },
      );
    }
  },
);
