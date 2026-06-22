import type { ProcurementBriefing } from '@/types/reorient';
import type {
  ProcurementWorkspaceRow,
  ProcurementQuestionStats,
} from '@/lib/procurement/procurement-queries';
import { getDeadlineUrgency, getDaysUntilDeadline } from '@/lib/dashboard';

/**
 * Build the reorient `bid_summary` from the active-procurement workspaces and
 * their question stats (the result of `fetchActiveProcurementWithStats`).
 *
 * Returns a `ProcurementBriefing[]` already sorted by deadline urgency
 * (overdue → urgent → approaching → normal → unknown). Shared by
 * `fetchUnifiedDashboardData` (lib/dashboard.ts) and `fetchReorientData`
 * (lib/reorient.ts), which previously inlined byte-identical builders (one as a
 * `.map`, one as a `for…push` — behaviour identical).
 */
export function buildBidSummary(
  workspaces: ProcurementWorkspaceRow[],
  statsMap: Map<string, ProcurementQuestionStats>,
): ProcurementBriefing[] {
  const bid_summary: ProcurementBriefing[] = workspaces.map((workspace) => {
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const stats = statsMap.get(workspace.id);
    const deadline = (meta?.deadline as string) ?? null;
    const urgency = getDeadlineUrgency(deadline);
    const totalQ = stats?.total_questions ?? 0;
    const answeredQ =
      (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);

    return {
      id: workspace.id,
      name: workspace.name ?? 'Untitled Procurement',
      buyer: (meta?.buyer as string) ?? null,
      status: (meta?.status as string) ?? 'draft',
      deadline,
      days_until_deadline: getDaysUntilDeadline(deadline),
      urgency,
      total_questions: totalQ,
      answered_questions: answeredQ,
      approved_questions: stats?.complete_count ?? 0,
      gap_count: (stats?.needs_sme_count ?? 0) + (stats?.no_content_count ?? 0),
      href: `/procurement/${workspace.id}`,
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
  bid_summary.sort(
    (a, b) => (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4),
  );

  return bid_summary;
}
