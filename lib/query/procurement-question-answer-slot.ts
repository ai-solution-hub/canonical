'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * ID-147 {147.17} — TanStack query/mutation glue for the custom
 * question/answer-slot editor (PRODUCT §H2, TECH §7 — `form_questions` /
 * `form_responses`, ID-145 BI-20).
 *
 * Deliberately its OWN file, NOT registered in the shared
 * `lib/query/query-keys.ts` factory: this Subtask's file-ownership boundary
 * is the editor component + its own glue only. The parallel {147.16}
 * requirement-catalogue editor (`form_requirement_templates`) owns an
 * equally separate glue file — different tables, different owners (§1
 * naming-defect note: BI-20 spans the two `form_questions`/`form_responses`
 * tables, kept strictly apart from BI-24's catalogue).
 *
 * Reuses the EXISTING, already admin/editor-gated REST surface
 * (`getAuthorisedClient(['admin','editor'])` + `authFailureResponse` inside
 * both routes this file calls — `app/api/procurement/[id]/questions/[qId]/route.ts`
 * and `app/api/procurement/[id]/responses/[rId]/route.ts`) rather than
 * adding new API routes, which sit outside this Subtask's file ownership.
 */

export type ReviewStatus =
  | 'draft'
  | 'ai_drafted'
  | 'edited'
  | 'approved'
  | 'needs_review';

export interface QuestionAnswerSlotResponseDetail {
  id: string;
  review_status: ReviewStatus;
  version: number;
}

const qaSlotQueryKeys = {
  response: (procurementId: string, responseId: string) =>
    ['procurement-qa-slot', 'response', procurementId, responseId] as const,
};

/**
 * Fetches the live `review_status` + `version` for one `form_responses` row
 * via the existing `GET /api/procurement/[id]/responses/[rId]` route — the
 * only route that returns `version` (the questions-list preview enrichment
 * carries only `{id, review_status, word_count}`, no version). Stays
 * disabled (no fetch) when `responseId` is null — an unanswered slot has no
 * response row yet.
 */
export function useQuestionAnswerSlotResponse(
  procurementId: string,
  responseId: string | null,
) {
  return useQuery({
    queryKey: qaSlotQueryKeys.response(procurementId, responseId ?? ''),
    queryFn: async (): Promise<QuestionAnswerSlotResponseDetail> => {
      const res = await fetch(
        `/api/procurement/${procurementId}/responses/${responseId}`,
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch response (${res.status})`);
      }
      const data = await res.json();
      return {
        id: data.id,
        review_status: data.review_status,
        version: data.version,
      };
    },
    enabled: responseId !== null,
  });
}

export interface QuestionSlotFieldUpdate {
  question_text?: string;
  word_limit?: number | null;
  evaluation_weight?: number | null;
  assigned_to?: string | null;
}

/**
 * PATCH the `form_questions` slot fields (question_text / word_limit /
 * evaluation_weight / assigned_to) via the existing admin/editor-gated
 * route.
 */
export function useUpdateQuestionSlot(
  procurementId: string,
  questionId: string,
) {
  return useMutation({
    mutationFn: async (updates: QuestionSlotFieldUpdate) => {
      const res = await fetch(
        `/api/procurement/${procurementId}/questions/${questionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        },
      );
      if (!res.ok) {
        // Deliberate swallow: the error body is optional detail only — a
        // malformed/absent JSON body must not mask the real failure (the
        // non-OK HTTP status), so it falls back to a generic message below.
        const body = await res.json().catch((_err) => null);
        throw new Error(body?.error ?? `Failed to save (${res.status})`);
      }
      return res.json();
    },
  });
}

/**
 * PATCH `form_responses.review_status` for the answer slot via the existing
 * admin/editor-gated route. Invalidates the response-detail query on
 * success so the freshly-committed `review_status` (and any server-side
 * side effects) are reflected immediately.
 */
export function useUpdateQuestionSlotReviewStatus(
  procurementId: string,
  responseId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reviewStatus: ReviewStatus) => {
      const res = await fetch(
        `/api/procurement/${procurementId}/responses/${responseId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ review_status: reviewStatus }),
        },
      );
      if (!res.ok) {
        // Deliberate swallow — see the sibling mutation above for rationale.
        const body = await res.json().catch((_err) => null);
        throw new Error(body?.error ?? `Failed to save (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qaSlotQueryKeys.response(procurementId, responseId),
      });
    },
  });
}
