import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { recomputeQuestionMatches } from '@/lib/domains/procurement/question-match-recompute';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { parseBody } from '@/lib/validation';
import { QuestionUpdateBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; qId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id, qId } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }
      if (!UUID_RE.test(qId)) {
        return NextResponse.json(
          { error: 'Invalid question ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json();
      const parsed = parseBody(QuestionUpdateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const updates = parsed.data;

      // Ensure there is at least one field to update
      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: 'No fields to update' },
          { status: 400 },
        );
      }

      // ID-145 {145.6} M3 / {145.17}: `form_questions.workspace_id` and
      // `matched_record_ids` are dropped — scope on `form_instance_id`
      // (the route's own [id]), matching the sibling routes/route.ts and
      // extract/route.ts (already re-pointed at {145.7}; this file was not
      // touched by that Subtask — see the {145.17} journal).
      const { data: updated, error } = await supabase
        .from('form_questions')
        .update(updates)
        .eq('id', qId)
        .eq('form_instance_id', id)
        .select(
          'id, form_instance_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, assigned_to, created_by, created_at, updated_at',
        )
        .single();

      if (error) {
        // PostgREST returns PGRST116 when no rows match .single()
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Question not found for this bid' },
            { status: 404 },
          );
        }
        logger.error({ err: error }, 'Failed to update bid question');
        return NextResponse.json(
          { error: 'Failed to update bid question' },
          { status: 500 },
        );
      }

      // ID-145 {145.17} (R7/BI-34) — recompute question_matches on every
      // successful update (PRODUCT BI-34: "When a question is created or
      // updated, its question_matches are recomputed"; unconditional on
      // which field changed — generateEmbedding's own 1h cache makes a
      // repeat call over an unchanged question_text cheap). Best-effort
      // internally (see helper docstring); a separate best-effort lookup
      // since this route performs no existence-check form_instances read
      // elsewhere (unlike the sibling create/extract routes).
      const { data: form, error: formError } = await supabase
        .from('form_instances')
        .select('form_type')
        .eq('id', id)
        .maybeSingle();
      if (formError) {
        logBestEffortWarn(
          'procurement.questions.form_type_lookup',
          'Failed to look up form_type for question_matches recompute',
          { formInstanceId: id, error: formError.message },
        );
      }
      await recomputeQuestionMatches(supabase, {
        formQuestionId: updated.id,
        questionText: updated.question_text,
        formType: form?.form_type ?? null,
      });

      return NextResponse.json(updated);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update bid question') },
        { status: 500 },
      );
    }
  },
);

export const DELETE = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; qId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id, qId } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }
      if (!UUID_RE.test(qId)) {
        return NextResponse.json(
          { error: 'Invalid question ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // ID-145 {145.6} M3 / {145.17}: `form_questions.workspace_id` is
      // dropped — scope on `form_instance_id` (see the PATCH handler above
      // for the full rationale). CASCADE (`question_matches_form_question_
      // id_fkey`) cleans up any question_matches rows for the deleted
      // question — no explicit recompute/cleanup call needed here.
      const { error } = await supabase
        .from('form_questions')
        .delete()
        .eq('id', qId)
        .eq('form_instance_id', id);

      if (error) {
        logger.error({ err: error }, 'Failed to delete bid question');
        return NextResponse.json(
          { error: 'Failed to delete bid question' },
          { status: 500 },
        );
      }

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete bid question') },
        { status: 500 },
      );
    }
  },
);
