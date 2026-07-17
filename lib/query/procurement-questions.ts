/**
 * Shared fetcher for the procurement questions list.
 *
 * BOTH registrants of `queryKeys.procurement.questions(id)` — the detail
 * page's `useFormData` (hooks/procurement/use-procurement-actions.ts) and the
 * session page's `useProcurementSession`
 * (hooks/procurement/use-procurement-session.ts) — MUST fetch through this
 * function. One query key means one cached shape: the two hooks previously
 * cached different shapes under the same key (the detail page cached the raw
 * route envelope, the session page cached the bare questions array), so
 * navigating detail -> session served the envelope where an array was
 * expected and crashed the session page with "questions.map is not a
 * function". The cached shape of record is the route envelope below.
 *
 * Error posture (Q-37 lineage): fetch errors propagate to TanStack Query's
 * `isError`/`error` state — never swallowed into an empty-but-valid-looking
 * payload. A 200 response whose `questions` field is not an array is a broken
 * API contract and throws for the same reason: a silent `[]` fallback would
 * render a plausible empty state and hide the contract violation.
 */

import { fetchJson } from '@/lib/query/fetchers';
import type {
  ProcurementQuestion,
  ProcurementQuestionStats,
} from '@/types/procurement';

/**
 * Envelope returned by `GET /api/procurement/[id]/questions`
 * (app/api/procurement/[id]/questions/route.ts) and cached under
 * `queryKeys.procurement.questions(id)`.
 */
export interface ProcurementQuestionsPayload {
  questions: ProcurementQuestion[];
  stats: ProcurementQuestionStats | null;
  /** Partial-degradation notices (e.g. response previews or stats failed). */
  warnings?: string[];
}

/** Fetch + boundary-validate the questions envelope for one procurement. */
export async function fetchProcurementQuestions(
  procurementId: string,
): Promise<ProcurementQuestionsPayload> {
  const data = await fetchJson<Partial<ProcurementQuestionsPayload>>(
    `/api/procurement/${procurementId}/questions`,
  );
  if (!Array.isArray(data?.questions)) {
    // Fail loud: the route always returns `questions` as an array on 200, so
    // anything else is a server-side contract break that must surface as a
    // query error, not masquerade as an empty questions list.
    throw new Error(
      `GET /api/procurement/${procurementId}/questions returned a malformed payload: expected 'questions' to be an array, received ${
        data === null
          ? 'null'
          : Array.isArray(data)
            ? 'array'
            : typeof data?.questions
      }`,
    );
  }
  return {
    questions: data.questions,
    stats: data.stats ?? null,
    ...(data.warnings !== undefined ? { warnings: data.warnings } : {}),
  };
}
