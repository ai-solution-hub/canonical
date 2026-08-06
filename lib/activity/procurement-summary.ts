import type { ProcurementBriefing } from '@/types/reorient';
import type {
  ActiveProcurementRow,
  ProcurementQuestionStats,
} from '@/lib/domains/procurement/procurement-queries';
import { getDeadlineUrgency, getDaysUntilDeadline } from '@/lib/dashboard';

/**
 * Build the reorient `forms_summary` from the active procurements and their
 * question stats (the result of `fetchActiveProcurementWithStats`).
 *
 * Returns a `ProcurementBriefing[]` already sorted by deadline urgency
 * (overdue → urgent → approaching → normal → unknown). Shared by
 * `fetchUnifiedDashboardData` (lib/dashboard.ts) and `fetchReorientData`
 * (lib/reorient.ts), which previously inlined byte-identical builders (one as a
 * `.map`, one as a `for…push` — behaviour identical).
 */
export function buildProcurementSummary(
  forms: ActiveProcurementRow[],
  statsMap: Map<string, ProcurementQuestionStats>,
): ProcurementBriefing[] {
  const forms_summary: ProcurementBriefing[] = forms.map((form) => {
    const stats = statsMap.get(form.id);
    const deadline = form.deadline;
    const urgency = getDeadlineUrgency(deadline);
    const totalQ = stats?.total_questions ?? 0;
    const answeredQ =
      (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);

    return {
      id: form.id,
      name: form.name ?? 'Untitled Procurement',
      buyer: form.buyer,
      status: form.status ?? 'draft',
      deadline,
      days_until_deadline: getDaysUntilDeadline(deadline),
      urgency,
      total_questions: totalQ,
      answered_questions: answeredQ,
      approved_questions: stats?.complete_count ?? 0,
      // id-417 (S538) CARRY: both legs derive from
      // `form_questions.confidence_posture`, whose sole writer (the questions
      // match route) was deleted this session — so `gap_count` is currently
      // structurally 0. The requirement ("questions with no good match") is
      // real; its replacement signal belongs with the question_matches
      // substrate ({145.17}), not with the retired posture column.
      gap_count: (stats?.needs_sme_count ?? 0) + (stats?.no_content_count ?? 0),
      href: `/procurement/${form.id}`,
    };
  });

  // Sort by deadline urgency
  const urgencyOrder: Record<string, number> = {
    overdue: 0,
    urgent: 1,
    approaching: 2,
    normal: 3,
    unknown: 4,
  };
  forms_summary.sort(
    (a, b) => (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4),
  );

  return forms_summary;
}
