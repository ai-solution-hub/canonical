// app/api/procurement/[id]/responses/manual/route.ts
//
// ID-145 {145.44} fix dispatch (BI-40/BI-22, DR-062 — new backend sanctioned).
//
// The zero-candidate manual-answer affordance's PRIMARY act: create a
// `form_responses` row directly from a user-typed answer, so the question
// deterministically stops being unanswered — never contingent on a later
// "Find answers" re-match clearing MATCH_THRESHOLDS. Corpus promotion (the
// existing `POST /api/q-a-pairs/batch`, ID-131 {131.21}) is a SEPARATE,
// OPTIONAL secondary act the client may call afterwards; this route makes no
// corpus write.
//
// Stamped `review_status: 'draft'` + `drafted_by: <acting user>` (never
// `PIPELINE_SYSTEM_USER_ID` — see `draftSingleQuestion`,
// lib/domains/procurement/draft-response.ts, for the AI-drafted precedent
// this mirrors and deliberately diverges from) — honestly labelled as
// human-authored, not auto-approved.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { ResponseManualCreateBodySchema } from '@/lib/validation/schemas';
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
      const { user, supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json().catch((_err) => null);
      const parsed = parseBody(ResponseManualCreateBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const { question_id, response_text } = parsed.data;

      // Verify the question belongs to this form. Mirrors the ownership
      // check in questions/[qId]/route.ts PATCH and responses/[rId]/route.ts.
      const { data: question, error: questionError } = await supabase
        .from('form_questions')
        .select('id')
        .eq('id', question_id)
        .eq('form_instance_id', id)
        .maybeSingle();

      if (questionError) {
        logger.error(
          { err: questionError },
          'Failed to verify question ownership for manual response',
        );
        return NextResponse.json(
          { error: 'Failed to verify question' },
          { status: 500 },
        );
      }
      if (!question) {
        return NextResponse.json(
          { error: 'Question not found for this bid' },
          { status: 404 },
        );
      }

      // Plain INSERT (not upsert) -- `form_responses.question_id` is unique
      // (see draftSingleQuestion's `onConflict: 'question_id'` upsert), so an
      // existing response surfaces as a 23505 conflict below rather than
      // being silently overwritten. The manual-answer affordance is scoped to
      // questions with no response yet; this is the defensive backstop for
      // a race (e.g. a concurrent AI draft) between that check and this call.
      const { data: created, error: insertError } = await supabase
        .from('form_responses')
        .insert({
          question_id,
          response_text,
          review_status: 'draft',
          drafted_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .select(
          'id, question_id, response_text, review_status, drafted_by, created_at, updated_at',
        )
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          return NextResponse.json(
            { error: 'This question already has a response' },
            { status: 409 },
          );
        }
        logger.error({ err: insertError }, 'Failed to save manual response');
        return NextResponse.json(
          { error: 'Failed to save manual response' },
          { status: 500 },
        );
      }

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to save manual response') },
        { status: 500 },
      );
    }
  },
);
