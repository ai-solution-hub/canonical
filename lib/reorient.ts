import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type {
  ReorientData,
  UrgentItem,
  TeamChange,
  RecentWorkItem,
  BidBriefing,
} from '@/types/reorient';
import { getDeadlineUrgency, getDaysUntilDeadline } from '@/lib/dashboard';
import { formatRelativeDate } from '@/lib/format';

// ---------------------------------------------------------------------------
// Change type mapping
// ---------------------------------------------------------------------------

function mapChangeTypeToAction(changeType: string): TeamChange['action'] | RecentWorkItem['action'] {
  switch (changeType) {
    case 'create':
    case 'import':
      return 'created';
    case 'edit':
    case 'ai_update':
    case 'merge':
      return 'updated';
    case 'rollback':
      return 'reviewed';
    default:
      return 'updated';
  }
}

// ---------------------------------------------------------------------------
// Main data fetching function
// ---------------------------------------------------------------------------

export async function fetchReorientData(
  supabase: SupabaseClient<Database>,
  userId: string,
  isAdmin: boolean,
  role: string,
): Promise<ReorientData> {
  const errors: string[] = [];

  // Query 1: User's last activity timestamp
  const lastActivityQuery = supabase
    .from('content_history')
    .select('created_at')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  // Determine last_active_at from content_history, then auth last_sign_in_at, then 24h ago
  const { data: lastActivityData } = await lastActivityQuery;
  let lastActiveAt: string | null = null;

  if (lastActivityData && lastActivityData.length > 0) {
    lastActiveAt = lastActivityData[0].created_at;
  } else {
    // Fall back to last_sign_in_at from auth
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser?.last_sign_in_at) {
        lastActiveAt = authUser.last_sign_in_at;
      }
    } catch {
      // Non-critical — will fall back to 24h ago
    }
  }

  // Final fallback: 24 hours ago
  const sinceDate = lastActiveAt
    ? lastActiveAt
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Run remaining queries in parallel
  const results = await Promise.allSettled([
    // 0: Team changes since last active
    supabase
      .from('content_history')
      .select('id, content_item_id, change_type, change_summary, created_by, created_at, content_items!inner(title, primary_domain)')
      .gt('created_at', sinceDate)
      .neq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(20),

    // 1: User's own recent work
    supabase
      .from('content_history')
      .select('id, content_item_id, change_type, change_summary, created_at, content_items!inner(title)')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(5),

    // 2: Active bids
    supabase
      .from('workspaces')
      .select('id, name, domain_metadata, is_archived, updated_at')
      .eq('type', 'bid')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false }),

    // 3: Expired content count
    supabase.rpc('get_freshness_breakdown'),

    // 4: Governance reviews pending (editor/admin only)
    role === 'viewer'
      ? Promise.resolve({ count: 0, error: null })
      : supabase
          .from('content_items')
          .select('*', { count: 'exact', head: true })
          .eq('governance_review_status', 'pending'),

    // 5: Quality flags count (admin only)
    isAdmin
      ? supabase
          .from('ingestion_quality_log')
          .select('*', { count: 'exact', head: true })
          .eq('resolved', false)
      : Promise.resolve({ count: 0, error: null }),

    // 6: Unread notifications
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('dismissed_at', null),
  ]);

  // --- Extract team changes ---
  const team_changes: TeamChange[] = [];
  if (results[0].status === 'fulfilled') {
    const { data, error } = results[0].value;
    if (error) {
      errors.push('team_changes query failed');
    } else if (data) {
      for (const row of data) {
        const ci = row.content_items as unknown as { title: string; primary_domain: string } | null;
        team_changes.push({
          user_id: row.created_by ?? '',
          user_name: null, // Resolved client-side via useDisplayNames
          action: mapChangeTypeToAction(row.change_type ?? 'edit') as TeamChange['action'],
          entity_type: 'content_item',
          entity_id: row.content_item_id,
          entity_title: ci?.title ?? 'Untitled',
          domain: ci?.primary_domain ?? undefined,
          created_at: row.created_at,
        });
      }
    }
  } else {
    errors.push('team_changes query failed');
  }

  // --- Extract user's recent work ---
  const my_recent_work: RecentWorkItem[] = [];
  if (results[1].status === 'fulfilled') {
    const { data, error } = results[1].value;
    if (error) {
      errors.push('my_recent_work query failed');
    } else if (data) {
      for (const row of data) {
        const ci = row.content_items as unknown as { title: string } | null;
        my_recent_work.push({
          entity_type: 'content_item',
          entity_id: row.content_item_id,
          entity_title: ci?.title ?? 'Untitled',
          action: mapChangeTypeToAction(row.change_type ?? 'edit') as RecentWorkItem['action'],
          href: `/item/${row.content_item_id}`,
          created_at: row.created_at,
        });
      }
    }
  } else {
    errors.push('my_recent_work query failed');
  }

  // --- Extract active bids with question stats ---
  const bid_summary: BidBriefing[] = [];
  if (results[2].status === 'fulfilled') {
    const { data: workspaces, error } = results[2].value;
    if (error) {
      errors.push('bid_summary query failed');
    } else if (workspaces && workspaces.length > 0) {
      const bidIds = workspaces.map((w) => w.id);
      const { data: batchStats } = await supabase.rpc(
        'get_bid_question_stats_batch',
        { p_project_ids: bidIds },
      );

      const statsMap = new Map<string, {
        total_questions: number;
        drafted_count: number;
        complete_count: number;
        needs_sme_count: number;
        no_content_count: number;
      }>();
      if (batchStats) {
        for (const row of batchStats) {
          statsMap.set(row.project_id, row);
        }
      }

      for (const workspace of workspaces) {
        const meta = workspace.domain_metadata as Record<string, unknown> | null;
        const stats = statsMap.get(workspace.id);
        const deadline = (meta?.deadline as string) ?? null;
        const urgency = getDeadlineUrgency(deadline);
        const totalQ = stats?.total_questions ?? 0;
        const answeredQ = (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);

        bid_summary.push({
          id: workspace.id,
          name: workspace.name ?? 'Untitled Bid',
          buyer: (meta?.buyer as string) ?? null,
          status: (meta?.status as string) ?? 'draft',
          deadline,
          days_until_deadline: getDaysUntilDeadline(deadline),
          urgency,
          total_questions: totalQ,
          answered_questions: answeredQ,
          approved_questions: stats?.complete_count ?? 0,
          gap_count: (stats?.needs_sme_count ?? 0) + (stats?.no_content_count ?? 0),
          href: `/bid/${workspace.id}`,
        });
      }

      // Sort by deadline urgency
      const urgencyOrder: Record<string, number> = {
        overdue: 0, urgent: 1, approaching: 2, normal: 3, unknown: 4,
      };
      bid_summary.sort((a, b) =>
        (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4),
      );
    }
  } else {
    errors.push('bid_summary query failed');
  }

  // --- Extract freshness counts ---
  let staleOrExpired = 0;
  if (results[3].status === 'fulfilled') {
    const { data, error } = results[3].value;
    if (error) {
      errors.push('freshness query failed');
    } else if (data) {
      for (const row of data as { freshness: string; count: number }[]) {
        if (row.freshness === 'stale' || row.freshness === 'expired') {
          staleOrExpired += row.count;
        }
      }
    }
  }

  // --- Extract pending reviews count ---
  let pendingReviews = 0;
  if (results[4].status === 'fulfilled') {
    const r = results[4].value as { count?: number | null; error?: unknown };
    if (!r.error) {
      pendingReviews = r.count ?? 0;
    }
  }

  // --- Extract quality flags count ---
  let qualityFlags = 0;
  if (results[5].status === 'fulfilled') {
    const r = results[5].value as { count?: number | null; error?: unknown };
    if (!r.error) {
      qualityFlags = r.count ?? 0;
    }
  }

  // --- Extract unread notifications count ---
  let unreadNotifications = 0;
  if (results[6].status === 'fulfilled') {
    const r = results[6].value as { count?: number | null; error?: unknown };
    if (!r.error) {
      unreadNotifications = r.count ?? 0;
    }
  }

  // --- Build urgent items ---
  const urgent: UrgentItem[] = [];

  // Overdue or urgent bids
  for (const bid of bid_summary) {
    if (bid.urgency === 'overdue') {
      urgent.push({
        type: 'bid_deadline',
        priority: 1,
        title: `${bid.name} — deadline passed`,
        detail: bid.deadline
          ? `Deadline was ${formatRelativeDate(bid.deadline)}`
          : 'Deadline has passed',
        href: bid.href,
        entity_id: bid.id,
        deadline: bid.deadline,
      });
    } else if (bid.urgency === 'urgent') {
      const days = bid.days_until_deadline;
      urgent.push({
        type: 'bid_deadline',
        priority: 2,
        title: `${bid.name} — ${days === 0 ? 'due today' : `${days} day${days === 1 ? '' : 's'} left`}`,
        detail: `${bid.answered_questions}/${bid.total_questions} questions drafted`,
        href: `${bid.href}/session`,
        entity_id: bid.id,
        deadline: bid.deadline,
      });
    }
  }

  // Expired content
  if (staleOrExpired > 0) {
    urgent.push({
      type: 'content_expired',
      priority: 2,
      title: `${staleOrExpired} content item${staleOrExpired === 1 ? '' : 's'} need${staleOrExpired === 1 ? 's' : ''} refreshing`,
      detail: 'Stale or expired items may contain outdated information',
      href: '/browse?freshness=stale,expired',
      entity_id: 'freshness',
    });
  }

  // Pending reviews (editor/admin)
  if (pendingReviews > 0) {
    urgent.push({
      type: 'review_pending',
      priority: 3,
      title: `${pendingReviews} governance review${pendingReviews === 1 ? '' : 's'} pending`,
      detail: 'Items awaiting review',
      href: '/review',
      entity_id: 'reviews',
    });
  }

  // Unresolved quality flags (admin only)
  if (isAdmin && qualityFlags > 0) {
    urgent.push({
      type: 'quality_flag',
      priority: 3,
      title: `${qualityFlags} quality flag${qualityFlags === 1 ? '' : 's'} unresolved`,
      detail: 'Items with quality issues need attention',
      href: '/review',
      entity_id: 'quality-flags',
    });
  }

  // Sort by priority
  urgent.sort((a, b) => a.priority - b.priority);

  // Get user display name from auth
  let userDisplayName: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.user_metadata?.full_name) {
      const fullName = user.user_metadata.full_name as string;
      userDisplayName = fullName.split(' ')[0] ?? fullName;
    } else if (user?.email) {
      userDisplayName = user.email.split('@')[0] ?? null;
    }
  } catch {
    // Non-critical — greeting will just omit the name
  }

  return {
    last_active_at: lastActiveAt,
    last_active_relative: formatRelativeDate(lastActiveAt),
    urgent,
    team_changes,
    my_recent_work,
    bid_summary,
    counts: {
      unread_notifications: unreadNotifications,
      pending_reviews: pendingReviews,
      stale_or_expired: staleOrExpired,
      quality_flags: qualityFlags,
    },
    generated_at: new Date().toISOString(),
    user_display_name: userDisplayName,
    errors,
  };
}
