import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { QuestionCreateBodySchema } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

/** Schema for batch question insert (from QuestionReview) */
const BatchQuestionCreateSchema = z.object({
  questions: z
    .array(
      z.object({
        section_name: z.string().max(200).optional(),
        section_sequence: z.number().int().min(0).optional().default(0),
        question_sequence: z.number().int().min(0).optional().default(0),
        question_text: z
          .string()
          .trim()
          .min(1, 'Question text is required')
          .max(5000),
        word_limit: z.number().int().min(1).max(100000).nullable().optional(),
        evaluation_weight: z.number().min(0).max(100).nullable().optional(),
        category: z.string().max(50).optional(),
      }),
    )
    .min(1, 'At least one question is required')
    .max(500),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // ID-145 {145.7} — form-first: the route [id] IS the form_instances id
      // directly (BI-1/BI-2). No more workspace lookup/discriminator join —
      // form_instances carries no workspace_id post-{145.6} M3.
      const { data: form, error: formError } = await supabase
        .from('form_instances')
        .select('id')
        .eq('id', id)
        .single();

      if (formError || !form) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Fetch questions ordered by section then question sequence.
      // ID-145 {145.7}: `form_questions.workspace_id` is dropped ({145.6} M3)
      // — scope on `form_instance_id` (the sole scoping key post form-first
      // re-architecture, BI-7). `matched_record_ids` is also dropped (M3) —
      // no longer selected.
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select(
          'id, form_instance_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, status, has_variants, assigned_to, created_by, created_at, updated_at',
        )
        .eq('form_instance_id', id)
        .order('section_sequence', { ascending: true })
        .order('question_sequence', { ascending: true });

      if (questionsError) {
        logger.error({ err: questionsError }, 'Failed to fetch bid questions');
        return NextResponse.json(
          { error: 'Failed to fetch bid questions' },
          { status: 500 },
        );
      }

      // For each question, fetch response preview via left join
      const questionIds = (questions ?? []).map((q) => q.id);
      let responsePreviews: Record<
        string,
        { id: string; review_status: string; word_count: number }
      > = {};
      const warnings: string[] = [];

      if (questionIds.length > 0) {
        const { data: responses, error: responsesError } = await supabase
          .from('form_responses')
          .select('id, question_id, review_status, response_text')
          .in('question_id', questionIds);

        if (responsesError) {
          logger.error(
            { err: responsesError },
            'Failed to fetch response previews',
          );
          warnings.push(
            'Response previews could not be loaded; questions may appear unanswered. ' +
              safeErrorMessage(responsesError, 'response preview fetch failed'),
          );
        }

        if (responses) {
          responsePreviews = Object.fromEntries(
            responses.map(
              (r: {
                id: string;
                question_id: string;
                review_status: string;
                response_text: string | null;
              }) => [
                r.question_id,
                {
                  id: r.id,
                  review_status: r.review_status,
                  word_count: r.response_text
                    ? r.response_text.split(/\s+/).filter(Boolean).length
                    : 0,
                },
              ],
            ),
          );
        }
      }

      // Enrich questions with response preview
      const enrichedQuestions = (questions ?? []).map((q) => ({
        ...q,
        response: responsePreviews[q.id] ?? null,
      }));

      // Fetch question stats via RPC.
      // NB: RPC signature `p_project_id` retained — the {145.6} migration
      // re-points this function's body from the dropped
      // form_questions.workspace_id to form_instance_id (its parameter name
      // stays p_project_id for caller-signature stability, matching the T2
      // carve-out precedent) — `id` here now correctly means the form's id.
      const { data: stats, error: statsError } = await supabase.rpc(
        'get_form_question_stats',
        {
          p_project_id: id,
        },
      );

      if (statsError) {
        logger.error({ err: statsError }, 'Failed to fetch bid question stats');
        warnings.push(
          'Question stats could not be loaded. ' +
            safeErrorMessage(statsError, 'stats RPC failed'),
        );
      }

      const responseBody: Record<string, unknown> = {
        questions: enrichedQuestions,
        stats: stats?.[0] ?? null,
      };
      if (warnings.length > 0) responseBody.warnings = warnings;
      return NextResponse.json(responseBody);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch bid questions') },
        { status: 500 },
      );
    }
  },
);

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

      const { allowed } = checkRateLimit(`questions:${user.id}`, 30, 60_000);
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();

      // ID-145 {145.7} — form-first: the route [id] IS the form_instances id
      // directly (BI-1/BI-2). The form already exists form-first (created via
      // {145.8}), so a question attaches to the KNOWN form_instance_id — no
      // resolve-or-mint step.
      const { data: form, error: formError } = await supabase
        .from('form_instances')
        .select('id')
        .eq('id', id)
        .single();

      if (formError || !form) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Try batch format first (from QuestionReview component)
      const batchParsed = parseBody(BatchQuestionCreateSchema, raw);
      if (batchParsed.success) {
        // {130.27}/{145.7}: MUST await here, not just `return`.
        // handleBatchInsert() is async and can throw — `return
        // handleBatchInsert(...)` without awaiting exits this try block
        // before the promise settles, so a later rejection would NOT be
        // caught by this function's own catch below and would surface as an
        // unstructured 500 instead of the `{ error: safeErrorMessage(...) }`
        // shape every other failure path here returns.
        return await handleBatchInsert(
          supabase,
          id,
          user.id,
          batchParsed.data.questions,
        );
      }

      // Fall back to single question format
      const parsed = parseBody(QuestionCreateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      // Get the max question_sequence for this form to assign next sequence
      // number. ID-145 {145.7}: `form_questions.workspace_id` is dropped
      // ({145.6} M3) — scope on `form_instance_id`.
      const maxSeqResult = await sb(
        supabase
          .from('form_questions')
          .select('question_sequence')
          .eq('form_instance_id', id)
          .order('question_sequence', { ascending: false })
          .limit(1),
        'bids.questions.list.maxSequence',
      );

      const nextSequence =
        maxSeqResult.length > 0
          ? (maxSeqResult[0].question_sequence ?? 0) + 1
          : 1;

      const { section_name, question_text, word_limit, evaluation_weight } =
        parsed.data;

      // ID-145 {145.7}: `form_questions.form_instance_id` is the route's own
      // [id] — no resolve-or-mint (the {130.27} RPC + its TS resolver are
      // retired, {145.6} M3/{145.7}). form_questions.form_instance_id is NOT
      // NULL post-migration, so every insert MUST carry a real form id — it
      // always does, since it is the route param itself.
      const { data: created, error: insertError } = await supabase
        .from('form_questions')
        .insert({
          form_instance_id: id,
          section_name: section_name ?? null,
          question_text,
          question_sequence: nextSequence,
          section_sequence: 0,
          word_limit: word_limit ?? null,
          evaluation_weight: evaluation_weight ?? null,
          created_by: user.id,
        })
        .select(
          'id, form_instance_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, assigned_to, created_by, created_at, updated_at',
        )
        .single();

      if (insertError) {
        logger.error({ err: insertError }, 'Failed to create bid question');
        return NextResponse.json(
          { error: 'Failed to create bid question' },
          { status: 500 },
        );
      }

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create bid question') },
        { status: 500 },
      );
    }
  },
);

/** Handle batch insert of questions from QuestionReview */
async function handleBatchInsert(
  supabase: SupabaseClient<Database>,
  formInstanceId: string,
  userId: string,
  questions: z.infer<typeof BatchQuestionCreateSchema>['questions'],
) {
  // ID-145 {145.7}: formInstanceId IS the route's own [id] — every batch row
  // is stamped with it directly, no resolve-or-mint (see the single-insert
  // POST handler above for the full rationale).
  const rows = questions.map((q) => ({
    form_instance_id: formInstanceId,
    section_name: q.section_name ?? null,
    section_sequence: q.section_sequence ?? 0,
    question_sequence: q.question_sequence ?? 0,
    question_text: q.question_text,
    word_limit: q.word_limit ?? null,
    evaluation_weight: q.evaluation_weight ?? null,
    created_by: userId,
  }));

  const { data: created, error: insertError } = await supabase
    .from('form_questions')
    .insert(rows)
    .select(
      'id, form_instance_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, assigned_to, created_by, created_at, updated_at',
    );

  if (insertError) {
    logger.error({ err: insertError }, 'Failed to batch create bid questions');
    return NextResponse.json(
      { error: 'Failed to batch create bid questions' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { questions: created, count: created?.length ?? 0 },
    { status: 201 },
  );
}
