import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import { canTransition } from '@/lib/domains/procurement/procurement-workflow';
import { parseBody } from '@/lib/validation';
import {
  FINAL_AWARD_FORM_TYPES,
  FormOutcomeSchema,
  ProcurementUpdateBodySchema,
  SHORTLIST_FORM_TYPES,
  parseProcurementMetadata,
} from '@/lib/validation/schemas';
import { tryQuery } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update'];
type FormTemplateUpdate =
  Database['public']['Tables']['form_templates']['Update'];

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ID-130 AD-1: the per-stage procurement engagement facts now live on the FORM
// (`form_templates`), NOT on `workspaces.domain_metadata`. The umbrella read
// surface reads the workspace identity + the materialised roll-up
// (`procurement_workspaces`) + the child-form list off `form_templates`; the
// write surface transitions the workspace's single v1 form's `workflow_state`
// and records the outcome/audit on that form. `domain_metadata` is DEPRECATED
// for the {status, outcome, deadline, submission_date, outcome_recorded_*}
// engagement keys — this route is NEVER a writer for them (split-brain guard).

/** Engagement fact columns this route lists for each child form (T-B1). */
const FORM_LIST_COLUMNS =
  'id, form_type, name, workflow_state, outcome, outcome_notes, deadline, submission_date, issuing_organisation, outcome_recorded_at, outcome_recorded_by, created_at, updated_at';

/** Known procurement form types (mirror of the `form_outcome_types` CV stages). */
const KNOWN_FORM_TYPES = new Set<string>([
  ...FINAL_AWARD_FORM_TYPES,
  ...SHORTLIST_FORM_TYPES,
]);

/**
 * App-layer mirror of the DB `form_templates_outcome_form_type_check` trigger
 * (ID-130 AD-4 / T-B5). Returns a human-readable error string if the outcome is
 * not stage-appropriate for the form_type, or `null` when the triad is valid (or
 * the form_type is unclassified — the DB FK + trigger remain the backstop).
 */
function validateFormOutcome(
  formType: string | null,
  workflowState: string,
  outcome: string | null,
): string | null {
  if (!formType || !KNOWN_FORM_TYPES.has(formType)) return null;
  const result = FormOutcomeSchema.safeParse({
    form_type: formType,
    workflow_state: workflowState,
    outcome,
  });
  if (!result.success) {
    return `Outcome "${outcome ?? 'null'}" is not valid for a "${formType}" form`;
  }
  return null;
}

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

      // Workspace identity (the umbrella). The per-stage facts NO LONGER live on
      // `domain_metadata` — they are read off the roll-up + the child forms below.
      // Post-T2: discriminator via the application_types JOIN.
      const workspaceResult = await tryQuery(
        supabase
          .from('workspaces')
          .select(
            'id, name, description, is_archived, created_by, created_at, updated_at, updated_by, application_types!inner(key)',
          )
          .eq('id', id)
          .eq('application_types.key', 'procurement')
          .single(),
        'procurement.detail.workspace',
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

      // Strip the joined projection — callers expect flat workspace fields.
      const { application_types: _appTypes, ...workspace } =
        workspaceResult.data;

      // Composite view: the roll-up, child-form list, question stats and tender
      // documents are independent enrichments of the umbrella detail page. A
      // failure in any ONE should not 500 the whole page — sibling tabs render
      // fine without them. Surface failures via the canonical warnings[] envelope
      // (matches H1 dashboard / H14 template detail / M8 questions list —
      // s151-fail-fast-partial-response-decisions.md).
      const warnings: string[] = [];

      // Materialised roll-up (procurement_workspaces). May not exist yet for a
      // brand-new umbrella — `.maybeSingle()` returns null in that case.
      let rollup: Pick<
        Database['public']['Tables']['procurement_workspaces']['Row'],
        | 'nearest_deadline'
        | 'overall_outcome'
        | 'counts_toward_win_rate'
        | 'rollup_updated_at'
      > | null = null;
      const rollupResult = await tryQuery(
        supabase
          .from('procurement_workspaces')
          .select(
            'nearest_deadline, overall_outcome, counts_toward_win_rate, rollup_updated_at',
          )
          .eq('workspace_id', id)
          .maybeSingle(),
        'procurement.detail.rollup',
      );
      if (!rollupResult.ok) {
        logger.error(
          { err: rollupResult.error },
          'Failed to fetch procurement roll-up',
        );
        warnings.push(
          'Roll-up could not be loaded: ' +
            safeErrorMessage(rollupResult.error, 'rollup query failed'),
        );
      } else {
        rollup = rollupResult.data;
      }

      // Child forms list (the engagement forms held by this umbrella).
      let forms: unknown[] = [];
      const formsResult = await tryQuery(
        supabase
          .from('form_templates')
          .select(FORM_LIST_COLUMNS)
          .eq('workspace_id', id)
          .order('created_at', { ascending: true }),
        'procurement.detail.forms',
      );
      if (!formsResult.ok) {
        logger.error(
          { err: formsResult.error },
          'Failed to list procurement forms',
        );
        warnings.push(
          'Child forms could not be loaded: ' +
            safeErrorMessage(formsResult.error, 'forms query failed'),
        );
      } else {
        forms = formsResult.data ?? [];
      }

      // Question statistics (independent enrichment — keyed on the workspace id;
      // the RPC still aggregates per workspace).
      let questionStats: unknown = null;
      const statsResult = await tryQuery<Array<Record<string, unknown>>>(
        supabase.rpc('get_form_question_stats', { p_project_id: id }),
        'procurement.detail.stats',
      );
      if (!statsResult.ok) {
        logger.error(
          { err: statsResult.error },
          'Failed to fetch bid question stats',
        );
        warnings.push(
          'Question stats could not be loaded: ' +
            safeErrorMessage(statsResult.error, 'stats RPC failed'),
        );
      } else {
        questionStats = statsResult.data?.[0] ?? null;
      }

      // List tender documents from storage (not a PostgREST query — kept as a
      // raw storage call with an explicit error check).
      const { data: files, error: filesError } = await supabase.storage
        .from('tender-documents')
        .list(id, {
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' },
        });

      if (filesError) {
        logger.error({ err: filesError }, 'Failed to list tender documents');
        warnings.push(
          'Tender documents could not be listed: ' +
            safeErrorMessage(filesError, 'storage list failed'),
        );
      }

      const tenderDocuments = (files ?? []).map((file) => ({
        path: `${id}/${file.name}`,
        filename: file.name,
        size: file.metadata?.size ?? 0,
        mime_type: file.metadata?.mimetype ?? 'application/octet-stream',
        uploaded_at: file.created_at,
      }));

      const responseBody: Record<string, unknown> = {
        ...workspace,
        rollup,
        forms,
        question_stats: questionStats,
        tender_documents: tenderDocuments,
      };
      if (warnings.length > 0) {
        responseBody.warnings = warnings;
      }
      return NextResponse.json(responseBody);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch bid') },
        { status: 500 },
      );
    }
  },
);

export const PATCH = defineRoute(
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
      const parsed = parseBody(ProcurementUpdateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const {
        name,
        description,
        status,
        buyer,
        deadline,
        submission_date,
        outcome,
        outcome_notes,
        reference_number,
        estimated_value,
        notes,
      } = parsed.data;

      // Verify the umbrella exists + is a procurement workspace. We still read
      // domain_metadata to preserve the RESIDUAL fields (reference_number /
      // estimated_value / notes) that have no form home — but we NEVER write the
      // deprecated engagement keys back into it.
      const workspaceResult = await tryQuery(
        supabase
          .from('workspaces')
          .select(
            'id, name, description, domain_metadata, application_types!inner(key)',
          )
          .eq('id', id)
          .eq('application_types.key', 'procurement')
          .single(),
        'procurement.patch.workspace',
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
      const current = workspaceResult.data;

      // Which incoming fields target the FORM (the engagement) vs the workspace?
      const touchesForm =
        status !== undefined ||
        buyer !== undefined ||
        deadline !== undefined ||
        submission_date !== undefined ||
        outcome !== undefined ||
        outcome_notes !== undefined;

      let updatedForm: Record<string, unknown> | null = null;
      let targetForm: {
        id: string;
        form_type: string | null;
        workflow_state: string;
      } | null = null;

      if (touchesForm) {
        // Locate the workspace's single v1 form (the engagement). Multi-form
        // umbrellas gain a form id in the path in a later Subtask; v1 has exactly
        // one form, so we operate on the earliest-created one.
        const formResult = await tryQuery<
          Array<{
            id: string;
            form_type: string | null;
            workflow_state: string;
          }>
        >(
          supabase
            .from('form_templates')
            .select('id, form_type, workflow_state')
            .eq('workspace_id', id)
            .order('created_at', { ascending: true }),
          'procurement.patch.form',
        );
        if (!formResult.ok) throw formResult.error;
        targetForm = formResult.data?.[0] ?? null;
        if (!targetForm) {
          return NextResponse.json(
            { error: 'Procurement has no form to update' },
            { status: 409 },
          );
        }

        // Validate the state transition against the FORM's live workflow_state.
        if (status) {
          const currentState =
            (targetForm.workflow_state as ProcurementWorkflowState) ?? 'draft';
          if (
            !canTransition(currentState, status as ProcurementWorkflowState)
          ) {
            return NextResponse.json(
              {
                error: `Cannot transition from "${currentState}" to "${status}"`,
                current_status: currentState,
                requested_status: status,
              },
              { status: 400 },
            );
          }
        }

        // Build the FORM update — the engagement facts re-anchored off
        // domain_metadata onto first-class form columns.
        const formUpdates: FormTemplateUpdate = {};
        const nowIso = new Date().toISOString();

        if (status !== undefined) {
          formUpdates.workflow_state = status;
          // submission_date stamped server-side on the submitted transition.
          if (status === 'submitted') formUpdates.submission_date = nowIso;
          // Terminal won/lost record the per-stage outcome + audit provenance.
          if (status === 'won' || status === 'lost') {
            formUpdates.outcome = status;
            formUpdates.outcome_recorded_at = nowIso;
            formUpdates.outcome_recorded_by = user.id;
          }
          // withdrawn is a workflow terminal, NOT an outcome (AD-4): clear it.
          if (status === 'withdrawn') {
            formUpdates.outcome = null;
          }
        }

        // Explicit outcome field (legacy PATCH shape) records onto the form too.
        if (outcome !== undefined) {
          if (outcome === 'withdrawn') {
            formUpdates.outcome = null;
          } else {
            formUpdates.outcome = outcome;
            formUpdates.outcome_recorded_at = nowIso;
            formUpdates.outcome_recorded_by = user.id;
          }
        }

        if (deadline !== undefined) formUpdates.deadline = deadline;
        if (submission_date !== undefined)
          formUpdates.submission_date = submission_date;
        if (buyer !== undefined) formUpdates.issuing_organisation = buyer;
        if (outcome_notes !== undefined)
          formUpdates.outcome_notes = outcome_notes;

        // Stage-appropriateness guard (AD-4) — clean 400 before the DB trigger
        // would raise an opaque exception. Only when an outcome is being SET.
        if (formUpdates.outcome !== undefined && formUpdates.outcome !== null) {
          const stageError = validateFormOutcome(
            targetForm.form_type,
            (formUpdates.workflow_state as string) ?? targetForm.workflow_state,
            formUpdates.outcome,
          );
          if (stageError) {
            return NextResponse.json({ error: stageError }, { status: 400 });
          }
        }

        // Audit REQUIRED-ON-TERMINAL (T-B9 / B-9): a won/lost outcome must carry
        // its provenance — enforced BEFORE the state commit.
        if (formUpdates.outcome === 'won' || formUpdates.outcome === 'lost') {
          if (
            !formUpdates.outcome_recorded_at ||
            !formUpdates.outcome_recorded_by
          ) {
            logger.error(
              { formId: targetForm.id, outcome: formUpdates.outcome },
              'Terminal outcome missing audit provenance',
            );
            return NextResponse.json(
              { error: 'Terminal outcome requires audit provenance' },
              { status: 500 },
            );
          }
        }

        // UPDATE narrows on the form id. `.select()` lets us VERIFY a row was
        // actually written — a REST PATCH that matches zero rows silently
        // succeeds with an empty body (RLS / vanished row).
        const formUpdateResult = await tryQuery<Array<Record<string, unknown>>>(
          supabase
            .from('form_templates')
            .update(formUpdates)
            .eq('id', targetForm.id)
            .select(FORM_LIST_COLUMNS),
          'procurement.patch.formUpdate',
        );
        if (!formUpdateResult.ok) {
          logger.error(
            { err: formUpdateResult.error },
            'Failed to update procurement form',
          );
          return NextResponse.json(
            { error: 'Failed to update procurement' },
            { status: 500 },
          );
        }
        const updatedRows = formUpdateResult.data ?? [];
        if (updatedRows.length === 0) {
          // Zero rows matched — the form vanished or RLS blocked the write.
          return NextResponse.json(
            { error: 'Procurement form could not be updated' },
            { status: 409 },
          );
        }
        updatedForm = updatedRows[0];
      }

      // Workspace-level update: identity (name/description) + RESIDUAL metadata
      // that has no form home. The deprecated engagement keys are STRIPPED so
      // this route never re-persists them (split-brain guard).
      const touchesWorkspace =
        name !== undefined ||
        description !== undefined ||
        reference_number !== undefined ||
        estimated_value !== undefined ||
        notes !== undefined;

      let updatedWorkspaceName = current.name;
      let updatedWorkspaceDescription = current.description;

      if (touchesWorkspace) {
        const workspaceUpdates: WorkspaceUpdate = {
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        };
        if (name !== undefined) workspaceUpdates.name = name;
        if (description !== undefined)
          workspaceUpdates.description = description;

        if (
          reference_number !== undefined ||
          estimated_value !== undefined ||
          notes !== undefined
        ) {
          const currentMetadata =
            parseProcurementMetadata(current.domain_metadata) ??
            (current.domain_metadata as Record<string, unknown> | null) ??
            {};
          // Strip the DEPRECATED engagement keys — they live on the form now and
          // must NEVER be re-written here.
          const {
            status: _status,
            outcome: _outcome,
            deadline: _deadline,
            submission_date: _submissionDate,
            outcome_recorded_at: _recordedAt,
            outcome_recorded_by: _recordedBy,
            ...preservedMetadata
          } = currentMetadata as Record<string, unknown>;
          const nextMetadata: Record<string, unknown> = {
            ...preservedMetadata,
          };
          if (reference_number !== undefined)
            nextMetadata.reference_number = reference_number;
          if (estimated_value !== undefined)
            nextMetadata.estimated_value = estimated_value;
          if (notes !== undefined) nextMetadata.notes = notes;
          workspaceUpdates.domain_metadata =
            nextMetadata as WorkspaceUpdate['domain_metadata'];
        }

        const workspaceUpdateResult = await tryQuery<
          Array<{ id: string; name: string; description: string | null }>
        >(
          supabase
            .from('workspaces')
            .update(workspaceUpdates)
            .eq('id', id)
            .select('id, name, description'),
          'procurement.patch.workspaceUpdate',
        );
        if (!workspaceUpdateResult.ok) {
          if (workspaceUpdateResult.error.code === '23505') {
            return NextResponse.json(
              { error: 'A bid with that name already exists' },
              { status: 409 },
            );
          }
          logger.error(
            { err: workspaceUpdateResult.error },
            'Failed to update bid',
          );
          return NextResponse.json(
            { error: 'Failed to update bid' },
            { status: 500 },
          );
        }
        const updatedWorkspace = workspaceUpdateResult.data?.[0];
        if (!updatedWorkspace) {
          return NextResponse.json(
            { error: 'Procurement not found' },
            { status: 404 },
          );
        }
        updatedWorkspaceName = updatedWorkspace.name;
        updatedWorkspaceDescription = updatedWorkspace.description;
      }

      // The roll-up (procurement_workspaces) is recomputed automatically by the
      // {130.6} AFTER trigger on form_templates' engagement-column writes — no
      // explicit recompute_procurement_rollup call is needed here.

      const resolvedForm = (updatedForm ?? targetForm) as Record<
        string,
        unknown
      > | null;
      return NextResponse.json({
        id,
        name: updatedWorkspaceName,
        description: updatedWorkspaceDescription,
        workflow_state:
          (resolvedForm?.workflow_state as string | undefined) ?? null,
        outcome: (resolvedForm?.outcome as string | undefined) ?? null,
        form: resolvedForm,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update bid') },
        { status: 500 },
      );
    }
  },
);

export const DELETE = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Verify bid exists before cleanup.
      // Post-T2: discriminator via application_types JOIN.
      const { data: bid, error: fetchError } = await supabase
        .from('workspaces')
        .select('id, domain_metadata, application_types!inner(key)')
        .eq('id', id)
        .eq('application_types.key', 'procurement')
        .single();

      if (fetchError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Clean up storage files before DB delete (best-effort).
      // Errors here orphan storage objects but must NOT block the DB delete —
      // we still log every failure so the data-hygiene leak is observable.
      try {
        const { createServiceClient } = await import('@/lib/supabase/server');
        const serviceClient = createServiceClient();

        // Delete tender documents
        const { data: tenderFiles, error: tenderListError } =
          await serviceClient.storage
            .from('tender-documents')
            .list(id, { limit: 200 });
        if (tenderListError) {
          logger.error(
            { procurementId: id, error: tenderListError },
            'Procurement DELETE: failed to list tender documents for cleanup',
          );
        }
        if (tenderFiles?.length) {
          const { error: tenderRemoveError } = await serviceClient.storage
            .from('tender-documents')
            .remove(tenderFiles.map((f) => `${id}/${f.name}`));
          if (tenderRemoveError) {
            logger.error(
              { procurementId: id, error: tenderRemoveError },
              'Procurement DELETE: failed to remove tender documents (orphaned)',
            );
          }
        }

        // Delete template files and completions.
        // Post-T2: `templates` → `form_templates`, `workspace_id` → `workspace_id`.
        const { data: templates, error: templatesError } = await supabase
          .from('form_templates')
          .select('id, storage_path, structure_path')
          .eq('workspace_id', id);
        if (templatesError) {
          logger.error(
            { procurementId: id, error: templatesError },
            'Procurement DELETE: failed to list templates for cleanup (orphaned files possible)',
          );
        }

        if (templates?.length) {
          const templatePaths = templates
            .flatMap((t) => [t.storage_path, t.structure_path])
            .filter(Boolean) as string[];

          // Get completed template files
          const templateIds = templates.map((t) => t.id);
          const { data: completions, error: completionsError } = await supabase
            .from('template_completions')
            .select('storage_path')
            .in('template_id', templateIds);
          if (completionsError) {
            logger.error(
              { procurementId: id, error: completionsError },
              'Procurement DELETE: failed to list template completions for cleanup (orphaned files possible)',
            );
          }

          const completionPaths = (completions ?? [])
            .map((c) => c.storage_path)
            .filter(Boolean);

          const allPaths = [...templatePaths, ...completionPaths];
          if (allPaths.length) {
            const { error: templateRemoveError } = await serviceClient.storage
              .from('templates')
              .remove(allPaths);
            if (templateRemoveError) {
              logger.error(
                { procurementId: id, error: templateRemoveError },
                'Procurement DELETE: failed to remove template files (orphaned)',
              );
            }
          }
        }
      } catch (storageErr) {
        logger.error({ err: storageErr }, 'Storage cleanup failed (non-fatal)');
      }

      // Remove content_item_workspaces junction rows first — FK is NO ACTION
      // so these would block the workspace delete if any content is linked
      await supabase
        .from('content_item_workspaces')
        .delete()
        .eq('workspace_id', id);

      // DELETE narrows on id only (prior fetchError gate enforces procurement-type).
      const { error } = await supabase.from('workspaces').delete().eq('id', id);

      if (error) {
        logger.error({ err: error }, 'Failed to delete bid');
        return NextResponse.json(
          { error: 'Failed to delete bid' },
          { status: 500 },
        );
      }

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete bid') },
        { status: 500 },
      );
    }
  },
);
