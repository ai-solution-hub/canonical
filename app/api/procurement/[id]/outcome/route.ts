import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { parseBody } from '@/lib/validation';
import { ProcurementOutcomeBodySchema } from '@/lib/validation/schemas';
import { tryQuery } from '@/lib/supabase/safe';
import { computeWorkflowTransition } from '@/app/api/procurement/[id]/route';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ID-145 {145.19} group C (DR-075 §6 ruling): [id] IS the `form_instances` PK
// now — the workspace->single-form indirection this route used to walk is
// gone (`workspace_id` dropped W1c STEP 1). The canTransition-gated triad
// write is CONSOLIDATED into `computeWorkflowTransition`
// (`app/api/procurement/[id]/route.ts`) — this route DELEGATES to it instead
// of re-deriving the same validation (145.23 S470 journal: "outcome
// route.ts:105's transition writer duplicates [id]/route.ts:386's PATCH").
// `form_questions.form_template_id` -> `form_instance_id` (W1c STEP 4).
//
// ID-145 {145.6} W1c renamed `form_templates` -> `form_instances` — this
// route is authored against that POST-W1 schema even though the generated
// `database.types.ts` still reflects the PRE-W1 shape (same allowance
// {145.6}/{145.7}/{145.9}/{145.15}/{145.16} already took — typecheck drift
// against the stale generated types is EXPECTED here, journalled not
// chased).

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

      const raw = await request.json();
      const parsed = parseBody(ProcurementOutcomeBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { outcome, notes, integrate_to_kb } = parsed.data;

      // Verify the item exists + read its live workflow_state/form_type —
      // [id] IS the form now, so there is no more separate workspace lookup
      // followed by a "locate the workspace's single v1 form" query.
      const formResult = await tryQuery<{
        id: string;
        form_type: string | null;
        workflow_state: string;
      }>(
        supabase
          .from('form_instances')
          .select('id, form_type, workflow_state')
          .eq('id', id)
          .single(),
        'procurement.outcome.form',
      );
      if (!formResult.ok) {
        if (formResult.error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Procurement not found' },
            { status: 404 },
          );
        }
        throw formResult.error;
      }
      const targetForm = formResult.data;

      const currentState =
        (targetForm.workflow_state as ProcurementWorkflowState) ?? 'draft';

      // Delegate the canTransition-gated triad computation to the SINGLE
      // shared writer (DR-075 §6 consolidation) — this used to be
      // independently re-derived here against `form_templates`.
      const transition = computeWorkflowTransition({
        currentState,
        targetState: outcome as ProcurementWorkflowState,
        formType: targetForm.form_type,
        userId: user.id,
      });
      if (!transition.ok) {
        if (transition.reason === 'invalid_transition') {
          return NextResponse.json(
            {
              error: `Cannot transition from "${currentState}" to "${outcome}"`,
              current_status: currentState,
              requested_outcome: outcome,
            },
            { status: 400 },
          );
        }
        if (transition.reason === 'stage_mismatch') {
          return NextResponse.json(
            { error: transition.message },
            { status: 400 },
          );
        }
        logger.error(
          { formId: targetForm.id, outcome },
          'Terminal outcome missing audit provenance',
        );
        return NextResponse.json(
          { error: 'Terminal outcome requires audit provenance' },
          { status: 500 },
        );
      }

      // outcome_notes is this route's own concern (the `notes` body field) —
      // layered on top of the shared writer's {workflow_state, outcome,
      // outcome_recorded_at, outcome_recorded_by} triad. Never set on a
      // withdrawn transition (AD-4: no audit provenance for a non-outcome).
      const formUpdates: Record<string, unknown> = { ...transition.updates };
      if (outcome !== 'withdrawn') {
        formUpdates.outcome_notes = notes ?? null;
      }

      // UPDATE narrows on the form id. `.select()` lets us VERIFY a row was
      // actually written — a REST PATCH that matches zero rows silently
      // succeeds with an empty body (RLS / vanished row).
      //
      // ID-145 {145.23} round-2: `formUpdates` is `Record<string, unknown>`
      // (built from `computeWorkflowTransition`'s `WorkflowTransitionOutcome`
      // union, which returns the same loose shape) — cast through `unknown`
      // at the call boundary, same as `[id]/route.ts`'s PATCH handler.
      const updateResult = await tryQuery<Array<{ id: string }>>(
        supabase
          .from('form_instances')
          .update(
            formUpdates as unknown as Database['public']['Tables']['form_instances']['Update'],
          )
          .eq('id', targetForm.id)
          .select('id'),
        'procurement.outcome.formUpdate',
      );
      if (!updateResult.ok) {
        logger.error(
          { err: updateResult.error },
          'Failed to record bid outcome',
        );
        return NextResponse.json(
          { error: 'Failed to record outcome' },
          { status: 500 },
        );
      }
      if ((updateResult.data ?? []).length === 0) {
        // Zero rows matched — the item vanished or RLS blocked the write.
        return NextResponse.json(
          { error: 'Outcome could not be recorded' },
          { status: 409 },
        );
      }

      // If won and KB integration requested, return candidate responses.
      // ID-131 {131.28} Part 2 (HYBRID RETIRE) / BL-395: the recommendation is
      // always 'new_entry' now. 'update_existing' had no live consumer — the
      // KB integration review dialog already collapses any 'update_existing'
      // it receives onto 'new_entry' (see kb-integration-review.tsx's
      // normaliseAction) — so the source_record_ids-driven branch that used
      // to compute it was dead weight and has been removed.
      let kbCandidates: Array<{
        question_id: string;
        question_text: string;
        response_text: string | null;
        recommendation: 'new_entry' | 'skip';
      }> = [];

      if (outcome === 'won' && integrate_to_kb) {
        // Fetch all approved/edited responses for this item's questions.
        const questionsResult = await tryQuery<
          Array<{ id: string; question_text: string }>
        >(
          supabase
            .from('form_questions')
            .select('id, question_text')
            .eq('form_instance_id', targetForm.id),
          'procurement.outcome.questions',
        );
        if (!questionsResult.ok) {
          logger.error(
            { err: questionsResult.error },
            'Failed to fetch questions for KB integration',
          );
          return NextResponse.json(
            {
              error: safeErrorMessage(
                questionsResult.error,
                'Failed to fetch bid questions for KB integration',
              ),
            },
            { status: 500 },
          );
        }

        const questions = questionsResult.data ?? [];
        if (questions.length > 0) {
          const questionIds = questions.map((q) => q.id);
          const responsesResult = await tryQuery<
            Array<{
              question_id: string;
              response_text: string | null;
              review_status: string;
            }>
          >(
            supabase
              .from('form_responses')
              .select('question_id, response_text, review_status')
              .in('question_id', questionIds)
              .in('review_status', ['approved', 'edited']),
            'procurement.outcome.responses',
          );

          if (!responsesResult.ok) {
            logger.error(
              { err: responsesResult.error },
              'Failed to fetch responses for KB integration',
            );
            return NextResponse.json(
              {
                error: safeErrorMessage(
                  responsesResult.error,
                  'Failed to fetch bid responses for KB integration',
                ),
              },
              { status: 500 },
            );
          }

          const responses = responsesResult.data ?? [];
          const questionMap = new Map(
            questions.map((q) => [q.id, q.question_text]),
          );

          kbCandidates = responses.map((r) => ({
            question_id: r.question_id,
            question_text: questionMap.get(r.question_id) ?? '',
            response_text: r.response_text,
            recommendation: 'new_entry' as const,
          }));
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
  },
);
