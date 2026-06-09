import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { QuestionCreateBodySchema } from '@/lib/validation/schemas';
import { z } from 'zod';
import { sb } from '@/lib/supabase/safe';
import { logger } from '@/lib/logger';

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

/** GET /api/bids/:id/questions -- list all questions for a bid */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    // Verify bid exists.
    // Post-T2: discriminator via application_types JOIN.
    const { data: bid, error: procurementError } = await supabase
      .from('workspaces')
      .select('id, application_types!inner(key)')
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (procurementError || !bid) {
      return NextResponse.json(
        { error: 'Procurement not found' },
        { status: 404 },
      );
    }

    // Fetch questions ordered by section then question sequence.
    // Post-T2: `form_questions.workspace_id` → `workspace_id`.
    const { data: questions, error: questionsError } = await supabase
      .from('form_questions')
      .select(
        'id, workspace_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, matched_content_ids, status, has_variants, assigned_to, created_by, created_at, updated_at',
      )
      .eq('workspace_id', id)
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
    // NB: RPC signature `p_project_id` retained — RPC is part of an SQL function
    // signature that lives in a migration and is renamed separately (T4 scope).
    const { data: stats, error: statsError } = await supabase.rpc(
      'get_bid_question_stats',
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
}

/** POST /api/bids/:id/questions -- add a single question or batch of questions */
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

    const { allowed } = checkRateLimit(`questions:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();

    // Verify bid exists.
    // Post-T2: discriminator via application_types JOIN.
    const { data: bid, error: procurementError } = await supabase
      .from('workspaces')
      .select('id, application_types!inner(key)')
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (procurementError || !bid) {
      return NextResponse.json(
        { error: 'Procurement not found' },
        { status: 404 },
      );
    }

    // Try batch format first (from QuestionReview component)
    const batchParsed = parseBody(BatchQuestionCreateSchema, raw);
    if (batchParsed.success) {
      return handleBatchInsert(
        supabase,
        id,
        user.id,
        batchParsed.data.questions,
      );
    }

    // Fall back to single question format
    const parsed = parseBody(QuestionCreateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    // Get the max question_sequence for this bid to assign next sequence number.
    // Post-T2: `form_questions.workspace_id` → `workspace_id`.
    const maxSeqResult = await sb(
      supabase
        .from('form_questions')
        .select('question_sequence')
        .eq('workspace_id', id)
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

    // Post-T2: `form_questions.workspace_id` → `workspace_id` on insert + select.
    const { data: created, error: insertError } = await supabase
      .from('form_questions')
      .insert({
        workspace_id: id,
        section_name: section_name ?? null,
        question_text,
        question_sequence: nextSequence,
        section_sequence: 0,
        word_limit: word_limit ?? null,
        evaluation_weight: evaluation_weight ?? null,
        created_by: user.id,
      })
      .select(
        'id, workspace_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, matched_content_ids, assigned_to, created_by, created_at, updated_at',
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
}

/** Handle batch insert of questions from QuestionReview */
async function handleBatchInsert(
  supabase: SupabaseClient<Database>,
  procurementId: string,
  userId: string,
  questions: z.infer<typeof BatchQuestionCreateSchema>['questions'],
) {
  // Post-T2: `form_questions.workspace_id` → `workspace_id` on batch insert + select.
  const rows = questions.map((q) => ({
    workspace_id: procurementId,
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
      'id, workspace_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, matched_content_ids, assigned_to, created_by, created_at, updated_at',
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
