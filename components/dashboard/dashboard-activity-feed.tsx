'use client';

import Link from 'next/link';
import { Pencil, RotateCcw } from 'lucide-react';
import { formatRelativeDate } from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import type { ActivityItem } from '@/lib/dashboard';

interface DashboardActivityFeedProps {
  activities: ActivityItem[];
}

export function DashboardActivityFeed({
  activities,
}: DashboardActivityFeedProps) {
  const userIds = activities
    .map((a) => a.user_id)
    .filter((id): id is string => id !== null);
  const displayNames = useDisplayNames(userIds);

  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No recent activity.</p>
    );
  }

  return (
    <div className="space-y-1">
      {activities.map((activity) => {
        const Icon = activity.type === 'rollback' ? RotateCcw : Pencil;
        const userName = activity.user_id
          ? displayNames.get(activity.user_id) ?? 'Unknown user'
          : 'System';

        return (
          <Link
            key={activity.id}
            href={`/item/${activity.entity_id}`}
            className="group flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
          >
            <Icon
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground line-clamp-1">
                <span className="capitalize">{activity.type}</span>
                {' — '}
                {activity.summary}
              </p>
              <p className="text-xs text-muted-foreground">
                {userName}
                {activity.created_at && (
                  <> &middot; {formatRelativeDate(activity.created_at)}</>
                )}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
