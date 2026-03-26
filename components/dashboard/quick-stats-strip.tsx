'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { NOTIFICATIONS_UPDATED_EVENT } from '@/hooks/use-notifications';

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

const FRESHNESS_DOT_CLASS: Record<string, string> = {
  Fresh: 'bg-freshness-fresh',
  Aging: 'bg-freshness-aging',
  Stale: 'bg-freshness-stale',
  Expired: 'bg-freshness-expired',
};

function StatItem({ label, value }: { label: string; value: number }) {
  const dotClass = FRESHNESS_DOT_CLASS[label];
  return (
    <div className="flex items-center gap-1.5">
      {dotClass && (
        <span className={`size-2 rounded-full ${dotClass}`} aria-hidden="true" />
      )}
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
  const router = useRouter();

  // Listen for notification mark-as-read events from the bell hook and
  // refresh server components so the dashboard count stays in sync.
  useEffect(() => {
    const handleUpdate = () => {
      router.refresh();
    };

    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdate);
    };
  }, [router]);

  const hasUnhealthyContent = freshness.aging > 0 || freshness.stale > 0 || freshness.expired > 0;

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
        {hasUnhealthyContent ? (
          <>
            {freshness.aging > 0 && <StatItem label="Aging" value={freshness.aging} />}
            {freshness.stale > 0 && <StatItem label="Stale" value={freshness.stale} />}
            {freshness.expired > 0 && <StatItem label="Expired" value={freshness.expired} />}
          </>
        ) : (
          <span className="text-xs text-muted-foreground self-center">All content is fresh</span>
        )}
        <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <StatItem
          label={activeBidCount === 1 ? 'Active bid' : 'Active bids'}
          value={activeBidCount}
        />
        <StatItem label="Unread notifications" value={unreadNotificationCount} />
      </div>
    </section>
  );
}
