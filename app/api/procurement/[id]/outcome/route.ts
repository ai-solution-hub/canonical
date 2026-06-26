import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { canTransition } from '@/lib/domains/procurement/procurement-workflow';
import { parseBody } from '@/lib/validation';
import {
  ProcurementOutcomeBodySchema,
  validateFormOutcome,
} from '@/lib/validation/schemas';
import { tryQuery } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type FormTemplateUpdate =
  Database['public']['Tables']['form_templates']['Update'];

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ID-130 T-B9: outcome recording re-anchored to the FORM. The transition targets
// the workspace's single v1 form — it writes `form_templates.workflow_state` and,
// on a terminal won/lost, the `{outcome, outcome_recorded_at, outcome_recorded_by}`
// triad atomically (audit REQUIRED-ON-TERMINAL). `withdrawn` is a workflow
// terminal, NOT an outcome (AD-4): workflow_state='withdrawn' with outcome=NULL.
// This route is NEVER a writer of the deprecated `domain_metadata` engagement
// keys (split-brain guard). The roll-up is recomputed by the {130.6} AFTER
// trigger on the form's engagement-column writes.

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

      // Verify the umbrella exists + is a procurement workspace.
      // Post-T2: discriminator via the application_types JOIN.
      const workspaceResult = await tryQuery(
        supabase
          .from('workspaces')
          .select('id, application_types!inner(key)')
          .eq('id', id)
          .eq('application_types.key', 'procurement')
          .single(),
        'procurement.outcome.workspace',
      );
      if (!workspaceResult.ok) {
        if (workspaceResult.error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Procurement not found' },
            { status: 404 },
          );
        }
        throw workspaceResult.error;
      }

      // Locate the workspace's single v1 form (the engagement) — the transition
      // now targets the FORM, not the workspace.
      const formResult = await tryQuery<
        Array<{ id: string; form_type: string | null; workflow_state: string }>
      >(
        supabase
          .from('form_templates')
          .select('id, form_type, workflow_state')
          .eq('workspace_id', id)
          .order('created_at', { ascending: true }),
        'procurement.outcome.form',
      );
      if (!formResult.ok) throw formResult.error;
      const targetForm = formResult.data?.[0] ?? null;
      if (!targetForm) {
        return NextResponse.json(
          { error: 'Procurement has no form to record an outcome against' },
          { status: 409 },
        );
      }

      const currentState =
        (targetForm.workflow_state as ProcurementWorkflowState) ?? 'draft';

      // Validate the state transition against the FORM's live workflow_state.
      if (!canTransition(currentState, outcome as ProcurementWorkflowState)) {
        return NextResponse.json(
          {
            error: `Cannot transition from "${currentState}" to "${outcome}"`,
            current_status: currentState,
            requested_outcome: outcome,
          },
          { status: 400 },
        );
      }

      // Build the FORM update. The 10-state workflow value always moves; the
      // per-stage outcome + audit triad lands only on a terminal won/lost.
      const nowIso = new Date().toISOString();
      const formUpdates: FormTemplateUpdate = {
        workflow_state: outcome,
      };

      if (outcome === 'withdrawn') {
        // withdrawn is a workflow terminal, NOT an outcome (AD-4): clear it,
        // no audit provenance.
        formUpdates.outcome = null;
      } else {
        // won / lost: record the outcome + audit provenance atomically.
        formUpdates.outcome = outcome;
        formUpdates.outcome_notes = notes ?? null;
        formUpdates.outcome_recorded_at = nowIso;
        formUpdates.outcome_recorded_by = user.id;
      }

      // Stage-appropriateness guard (AD-4) — clean 400 before the DB trigger
      // would raise an opaque exception. Only when an outcome is being SET.
      if (formUpdates.outcome !== null && formUpdates.outcome !== undefined) {
        const stageError = validateFormOutcome(
          targetForm.form_type,
          outcome,
          formUpdates.outcome,
        );
        if (stageError) {
          return NextResponse.json({ error: stageError }, { status: 400 });
        }
      }

      // Audit REQUIRED-ON-TERMINAL (T-B9 / B-9): a won/lost outcome must carry
      // its provenance — enforced BEFORE the state commit.
      if (outcome === 'won' || outcome === 'lost') {
        if (
          !formUpdates.outcome_recorded_at ||
          !formUpdates.outcome_recorded_by
        ) {
          logger.error(
            { formId: targetForm.id, outcome },
            'Terminal outcome missing audit provenance',
          );
          return NextResponse.json(
            { error: 'Terminal outcome requires audit provenance' },
            { status: 500 },
          );
        }
      }

      // UPDATE narrows on the form id. `.select()` lets us VERIFY a row was
      // actually written — a REST PATCH that matches zero rows silently succeeds
      // with an empty body (RLS / vanished row).
      const updateResult = await tryQuery<Array<{ id: string }>>(
        supabase
          .from('form_templates')
          .update(formUpdates)
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
        // Zero rows matched — the form vanished or RLS blocked the write.
        return NextResponse.json(
          { error: 'Outcome could not be recorded' },
          { status: 409 },
        );
      }

      // The roll-up (procurement_workspaces) is recomputed automatically by the
      // {130.6} AFTER trigger on form_templates' engagement-column writes — no
      // explicit recompute_procurement_rollup call is needed here.

      // If won and KB integration requested, return candidate responses.
      let kbCandidates: Array<{
        question_id: string;
        question_text: string;
        response_text: string | null;
        source_content_ids: string[] | null;
        recommendation: 'new_entry' | 'update_existing' | 'skip';
      }> = [];

      if (outcome === 'won' && integrate_to_kb) {
        // Fetch all approved/edited responses for this engagement's form.
        const questionsResult = await tryQuery<
          Array<{ id: string; question_text: string }>
        >(
          supabase
            .from('form_questions')
            .select('id, question_text')
            .eq('form_template_id', targetForm.id),
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
              source_content_ids: string[] | null;
              review_status: string;
            }>
          >(
            supabase
              .from('form_responses')
              .select(
                'question_id, response_text, source_content_ids, review_status',
              )
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

          kbCandidates = responses.map((r) => {
            // Recommend based on whether sources exist.
            const hasExistingSources =
              r.source_content_ids && r.source_content_ids.length > 0;
            const recommendation = hasExistingSources
              ? ('update_existing' as const)
              : ('new_entry' as const);

            return {
              question_id: r.question_id,
              question_text: questionMap.get(r.question_id) ?? '',
              response_text: r.response_text,
              source_content_ids: r.source_content_ids,
              recommendation,
            };
          });
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
