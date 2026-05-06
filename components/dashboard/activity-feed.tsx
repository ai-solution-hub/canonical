'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Edit3,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDisplayNames } from '@/hooks/use-display-names';
import { useHydrated } from '@/hooks/use-hydrated';
import { formatRelativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import type { GroupedActivityItem } from '@/lib/dashboard';

export type ActivityEventFilter =
  | 'all'
  | 'content'
  | 'governance'
  | 'bid'
  | 'system';
export type ActivityDateRange = 'all' | 'today' | 'week' | 'month';

interface ActivityFeedProps {
  className?: string;
  /** Maximum items to show per page */
  initialLimit?: number;
  /** Event type filter */
  eventFilter?: ActivityEventFilter;
  /** Date range filter */
  dateRange?: ActivityDateRange;
}

function activityIcon(type: string) {
  switch (type) {
    case 'edit':
      return <Edit3 className="size-3.5 text-primary" aria-hidden="true" />;
    case 'rollback':
      return (
        <RotateCcw
          className="size-3.5 text-status-warning"
          aria-hidden="true"
        />
      );
    case 'quality_flag':
      return (
        <AlertTriangle
          className="size-3.5 text-destructive"
          aria-hidden="true"
        />
      );
    default:
      return (
        <Activity
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      );
  }
}

function activityTypeLabel(type: string): string {
  switch (type) {
    case 'edit':
      return 'Edit';
    case 'rollback':
      return 'Rollback';
    case 'quality_flag':
      return 'Quality Flag';
    default:
      return type;
  }
}

function activityBadgeVariant(
  type: string,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (type) {
    case 'edit':
      return 'secondary';
    case 'rollback':
      return 'outline';
    case 'quality_flag':
      return 'destructive';
    default:
      return 'outline';
  }
}

/**
 * Activity feed component showing recent KB changes.
 *
 * Fetches from /api/activity and displays a timeline of edits,
 * rollbacks, and quality events. Uses cursor-based pagination
 * via the `before` query parameter.
 */
/** Map activity types to filter categories */
function getEventCategory(type: string): ActivityEventFilter {
  switch (type) {
    case 'edit':
    case 'rollback':
      return 'content';
    case 'quality_flag':
    case 'governance_approve':
    case 'governance_review_needed':
    case 'governance_request_changes':
    case 'governance_revert':
      return 'governance';
    case 'bid_created':
    case 'bid_updated':
    case 'bid_response':
      return 'bid';
    default:
      return 'system';
  }
}

/** Get the start-of-period date for a date range filter */
function getDateRangeStart(range: ActivityDateRange): Date | null {
  if (range === 'all') return null;
  const now = new Date(Date.now());
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return start;
    }
    case 'month': {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return start;
    }
    default:
      return null;
  }
}

export function ActivityFeed({
  className,
  initialLimit = 20,
  eventFilter = 'all',
  dateRange = 'all',
}: ActivityFeedProps) {
  const mounted = useHydrated();
  const [activities, setActivities] = useState<GroupedActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Apply local filters on fetched data
  const filteredActivities = useMemo(() => {
    let result = activities;

    if (eventFilter !== 'all') {
      result = result.filter((a) => getEventCategory(a.type) === eventFilter);
    }

    const rangeStart = getDateRangeStart(dateRange);
    if (rangeStart) {
      result = result.filter((a) => {
        if (!a.created_at) return false;
        return new Date(a.created_at) >= rangeStart;
      });
    }

    return result;
  }, [activities, eventFilter, dateRange]);

  // Collect user IDs for display name resolution
  const userIds = filteredActivities
    .map((a) => a.user_id)
    .filter((id): id is string => id !== null);
  const displayNames = useDisplayNames(userIds);

  const fetchActivities = useCallback(
    async (before: string | null, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams({ limit: String(initialLimit) });
        if (before) {
          params.set('before', before);
        }
        const res = await fetch(`/api/activity?${params.toString()}`);
        if (!res.ok) return;

        const data = await res.json();
        const items: GroupedActivityItem[] = data.activities ?? [];

        if (append) {
          setActivities((prev) => [...prev, ...items]);
        } else {
          setActivities(items);
        }

        setHasMore(data.has_more ?? false);
      } catch (err) {
        logBestEffortWarn(
          'dashboard.activity_feed.fetch',
          'Failed to load activity feed',
          { err },
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [initialLimit],
  );

  useEffect(() => {
    fetchActivities(null);
  }, [fetchActivities]);

  function handleLoadMore() {
    const lastItem = activities[activities.length - 1];
    const before = lastItem?.created_at ?? null;
    fetchActivities(before, true);
  }

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 py-12 text-center',
          className,
        )}
      >
        <Activity
          className="size-8 text-muted-foreground/50"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground">
          Activity will appear here as changes are made to the knowledge base.
        </p>
      </div>
    );
  }

  if (filteredActivities.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 py-12 text-center',
          className,
        )}
      >
        <Activity
          className="size-8 text-muted-foreground/50"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground">
          No matching activity
        </p>
        <p className="text-xs text-muted-foreground">
          Try adjusting your filters to see more activity.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {filteredActivities.map((activity) => (
        <Card key={activity.id} className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">{activityIcon(activity.type)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant={activityBadgeVariant(activity.type)}
                  className="text-[11px]"
                >
                  {activityTypeLabel(activity.type)}
                </Badge>
                {activity.event_count > 1 && (
                  <span className="font-medium text-muted-foreground mr-1.5">
                    {activity.event_count}&times;
                  </span>
                )}
                {activity.created_at && (
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeDate(activity.created_at)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-foreground">{activity.summary}</p>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                {activity.user_id && (
                  <span>
                    by{' '}
                    {displayNames.get(activity.user_id) ??
                      activity.user_id.slice(0, 8)}
                  </span>
                )}
                {activity.entity_id && (
                  <Link
                    href={`/item/${activity.entity_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    View item
                  </Link>
                )}
              </div>
            </div>
          </div>
        </Card>
      ))}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 className="mr-2 size-4 animate-spin" />}
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
