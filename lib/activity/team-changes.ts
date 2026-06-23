import type { TeamChange, RecentWorkItem } from '@/types/reorient';
import { mapChangeTypeToAction } from '@/lib/activity/change-type';

/**
 * Pure row→object mappers shared by `fetchUnifiedDashboardData`
 * (lib/dashboard.ts) and `fetchReorientData` (lib/reorient.ts). Both files
 * previously inlined byte-identical copies of these mappings.
 *
 * The Supabase nested-join typing for `content_items` / `form_responses` is
 * imprecise, so each mapper casts those columns via `as unknown as {…} | null`.
 * The cast is kept INSIDE the mapper so the call sites stay clean and the cast
 * lives in exactly one place per shape.
 */

/** content_history row → TeamChange (entity_type 'content_item'). */
export function contentHistoryRowToTeamChange(row: {
  created_by: string | null;
  change_type: string | null;
  content_item_id: string | null;
  created_at: string;
  content_items: unknown;
}): TeamChange {
  const ci = row.content_items as unknown as {
    title: string;
    primary_domain: string;
  } | null;
  return {
    user_id: row.created_by ?? '',
    user_name: null, // Resolved client-side via useDisplayNames
    action: mapChangeTypeToAction(
      row.change_type ?? 'edit',
    ) as TeamChange['action'],
    entity_type: 'content_item',
    entity_id: row.content_item_id ?? '',
    entity_title: ci?.title ?? 'Untitled',
    domain: ci?.primary_domain ?? undefined,
    created_at: row.created_at,
  };
}

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

/** content_history row → RecentWorkItem (entity_type 'content_item'). */
export function contentHistoryRowToRecentWork(row: {
  content_item_id: string | null;
  change_type: string | null;
  created_at: string;
  content_items: unknown;
}): RecentWorkItem {
  const ci = row.content_items as unknown as { title: string } | null;
  return {
    entity_type: 'content_item',
    entity_id: row.content_item_id ?? '',
    entity_title: ci?.title ?? 'Untitled',
    action: mapChangeTypeToAction(
      row.change_type ?? 'edit',
    ) as RecentWorkItem['action'],
    href: `/item/${row.content_item_id}`,
    created_at: row.created_at,
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
