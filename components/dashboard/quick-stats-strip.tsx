interface QuickStatsStripProps {
  freshness: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
  activeBidCount: number;
  unreadNotificationCount: number;
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-sm font-semibold text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function QuickStatsStrip({
  freshness,
  activeBidCount,
  unreadNotificationCount,
}: QuickStatsStripProps) {
  return (
    <section
      aria-label="Content health"
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Content Health
      </h2>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <StatItem label="Fresh" value={freshness.fresh} />
        <StatItem label="Aging" value={freshness.aging} />
        <StatItem label="Stale" value={freshness.stale} />
        <StatItem label="Expired" value={freshness.expired} />
        <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <StatItem
          label={activeBidCount === 1 ? 'Active bid' : 'Active bids'}
          value={activeBidCount}
        />
        <StatItem label="Unread" value={unreadNotificationCount} />
      </div>
    </section>
  );
}
