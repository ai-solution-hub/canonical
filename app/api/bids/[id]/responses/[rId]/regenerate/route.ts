import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ResponseRegenerateBodySchema } from '@/lib/validation/schemas';
import { runDraftingPipeline } from '@/lib/ai/draft';
import type { DraftableQuestion, DraftableContent } from '@/lib/ai/draft';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/responses/:rId/regenerate -- re-draft with different instructions */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { id, rId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(rId)) {
      return NextResponse.json(
        { error: 'Invalid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const { allowed } = checkRateLimit(`regenerate:${user.id}`, 3, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(ResponseRegenerateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { instructions, model_tier } = parsed.data;

    // Fetch existing response
    const { data: existing, error: fetchError } = await supabase
      .from('bid_responses')
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
      .from('bid_questions')
      .select('id, question_text, word_limit, section_name, confidence_posture')
      .eq('id', existing.question_id)
      .eq('project_id', id)
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

    // Run the three-pass pipeline with regeneration instructions
    const draftResult = await runDraftingPipeline(
      draftableQuestion,
      matchedContent,
      model_tier,
      instructions,
    );

    // Update the response
    const { data: updated, error: updateError } = await supabase
      .from('bid_responses')
      .update({
        response_text: draftResult.response_text,
        source_content_ids: draftResult.source_content_ids,
        metadata: draftResult.metadata as unknown as Json,
        review_status: 'ai_drafted',
        last_edited_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rId)
      .select('id')
      .single();

    if (updateError) {
      console.error('Failed to save regenerated response:', updateError);
      return NextResponse.json(
        { error: 'Failed to save regenerated response' },
        { status: 500 },
      );
    }

    // Update question status back to ai_drafted
    await supabase
      .from('bid_questions')
      .update({ status: 'ai_drafted' })
      .eq('id', question.id)
      .eq('project_id', id);

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
}
