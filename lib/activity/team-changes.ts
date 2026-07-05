import type { TeamChange, RecentWorkItem } from '@/types/reorient';

/**
 * Pure row→object mappers shared by `fetchUnifiedDashboardData`
 * (lib/dashboard.ts) and `fetchReorientData` (lib/reorient.ts). Both files
 * previously inlined byte-identical copies of these mappings.
 *
 * The Supabase nested-join typing for `form_responses` is imprecise, so each
 * mapper casts that column via `as unknown as {…} | null`. The cast is kept
 * INSIDE the mapper so the call sites stay clean and the cast lives in
 * exactly one place per shape.
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
  form_responses: unknown;
}): TeamChange {
  const br = row.form_responses as unknown as {
    question_id: string;
    form_questions: {
      workspace_id: string;
      workspaces: { name: string };
    };
  } | null;
  return {
    user_id: row.edited_by ?? '',
    user_name: null,
    action: 'updated',
    entity_type: 'bid_response',
    entity_id: row.response_id,
    entity_title:
      br?.form_questions?.workspaces?.name ?? 'Untitled Procurement',
    domain: undefined,
    created_at: row.created_at,
    workspace_id: br?.form_questions?.workspace_id,
    question_id: br?.question_id,
  };
}

/** form_response_history row → RecentWorkItem (entity_type 'bid_response'). */
export function formResponseRowToRecentWork(row: {
  response_id: string;
  created_at: string;
  form_responses: unknown;
}): RecentWorkItem {
  const br = row.form_responses as unknown as {
    question_id: string;
    form_questions: {
      workspace_id: string;
      question_text: string;
      workspaces: { id: string; name: string };
    };
  } | null;
  const questionText = br?.form_questions?.question_text ?? 'Untitled question';
  const procurementId = br?.form_questions?.workspaces?.id;
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
    question_id: br?.question_id,
  };
}
