'use client';

import Link from 'next/link';
import type { EngagementSiblingForm } from '@/lib/domains/procurement/procurement-detail-shape';
import { ProcurementWorkflowBadge } from '@/components/procurement/procurement-workflow-indicator';
import type { ProcurementWorkflowState } from '@/types/procurement';

/**
 * ID-145 {145.45} — the read-only §A3/§A4 sibling-lineage rail (PSQ -> ITT ->
 * tender). Grouping is a LINK, never a container (BI-28/29): each sibling is
 * an independent form at its own id, with its own URL/state/questions/
 * outcome untouched by being grouped — this component only lists them as
 * plain navigation. NO roll-up, aggregation, or engagement-level win-rate is
 * EVER computed or shown here (S470 owner ruling — per-form outcome is
 * ground truth; any engagement win-rate is a computed QUERY-TIME value,
 * never stored, and out of v1 scope regardless). `page.tsx` mounts this
 * ONLY when `engagement_group_id` is set (§A3/§A8 progressive disclosure —
 * see `ItemPageFrame`'s `groupingRail` slot), so this component itself never
 * re-derives that gate — it just renders whatever `siblings` it is given.
 *
 * Sibling order is whatever the {145.42} group-A GET fold returns (its
 * `engagement_siblings` read has no explicit `ORDER BY` — an existing gap
 * outside this Subtask's file ownership, flagged separately) — this
 * component does not re-sort or infer a "PSQ before ITT before tender"
 * order itself, since that would require business-logic knowledge (which
 * `form_type` precedes which) that isn't this presentational rail's job.
 */
export interface ItemGroupingRailProps {
  engagementGroupId: string;
  currentFormId: string;
  siblings: EngagementSiblingForm[];
  className?: string;
}

export function ItemGroupingRail({
  siblings,
  className,
}: ItemGroupingRailProps) {
  return (
    <div
      data-testid="item-grouping-rail"
      className={className ?? 'rounded-lg border bg-card p-3 text-sm'}
    >
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Part of an engagement group
      </h2>

      {siblings.length === 0 ? (
        <p className="mt-2 text-muted-foreground">
          No other forms in this engagement group yet.
        </p>
      ) : (
        <ul
          className="mt-2 flex flex-wrap gap-2"
          aria-label="Related forms in this engagement"
        >
          {siblings.map((sibling) => (
            <li key={sibling.id}>
              <Link
                href={`/procurement/${sibling.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-medium text-foreground">
                  {sibling.name ?? sibling.form_type ?? 'Untitled form'}
                </span>
                {sibling.reference_number && (
                  <span className="text-xs text-muted-foreground">
                    {sibling.reference_number}
                  </span>
                )}
                {sibling.workflow_state && (
                  <ProcurementWorkflowBadge
                    state={sibling.workflow_state as ProcurementWorkflowState}
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
