import type { TeamChange, RecentWorkItem } from '@/types/reorient';

/**
 * Pure row→object mappers shared by `fetchUnifiedDashboardData`
 * (lib/dashboard.ts) and `fetchReorientData` (lib/reorient.ts). Both files
 * previously inlined byte-identical copies of these mappings.
 *
 * ID-145 {145.48}: `form_questions.workspace_id` + its `workspaces` join were
 * DROPPED at {145.6} M3 (`form_questions` no longer relates to `workspaces`
 * at all). The mappers now read `form_questions.form_instance_id` — already
 * the row's own procurement identifier, no join needed for it — and, where a
 * display title is required (team changes), join `form_instances` for
 * `name`/`issuing_organisation`. Each `row.form_responses` parameter is typed
 * to the REAL nested select shape (not `unknown`) so a future column/table
 * drift is a tsc error at the call site, not a silent runtime
 * PostgREST-relationship failure — the previous `as unknown as {…}` double
 * cast bypassed structural checking entirely, which is why {145.20}'s M3
 * migration missed this regression.
 *
 * `contentHistoryRowToTeamChange` / `contentHistoryRowToRecentWork` (the
 * content_history-sourced 'content_item' entity_type mappers) were REMOVED
 * here (ID-131.19 S450 Wave 1 Fix 4) — content_history drops at M6 and no
 * logical cross-entity-type replacement exists (see lib/dashboard.ts's
 * query-2/3 retirement comment for the full audit). Only the
 * form_response_history-sourced 'bid_response' mappers below survive.
 */

/** form_response_history row → TeamChange (entity_type 'bid_response'). */
export function formResponseRowToTeamChange(row: {
  edited_by: string | null;
  response_id: string;
  created_at: string;
  form_responses: {
    question_id: string | null;
    form_questions: {
      form_instance_id: string | null;
      form_instances: {
        name: string | null;
        issuing_organisation: string | null;
      } | null;
    } | null;
  } | null;
}): TeamChange {
  const br = row.form_responses;
  const formInstance = br?.form_questions?.form_instances;
  return {
    user_id: row.edited_by ?? '',
    user_name: null,
    action: 'updated',
    entity_type: 'bid_response',
    entity_id: row.response_id,
    entity_title:
      formInstance?.name ??
      formInstance?.issuing_organisation ??
      'Untitled Procurement',
    domain: undefined,
    created_at: row.created_at,
    workspace_id: br?.form_questions?.form_instance_id ?? undefined,
    question_id: br?.question_id ?? undefined,
  };
}

/** form_response_history row → RecentWorkItem (entity_type 'bid_response'). */
export function formResponseRowToRecentWork(row: {
  response_id: string;
  created_at: string;
  form_responses: {
    question_id: string | null;
    form_questions: {
      form_instance_id: string | null;
      question_text: string | null;
    } | null;
  } | null;
}): RecentWorkItem {
  const br = row.form_responses;
  const questionText = br?.form_questions?.question_text ?? 'Untitled question';
  const procurementId = br?.form_questions?.form_instance_id ?? undefined;
  return {
    entity_type: 'bid_response',
    entity_id: row.response_id,
    entity_title:
      questionText.length > 60
        ? `${questionText.slice(0, 57)}...`
        : questionText,
    action: 'edited',
    href: procurementId
      ? `/procurement/${procurementId}/session`
      : '/procurement',
    created_at: row.created_at,
    workspace_id: procurementId,
    question_id: br?.question_id ?? undefined,
  };
}
