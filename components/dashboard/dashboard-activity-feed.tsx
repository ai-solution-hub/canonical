'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Pencil, RotateCcw } from 'lucide-react';
import { isToday, isYesterday, parseISO, startOfWeek } from 'date-fns';
import { formatRelativeDate } from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import type { ActivityItem, GroupedActivityItem } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupedActivity {
  /** Unique key for React rendering */
  key: string;
  /** The representative activity (first occurrence) */
  representative: ActivityItem;
  /** All activity IDs in this group */
  ids: string[];
  /** How many items were collapsed */
  count: number;
  /** Cleaned display text */
  displayText: string;
  /** Activity type for icon selection */
  type: string;
  /** Earliest timestamp in the group */
  earliestAt: string | null;
  /** Latest timestamp in the group */
  latestAt: string | null;
  /** Collected user IDs across the group */
  userIds: string[];
}

type TimeGroup = 'today' | 'yesterday' | 'this_week' | 'earlier';

interface TimeGroupedActivities {
  label: string;
  key: TimeGroup;
  items: GroupedActivity[];
}

// ---------------------------------------------------------------------------
// Summary text cleaning
// ---------------------------------------------------------------------------

/**
 * Cleans raw activity summary text for display.
 *
 * Quality flags arrive as "severity: flag_type" (e.g. "info: classification low").
 * We strip the severity prefix and capitalise the first letter.
 *
 * Edit and rollback events keep their existing change_summary text.
 */
function cleanSummary(type: string, summary: string): string {
  if (type === 'quality_flag') {
    // Strip "severity: " prefix (e.g. "info: ", "warning: ")
    const colonIndex = summary.indexOf(': ');
    const cleaned = colonIndex >= 0 ? summary.slice(colonIndex + 2) : summary;
    // Capitalise first letter
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * Groups duplicate activity items by type + summary, collapsing identical
 * entries into a single line with a count.
 */
function groupActivities(activities: ActivityItem[]): GroupedActivity[] {
  const groups = new Map<string, GroupedActivity>();

  for (const activity of activities) {
    const cleaned = cleanSummary(activity.type, activity.summary);
    const groupKey = `${activity.type}::${cleaned}`;

    const existing = groups.get(groupKey);
    if (existing) {
      existing.count += 1;
      existing.ids.push(activity.id);
      if (activity.user_id) {
        existing.userIds.push(activity.user_id);
      }
      // Track time range
      if (
        activity.created_at &&
        (!existing.earliestAt || activity.created_at < existing.earliestAt)
      ) {
        existing.earliestAt = activity.created_at;
      }
      if (
        activity.created_at &&
        (!existing.latestAt || activity.created_at > existing.latestAt)
      ) {
        existing.latestAt = activity.created_at;
      }
    } else {
      groups.set(groupKey, {
        key: groupKey,
        representative: activity,
        ids: [activity.id],
        count: 1,
        displayText: cleaned,
        type: activity.type,
        earliestAt: activity.created_at,
        latestAt: activity.created_at,
        userIds: activity.user_id ? [activity.user_id] : [],
      });
    }
  }

  return Array.from(groups.values());
}

/**
 * Assigns a time group label to a date string.
 */
function getTimeGroup(dateString: string | null): TimeGroup {
  if (!dateString) return 'earlier';
  try {
    const date = parseISO(dateString);
    if (isToday(date)) return 'today';
    if (isYesterday(date)) return 'yesterday';
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
    if (date >= weekStart) return 'this_week';
    return 'earlier';
  } catch {
    return 'earlier';
  }
}

const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  earlier: 'Earlier',
};

const TIME_GROUP_ORDER: TimeGroup[] = [
  'today',
  'yesterday',
  'this_week',
  'earlier',
];

/**
 * Organises grouped activities into time-based sections.
 */
function groupByTime(
  grouped: GroupedActivity[],
): TimeGroupedActivities[] {
  const buckets = new Map<TimeGroup, GroupedActivity[]>();

  for (const group of TIME_GROUP_ORDER) {
    buckets.set(group, []);
  }

  for (const item of grouped) {
    // Use the latest timestamp for time grouping
    const timeGroup = getTimeGroup(item.latestAt);
    buckets.get(timeGroup)!.push(item);
  }

  return TIME_GROUP_ORDER.filter((key) => buckets.get(key)!.length > 0).map(
    (key) => ({
      label: TIME_GROUP_LABELS[key],
      key,
      items: buckets.get(key)!,
    }),
  );
}

// ---------------------------------------------------------------------------
// Timestamp display helper
// ---------------------------------------------------------------------------

function formatGroupTimestamp(group: GroupedActivity): string {
  if (group.count === 1) {
    return formatRelativeDate(group.latestAt);
  }
  // For grouped items, show the latest timestamp
  return formatRelativeDate(group.latestAt);
}

// ---------------------------------------------------------------------------
// Icon selection
// ---------------------------------------------------------------------------

function getActivityIcon(type: string) {
  switch (type) {
    case 'rollback':
      return RotateCcw;
    case 'quality_flag':
      return AlertTriangle;
    default:
      return Pencil;
  }
}

function getActivityIconClass(type: string): string {
  switch (type) {
    case 'rollback':
      return 'text-status-warning';
    case 'quality_flag':
      return 'text-status-warning';
    default:
      return 'text-muted-foreground';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DashboardActivityFeedProps {
  activities: ActivityItem[] | GroupedActivityItem[];
}

export function DashboardActivityFeed({
  activities,
}: DashboardActivityFeedProps) {
  const userIds = activities
    .map((a) => a.user_id)
    .filter((id): id is string => id !== null);
  const displayNames = useDisplayNames(userIds);

  const timeGroups = useMemo(() => {
    // Detect pre-grouped data from the RPC (has event_count field)
    const isPreGrouped = activities.length > 0 && 'event_count' in activities[0];

    let grouped: GroupedActivity[];
    if (isPreGrouped) {
      grouped = (activities as GroupedActivityItem[]).map((item) => ({
        key: `${item.type}::${item.id}`,
        representative: item,
        ids: [item.id],
        count: item.event_count,
        displayText: cleanSummary(item.type, item.summary),
        type: item.type,
        earliestAt: item.earliest_at,
        latestAt: item.latest_at ?? item.created_at,
        userIds: item.user_id ? [item.user_id] : [],
      }));
    } else {
      grouped = groupActivities(activities as ActivityItem[]);
    }

    return groupByTime(grouped);
  }, [activities]);

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Activity
          className="size-8 text-muted-foreground/50 mb-3"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-muted-foreground">
          No recent activity
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Changes to the knowledge base will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" role="feed">
      {timeGroups.map((section) => (
        <div key={section.key}>
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 px-2">
            {section.label}
          </h4>
          <div className="space-y-1">
            {section.items.map((group) => {
              const Icon = getActivityIcon(group.type);
              const iconClass = getActivityIconClass(group.type);

              // Resolve user name — for single items use the user; for groups show count
              const userName =
                group.count === 1
                  ? group.representative.user_id
                    ? displayNames.get(group.representative.user_id) ??
                      'Unknown user'
                    : 'System'
                  : null;

              const timestamp = formatGroupTimestamp(group);

              return (
                <Link
                  key={group.key}
                  href={`/item/${group.representative.entity_id}`}
                  role="article"
                  className="group flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                >
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${iconClass}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground line-clamp-1">
                      {group.count > 1 && (
                        <span className="font-medium text-muted-foreground mr-1.5">
                          {group.count}&times;
                        </span>
                      )}
                      {group.displayText}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {userName && <>{userName}</>}
                      {userName && timestamp && <> &middot; </>}
                      {!userName && group.count > 1 && timestamp && (
                        <>{timestamp}</>
                      )}
                      {userName && timestamp && <>{timestamp}</>}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
