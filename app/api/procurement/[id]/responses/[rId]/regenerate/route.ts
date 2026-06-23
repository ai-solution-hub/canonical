import type {
  DraftableContent,
  DraftableQuestion,
} from '@/lib/domains/procurement/ai/draft';
import { runDraftingPipeline } from '@/lib/domains/procurement/ai/draft';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ResponseRegenerateBodySchema } from '@/lib/validation/schemas';
import type { Json } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; rId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id, rId } = await params;
      if (!UUID_RE.test(id) || !UUID_RE.test(rId)) {
        return NextResponse.json(
          { error: 'Invalid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const rl = checkRateLimit(`regenerate:${user.id}`, 5, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const parsed = parseBody(ResponseRegenerateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { instructions, model_tier } = parsed.data;

      // Fetch existing response
      const { data: existing, error: fetchError } = await supabase
        .from('form_responses')
        .select('id, question_id, source_content_ids')
        .eq('id', rId)
        .single();

      if (fetchError || !existing) {
        return NextResponse.json(
          { error: 'Response not found' },
          { status: 404 },
        );
      }

      // Fetch the question and verify it belongs to this bid
      const { data: question, error: questionError } = await supabase
        .from('form_questions')
        .select(
          'id, question_text, word_limit, section_name, confidence_posture',
        )
        .eq('id', existing.question_id)
        .eq('workspace_id', id)
        .single();

      if (questionError || !question) {
        return NextResponse.json(
          { error: 'Response not found in this bid' },
          { status: 404 },
        );
      }

      // Fetch matched content items
      const matchedIds = existing.source_content_ids ?? [];
      let matchedContent: DraftableContent[] = [];

      if (matchedIds.length > 0) {
        const { data: contentItems, error: contentError } = await supabase
          .from('content_items')
          .select('id, suggested_title, content, content_type, summary')
          .in('id', matchedIds);

        if (contentError) {
          logger.error(
            { err: contentError },
            'Failed to fetch matched content for regenerate',
          );
          return NextResponse.json(
            {
              error: safeErrorMessage(
                contentError,
                'Failed to fetch matched content for regeneration',
              ),
            },
            { status: 500 },
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

      // Run the three-pass pipeline with regeneration instructions
      const draftResult = await runDraftingPipeline(
        draftableQuestion,
        matchedContent,
        model_tier,
        instructions,
      );

      // Update the response (overall_score written to both column and metadata for backward compat)
      const overallScore =
        draftResult.metadata.quality_data?.overall_score ?? null;
      const { data: updated, error: updateError } = await supabase
        .from('form_responses')
        .update({
          response_text: draftResult.response_text,
          source_content_ids: draftResult.source_content_ids,
          metadata: draftResult.metadata as unknown as Json,
          review_status: 'ai_drafted',
          last_edited_by: user.id,
          updated_at: new Date().toISOString(),
          overall_score: overallScore,
        })
        .eq('id', rId)
        .select('id')
        .single();

      if (updateError) {
        logger.error(
          { err: updateError },
          'Failed to save regenerated response',
        );
        return NextResponse.json(
          { error: 'Failed to save regenerated response' },
          { status: 500 },
        );
      }

      // Update question status back to ai_drafted
      await supabase
        .from('form_questions')
        .update({ status: 'ai_drafted' })
        .eq('id', question.id)
        .eq('workspace_id', id);

      return NextResponse.json({
        question_id: question.id,
        response: {
          id: updated?.id ?? rId,
          response_text: draftResult.response_text,
          citations: draftResult.citations,
          quality_check: draftResult.metadata.quality_data,
          model: draftResult.metadata.ai_metadata?.model,
          tokens_used: draftResult.total_tokens,
          cost: draftResult.total_cost,
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to regenerate response') },
        { status: 500 },
      );
    }
  },
);
