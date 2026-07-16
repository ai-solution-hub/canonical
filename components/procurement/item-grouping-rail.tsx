'use client';

import type { EngagementSiblingForm } from '@/lib/domains/procurement/procurement-detail-shape';

/**
 * STUB — scaffolded by ID-145 {145.42} (145W-2), FILLED by {145.45}.
 *
 * {145.45} renders the read-only §A3/§A4 sibling-lineage rail (PSQ -> ITT ->
 * tender): grouping is a LINK, not a container (ID-145 BI-28/29) — a grouped
 * form's URL/state/questions/outcome are identical grouped or not, and NO
 * roll-up/aggregation/win-rate is ever computed or shown here (S470 owner
 * ruling). `page.tsx` mounts this ONLY when `engagement_group_id` is set
 * (§A3/§A8 progressive disclosure — see `ItemPageFrame`'s `groupingRail`
 * slot), so this component itself never needs to re-check that gate. This
 * stub renders a minimal placeholder — props are the {145.42} group-A GET
 * fold's sibling data, so {145.45} never has to re-edit `page.tsx`.
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
      <p className="text-muted-foreground">
        Part of an engagement group — {siblings.length} related form
        {siblings.length === 1 ? '' : 's'}. ({'{145.45}'} wires the read-only
        sibling lineage here.)
      </p>
    </div>
  );
}
