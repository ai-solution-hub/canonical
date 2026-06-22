import type { DraftableContent, DraftableQuestion } from '@/lib/ai/draft';
import { runDraftingPipeline } from '@/lib/ai/draft';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import { logger } from '@/lib/logger';
import type { ProcurementWorkflowState } from '@/lib/procurement/procurement-workflow';
import { checkRateLimit } from '@/lib/rate-limit';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { ResponseDraftBodySchema } from '@/lib/validation/schemas';
import type { Json } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
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
          // Fetch matched content items for this question
          const matchedIds = question.matched_content_ids ?? [];

          let matchedContent: DraftableContent[] = [];
          if (matchedIds.length > 0) {
            const { data: contentItems, error: contentError } = await supabase
              .from('content_items')
              .select('id, suggested_title, content, content_type, summary')
              .in('id', matchedIds);

            if (contentError) {
              // S151 WP4 (C1): never draft with empty source content on a DB
              // error — that produces a hallucinated response that looks
              // grounded. Fail the per-question draft loudly instead.
              throw new Error(
                `Failed to fetch matched content for question ${question.id}: ${contentError.message}`,
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

          // Run the three-pass drafting pipeline
          const draftResult = await runDraftingPipeline(
            draftableQuestion,
            matchedContent,
            model_tier,
          );

          totalCost += draftResult.total_cost;
          totalTokens += draftResult.total_tokens;

          // Upsert the response (overall_score written to both column and metadata for backward compat)
          const overallScore =
            draftResult.metadata.quality_data?.overall_score ?? null;
          const { data: response, error: upsertError } = await supabase
            .from('form_responses')
            .upsert(
              {
                question_id: question.id,
                response_text: draftResult.response_text,
                source_content_ids: draftResult.source_content_ids,
                metadata: draftResult.metadata as unknown as Json,
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
            logger.error(
              { err: upsertError },
              `Failed to save response for question ${question.id}`,
            );
            results.push({
              question_id: question.id,
              status: 'failed',
              error: 'Failed to save response',
            });
            continue;
          }

          // Update question status.
          // Post-T2: `form_questions.workspace_id` → `workspace_id`.
          await supabase
            .from('form_questions')
            .update({ status: 'ai_drafted' })
            .eq('id', question.id)
            .eq('workspace_id', id);

          results.push({
            question_id: question.id,
            status: 'drafted',
            response_id: response?.id,
            quality_score: draftResult.metadata.quality_data?.overall_score,
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
