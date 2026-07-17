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
  ProcurementUpdateBodySchema,
  validateFormOutcome,
} from '@/lib/validation/schemas';
import { tryQuery, type PostgrestLike } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ID-145 {145.19} groups A+C (DR-075 §6 ruling, ratified S474 — honours the
// S470 owner ruling that there is NO stored/derived roll-up). [id] RE-KEYs
// from the retired workspace umbrella onto `form_instances.id` directly — the
// item IS the form (BI-1). There is no more child-forms list or
// `get_procurement_rollup` roll-up: both retired with the
// workspace-holds-many-forms container. Every lifecycle fact this route
// surfaces/writes is a flat `form_instances` column, consumed directly by
// `deriveProcurementMetadata` / `deriveProcessingStatus` /
// `deriveProcurementStatus` (procurement-detail-shape.ts, {145.18}).
//
// `computeWorkflowTransition` below is the SINGLE canTransition-gated
// transition writer (DR-075 §6 consolidation) — `outcome/route.ts` used to
// duplicate this exact validation + triad-construction logic against the
// pre-rename `form_templates` table; it now imports and delegates to this
// instead (route.ts hosts the writer, outcome routes call it).
//
// ID-145 {145.6} W1c renamed `form_templates` -> `form_instances` and dropped
// `workspace_id` — this route is authored against that POST-W1 schema even
// though the generated `database.types.ts` still reflects the PRE-W1 shape
// (same allowance {145.6}/{145.7}/{145.9}/{145.15}/{145.16} already took —
// typecheck drift against the stale generated types is EXPECTED here,
// journalled not chased).

/** The flat `form_instances` detail columns this route surfaces (BI-1, BI-5, BI-13). */
const FORM_DETAIL_COLUMNS =
  'id, name, description, form_type, processing_status, workflow_state, deadline, submission_date, issuing_organisation, outcome, outcome_notes, outcome_recorded_at, outcome_recorded_by, reference_number, estimated_value, engagement_group_id, created_by, created_at, updated_at';

/** A `form_attachments` row as read by the group-A GET fold (§A5/§A6, {147.7}). */
interface FormAttachmentRow {
  id: string;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  role: string;
  form_instance_id: string | null;
  engagement_group_id: string | null;
  created_at: string;
}

/** A sibling `form_instances` row for the §A3 engagement rail (read-only lineage). */
interface EngagementSiblingRow {
  id: string;
  name: string | null;
  form_type: string | null;
  workflow_state: string | null;
  reference_number: string | null;
}

/**
 * Raw shape of the §A3 sibling-rail query result BEFORE the lineage sort —
 * carries `created_at` as the tiebreaker only ({145.51}); stripped before the
 * row is returned in the public `EngagementSiblingRow` shape.
 */
interface EngagementSiblingQueryRow extends EngagementSiblingRow {
  created_at: string;
}

/**
 * BI-28/29 lineage rank (PSQ -> ITT -> tender) for the §A3 sibling-rail
 * deterministic order ({145.51}, S481 curator promotion — an existing gap
 * flagged from {145.42}/{145.45}). supabase-js `.order()` cannot express a
 * CASE/sequence expression, and the natural `form_type` enum order
 * (`PROCUREMENT_FORM_TYPE_KEYS` in `lib/validation/schemas.ts` — alphabetical)
 * does NOT match the lineage, so this route sorts server-side after the
 * fetch instead — still server-side, still deterministic. `form_type`s
 * outside the known lineage (checklist/questionnaire/rfp/…) have no defined
 * lineage position, so they sort AFTER the known PSQ -> ITT -> tender triad.
 */
const ENGAGEMENT_LINEAGE_RANK: Record<string, number> = {
  psq: 0,
  itt: 1,
  tender: 2,
};
const UNRANKED_LINEAGE_POSITION = 3;

function engagementLineageRank(formType: string | null): number {
  if (formType !== null && formType in ENGAGEMENT_LINEAGE_RANK) {
    return ENGAGEMENT_LINEAGE_RANK[formType];
  }
  return UNRANKED_LINEAGE_POSITION;
}

/**
 * Sort §A3 sibling rows into BI-28/29 lineage order (PSQ -> ITT -> tender),
 * `created_at` ascending as the deterministic tiebreaker (both within a
 * lineage rank and among unranked types), then strip the tiebreaker field
 * before returning the public row shape ItemGroupingRail consumes as-is.
 */
function sortEngagementSiblingsByLineage(
  rows: EngagementSiblingQueryRow[],
): EngagementSiblingRow[] {
  return [...rows]
    .sort((a, b) => {
      const rankDiff =
        engagementLineageRank(a.form_type) - engagementLineageRank(b.form_type);
      if (rankDiff !== 0) return rankDiff;
      return a.created_at.localeCompare(b.created_at);
    })
    .map(({ created_at: _created_at, ...row }) => row);
}

/**
 * Result of validating + computing a `canTransition`-gated workflow-state
 * write against `form_instances` (DR-075 §6 — the consolidated transition
 * writer). `updates` is the `form_instances` UPDATE payload on success; on
 * refusal, `reason` distinguishes an invalid jump (400, canTransition), a
 * stage-appropriateness mismatch (400, AD-4), or missing audit provenance on
 * a terminal outcome (500, T-B9 REQUIRED-ON-TERMINAL) — each caller maps
 * `reason` to its own existing response shape so neither route's external
 * contract changes.
 */
export type WorkflowTransitionOutcome =
  | { ok: true; updates: Record<string, unknown> }
  | {
      ok: false;
      status: 400;
      reason: 'invalid_transition';
    }
  | {
      ok: false;
      status: 400;
      reason: 'stage_mismatch';
      message: string;
    }
  | { ok: false; status: 500; reason: 'audit_missing' };

export function computeWorkflowTransition(args: {
  currentState: ProcurementWorkflowState;
  targetState: ProcurementWorkflowState;
  formType: string | null;
  userId: string;
}): WorkflowTransitionOutcome {
  const { currentState, targetState, formType, userId } = args;

  if (!canTransition(currentState, targetState)) {
    return { ok: false, status: 400, reason: 'invalid_transition' };
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { workflow_state: targetState };

  // submission_date stamped server-side on the submitted transition.
  if (targetState === 'submitted') {
    updates.submission_date = nowIso;
  }
  // Terminal won/lost record the per-stage outcome + audit provenance.
  if (targetState === 'won' || targetState === 'lost') {
    updates.outcome = targetState;
    updates.outcome_recorded_at = nowIso;
    updates.outcome_recorded_by = userId;
  }
  // withdrawn is a workflow terminal, NOT an outcome (AD-4): clear it.
  if (targetState === 'withdrawn') {
    updates.outcome = null;
  }

  // Stage-appropriateness guard (AD-4) — clean 400 before the DB trigger
  // would raise an opaque exception. Only when an outcome is being SET.
  if (updates.outcome !== undefined && updates.outcome !== null) {
    const stageError = validateFormOutcome(
      formType,
      targetState,
      updates.outcome as string,
    );
    if (stageError) {
      return {
        ok: false,
        status: 400,
        reason: 'stage_mismatch',
        message: stageError,
      };
    }
  }

  // Audit REQUIRED-ON-TERMINAL (T-B9/B-9): a won/lost outcome must carry its
  // provenance — enforced BEFORE the state commit.
  if (updates.outcome === 'won' || updates.outcome === 'lost') {
    if (!updates.outcome_recorded_at || !updates.outcome_recorded_by) {
      return { ok: false, status: 500, reason: 'audit_missing' };
    }
  }

  return { ok: true, updates };
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

      // form_instances IS the item (BI-1) — no workspace umbrella, no join.
      const formResult = await tryQuery(
        supabase
          .from('form_instances')
          .select(FORM_DETAIL_COLUMNS)
          .eq('id', id)
          .single(),
        'procurement.detail.form',
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

      const form = formResult.data as Record<string, unknown>;

      // Composite view: question stats + tender documents are independent
      // enrichments of the item detail. A failure in either must not 500 the
      // whole page — sibling tabs render fine without them. Surface failures
      // via the canonical warnings[] envelope (matches H1/H2/H14 — partial
      // response over fail-fast).
      const warnings: string[] = [];

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
      // raw storage call with an explicit error check). KEPT unchanged (§A5
      // FORM SOURCE): the upload route already writes objects at
      // `tender-documents/<form_instances.id>/...`, so the folder key here
      // matches [id] with no re-key needed.
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

      // ID-145 {145.42} (TECH §6 group-A GET ADD) — fold the `form_attachments`
      // read in, split by role for the §A5 Documents-tab two-group split. A
      // form always sees its OWN form-scoped attachments; when grouped
      // (engagement_group_id set) it ALSO sees the engagement-scoped ones
      // (§A6 "form OR engagement level"). Independent enrichment like stats/
      // storage above — a failure here degrades to warnings[], never a 500.
      const engagementGroupId =
        typeof form.engagement_group_id === 'string'
          ? form.engagement_group_id
          : null;

      let attachmentsFormSource: FormAttachmentRow[] = [];
      let attachmentsReferenceEvidence: FormAttachmentRow[] = [];
      const attachmentsSelect =
        'id, filename, storage_path, mime_type, file_size, role, form_instance_id, engagement_group_id, created_at';
      const attachmentsQuery = engagementGroupId
        ? supabase
            .from('form_attachments')
            .select(attachmentsSelect)
            .or(
              `form_instance_id.eq.${id},engagement_group_id.eq.${engagementGroupId}`,
            )
        : supabase
            .from('form_attachments')
            .select(attachmentsSelect)
            .eq('form_instance_id', id);

      const attachmentsResult = await tryQuery<FormAttachmentRow[]>(
        attachmentsQuery,
        'procurement.detail.attachments',
      );
      if (!attachmentsResult.ok) {
        logger.error(
          { err: attachmentsResult.error },
          'Failed to fetch form attachments',
        );
        warnings.push(
          'Attachments could not be loaded: ' +
            safeErrorMessage(
              attachmentsResult.error,
              'attachments query failed',
            ),
        );
      } else {
        const rows = attachmentsResult.data ?? [];
        attachmentsFormSource = rows.filter((r) => r.role === 'form_source');
        attachmentsReferenceEvidence = rows.filter(
          (r) => r.role === 'reference_evidence',
        );
      }

      // §A3 engagement sibling-rail read — read-only lineage, only when
      // grouped. NO roll-up/aggregation is computed here (S470 owner ruling,
      // §A4) — just the sibling identity fields the rail lists.
      let engagementSiblings: EngagementSiblingRow[] = [];
      if (engagementGroupId) {
        // `created_at` is fetched ONLY as the lineage-sort tiebreaker
        // ({145.51}) — stripped before it reaches `engagementSiblings`.
        const siblingsQuery = supabase
          .from('form_instances')
          .select(
            'id, name, form_type, workflow_state, reference_number, created_at',
          )
          .eq('engagement_group_id', engagementGroupId)
          .neq('id', id);
        // Cast needed: adding `created_at` to the previously 5-column
        // select tips supabase-js's stale-types overload resolution onto an
        // unrelated table shape (the pre-existing `form_instances` vs
        // generated-types mismatch this file's header already documents) —
        // same precedent as the `as unknown as Database[...]` cast on the
        // PATCH write path below.
        const siblingsResult = await tryQuery<EngagementSiblingQueryRow[]>(
          siblingsQuery as unknown as PostgrestLike<
            EngagementSiblingQueryRow[]
          >,
          'procurement.detail.engagementSiblings',
        );
        if (!siblingsResult.ok) {
          logger.error(
            { err: siblingsResult.error },
            'Failed to fetch engagement sibling forms',
          );
          warnings.push(
            'Related engagement forms could not be loaded: ' +
              safeErrorMessage(
                siblingsResult.error,
                'engagement siblings query failed',
              ),
          );
        } else {
          engagementSiblings = sortEngagementSiblingsByLineage(
            siblingsResult.data ?? [],
          );
        }
      }

      const responseBody: Record<string, unknown> = {
        ...form,
        question_stats: questionStats,
        tender_documents: tenderDocuments,
        attachments: {
          form_source: attachmentsFormSource,
          reference_evidence: attachmentsReferenceEvidence,
        },
        engagement_siblings: engagementSiblings,
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
        // `notes` has NO form_instances home post-W1 (BI-5, {145.18}
        // procurement-detail-shape.ts) — parsed by the schema (unchanged,
        // out of this Subtask's file ownership) but never persisted here.
      } = parsed.data;

      // Verify the item exists + read its live workflow_state/form_type —
      // [id] IS the form now, so there is no more "locate the workspace's
      // single v1 form" indirection (RE-KEY, TECH.md §6 Group-A PATCH/DELETE).
      const formResult = await tryQuery<{
        id: string;
        name: string;
        description: string | null;
        form_type: string | null;
        workflow_state: string;
      }>(
        supabase
          .from('form_instances')
          .select('id, name, description, form_type, workflow_state')
          .eq('id', id)
          .single(),
        'procurement.patch.form',
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
      const current = formResult.data;

      const formUpdates: Record<string, unknown> = {};
      const nowIso = new Date().toISOString();

      if (status !== undefined) {
        const currentState =
          (current.workflow_state as ProcurementWorkflowState) ?? 'draft';
        const transition = computeWorkflowTransition({
          currentState,
          targetState: status as ProcurementWorkflowState,
          formType: current.form_type,
          userId: user.id,
        });
        if (!transition.ok) {
          if (transition.reason === 'invalid_transition') {
            return NextResponse.json(
              {
                error: `Cannot transition from "${currentState}" to "${status}"`,
                current_status: currentState,
                requested_status: status,
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
            { formId: id, status },
            'Terminal outcome missing audit provenance',
          );
          return NextResponse.json(
            { error: 'Terminal outcome requires audit provenance' },
            { status: 500 },
          );
        }
        Object.assign(formUpdates, transition.updates);
      }

      // Explicit outcome field (legacy PATCH shape) records onto the form
      // too — predates the canTransition-gated `status` field above and is
      // UNTOUCHED by the {145.19} consolidation (out of the duplicated
      // transition-writer's scope; it never validated canTransition).
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
      if (name !== undefined) formUpdates.name = name;
      if (description !== undefined) formUpdates.description = description;
      if (reference_number !== undefined)
        formUpdates.reference_number = reference_number;
      if (estimated_value !== undefined)
        formUpdates.estimated_value = estimated_value;

      // Stage-appropriateness guard (AD-4) — redundant-but-harmless for the
      // `status` path (already run inside computeWorkflowTransition above);
      // load-bearing for the legacy explicit-`outcome` branch, which bypasses
      // the shared transition writer entirely.
      if (formUpdates.outcome !== undefined && formUpdates.outcome !== null) {
        const stageError = validateFormOutcome(
          current.form_type,
          (formUpdates.workflow_state as string) ?? current.workflow_state,
          formUpdates.outcome as string,
        );
        if (stageError) {
          return NextResponse.json({ error: stageError }, { status: 400 });
        }
      }

      // Audit REQUIRED-ON-TERMINAL (T-B9/B-9) — same redundant-but-harmless
      // note as above.
      if (formUpdates.outcome === 'won' || formUpdates.outcome === 'lost') {
        if (
          !formUpdates.outcome_recorded_at ||
          !formUpdates.outcome_recorded_by
        ) {
          logger.error(
            { formId: id, outcome: formUpdates.outcome },
            'Terminal outcome missing audit provenance',
          );
          return NextResponse.json(
            { error: 'Terminal outcome requires audit provenance' },
            { status: 500 },
          );
        }
      }

      if (Object.keys(formUpdates).length === 0) {
        // Nothing to write (e.g. a PATCH with no recognised fields) — return
        // the current row unchanged rather than issuing a no-op UPDATE.
        return NextResponse.json({
          id: current.id,
          name: current.name,
          description: current.description,
          workflow_state: current.workflow_state,
          outcome: null,
          form: current,
        });
      }

      // UPDATE narrows on the PK directly. `.select()` lets us VERIFY a row
      // was actually written — a REST PATCH that matches zero rows silently
      // succeeds with an empty body (RLS / vanished row).
      //
      // ID-145 {145.23} round-2: `formUpdates` is built dynamically (keys
      // set conditionally above) as `Record<string, unknown>`, which the
      // generated `.update()` overload's RejectExcessProperties helper
      // cannot verify has no excess keys against an open index signature —
      // cast through `unknown` at the call boundary rather than re-typing
      // the whole dynamic-build helper.
      const updateResult = await tryQuery<Array<Record<string, unknown>>>(
        supabase
          .from('form_instances')
          .update(
            formUpdates as unknown as Database['public']['Tables']['form_instances']['Update'],
          )
          .eq('id', id)
          .select(FORM_DETAIL_COLUMNS),
        'procurement.patch.formUpdate',
      );
      if (!updateResult.ok) {
        if (updateResult.error.code === '23505') {
          return NextResponse.json(
            { error: 'A bid with that name already exists' },
            { status: 409 },
          );
        }
        logger.error({ err: updateResult.error }, 'Failed to update bid');
        return NextResponse.json(
          { error: 'Failed to update bid' },
          { status: 500 },
        );
      }
      const updatedRows = updateResult.data ?? [];
      if (updatedRows.length === 0) {
        // Zero rows matched — the item vanished or RLS blocked the write.
        return NextResponse.json(
          { error: 'Procurement could not be updated' },
          { status: 409 },
        );
      }
      const updated = updatedRows[0];

      return NextResponse.json({
        id: updated.id,
        name: updated.name,
        description: updated.description,
        workflow_state: (updated.workflow_state as string | undefined) ?? null,
        outcome: (updated.outcome as string | undefined) ?? null,
        form: updated,
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

      // Verify the item exists before cleanup.
      const { data: form, error: fetchError } = await supabase
        .from('form_instances')
        .select('id, storage_path, structure_path')
        .eq('id', id)
        .single();

      if (fetchError || !form) {
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

        // Delete tender documents. Folder key = this item's own id (KEPT
        // unchanged — the upload route writes objects at
        // `tender-documents/<form_instances.id>/...`, so [id] already
        // matches post-re-key with no path change needed).
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

        // ID-145 {145.42} (TECH §2 storage-cleanup contract) — best-effort
        // remove() of this form's OWN form-scoped `form_attachments` storage
        // objects. The FK `ON DELETE CASCADE` on `form_instance_id` removes
        // the DB rows when the `form_instances` row below is deleted, but a
        // Postgres cascade cannot reach Supabase Storage (the "FK CASCADE
        // gap") — this is the primary cleanup mechanism; the {147.8}
        // orphan-sweep cron is the backstop for anything missed. Only
        // form-scoped attachments (§A7): an engagement-scoped attachment
        // CASCADEs on `engagement_group_id`, not on this form's delete, so
        // deleting this form must never touch it.
        const { data: attachmentRows, error: attachmentListError } =
          await supabase
            .from('form_attachments')
            .select('storage_path')
            .eq('form_instance_id', id);
        if (attachmentListError) {
          logger.error(
            { procurementId: id, error: attachmentListError },
            'Procurement DELETE: failed to list form attachments for cleanup (orphaned files possible)',
          );
        }
        const attachmentPaths = (attachmentRows ?? [])
          .map((a) => a.storage_path)
          .filter(Boolean);
        if (attachmentPaths.length) {
          const { error: attachmentRemoveError } = await serviceClient.storage
            .from('tender-documents')
            .remove(attachmentPaths);
          if (attachmentRemoveError) {
            logger.error(
              { procurementId: id, error: attachmentRemoveError },
              'Procurement DELETE: failed to remove form attachments (orphaned; orphan-sweep backstop will reconcile)',
            );
          }
        }

        // Delete the template structure file + completions. ID-145 {145.19}:
        // [id] IS the form now — no more "list every child form under this
        // workspace" (`workspace_id` dropped W1c STEP 1); the row's own
        // storage_path/structure_path (already fetched above) plus its OWN
        // completions (re-keyed `template_id` -> `form_instance_id`, W1c
        // STEP 5) are the entire cleanup scope.
        const templatePaths = [form.storage_path, form.structure_path].filter(
          Boolean,
        ) as string[];

        const { data: completions, error: completionsError } = await supabase
          .from('template_completions')
          .select('storage_path')
          .eq('form_instance_id', id);
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
      } catch (storageErr) {
        logger.error({ err: storageErr }, 'Storage cleanup failed (non-fatal)');
      }

      // DELETE narrows on id only (prior fetchError gate enforces existence).
      const { error } = await supabase
        .from('form_instances')
        .delete()
        .eq('id', id);

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
