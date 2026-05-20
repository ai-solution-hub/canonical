import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type {
  ReorientData,
  UrgentItem,
  TeamChange,
  RecentWorkItem,
  ProcurementBriefing,
} from '@/types/reorient';
import { getDeadlineUrgency, getDaysUntilDeadline } from '@/lib/dashboard';
import { fetchActiveProcurementWithStats } from '@/lib/procurement/procurement-queries';
import { formatRelativeDate } from '@/lib/format';
import { getUserDisplayName } from '@/lib/user/display-name';

// ---------------------------------------------------------------------------
// Change type mapping
// ---------------------------------------------------------------------------

function mapChangeTypeToAction(
  changeType: string,
): TeamChange['action'] | RecentWorkItem['action'] {
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

function dedupeRecentWorkByEntity(items: RecentWorkItem[]): RecentWorkItem[] {
  const seen = new Set<string>();
  const deduped: RecentWorkItem[] = [];
  for (const item of items) {
    const key = `${item.entity_type}:${item.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Main data fetching function
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `fetchUnifiedDashboardData()` from `lib/dashboard.ts` instead.
 * This function runs queries that duplicate the unified fetch.
 * The unified fetch in `lib/dashboard.ts` eliminates all duplicate queries.
 */
export async function fetchReorientData(
  supabase: SupabaseClient<Database>,
  userId: string,
  isAdmin: boolean,
  role: string,
): Promise<ReorientData> {
  const errors: string[] = [];

  // Query 1: User's last activity timestamp (write activity + read activity)
  const [lastWriteResult, lastReadResult] = await Promise.all([
    supabase
      .from('content_history')
      .select('created_at')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('read_marks')
      .select('read_at')
      .eq('user_id', userId)
      .order('read_at', { ascending: false })
      .limit(1),
  ]);

  // Determine last_active_at from the most recent of content_history or read_marks,
  // then auth last_sign_in_at, then 24h ago
  const lastWriteAt = lastWriteResult.data?.[0]?.created_at ?? null;
  const lastReadAt = lastReadResult.data?.[0]?.read_at ?? null;

  // Fetch auth user once — used for last_sign_in_at fallback and display name
  let authUser: {
    last_sign_in_at?: string | null;
    user_metadata?: Record<string, unknown>;
    email?: string | null;
  } | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    authUser = user;
  } catch {
    // Non-critical — will fall back to defaults
  }

  let lastActiveAt: string | null = null;

  if (lastWriteAt && lastReadAt) {
    // Take the more recent of the two
    lastActiveAt =
      new Date(lastWriteAt) >= new Date(lastReadAt) ? lastWriteAt : lastReadAt;
  } else if (lastWriteAt) {
    lastActiveAt = lastWriteAt;
  } else if (lastReadAt) {
    lastActiveAt = lastReadAt;
  } else if (authUser?.last_sign_in_at) {
    lastActiveAt = authUser.last_sign_in_at;
  }

  // Final fallback: 24 hours ago
  const sinceDate = lastActiveAt
    ? lastActiveAt
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Current time for notification expiry filter (separate from sinceDate which is last-active lookback)
  const nowIso = new Date().toISOString();

  // Run remaining queries in parallel (active bids via shared helper)
  const [results, activeBidsResult] = await Promise.all([
    Promise.allSettled([
      // 0: Team changes since last active
      supabase
        .from('content_history')
        .select(
          'id, content_item_id, change_type, change_summary, created_by, created_at, content_items!inner(title, primary_domain)',
        )
        .gt('created_at', sinceDate)
        .neq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      // 1: User's own recent work
      supabase
        .from('content_history')
        .select(
          'id, content_item_id, change_type, change_summary, created_at, content_items!inner(title)',
        )
        .eq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // 2: Expired content count
      supabase.rpc('get_freshness_breakdown'),

      // 3: Governance reviews pending (editor/admin only)
      role === 'viewer'
        ? Promise.resolve({ count: 0, error: null })
        : supabase
            .from('content_items')
            .select('*', { count: 'exact', head: true })
            .eq('governance_review_status', 'pending'),

      // 4: Quality flags count (admin only)
      // Uses the same RPC as fetchUnifiedDashboardData() so counts are consistent —
      // returns distinct content_item_ids with unresolved flags, not raw log entries
      isAdmin
        ? supabase.rpc('get_items_with_quality_flags')
        : Promise.resolve({ data: [], error: null }),

      // 5: Unread notifications (aligned with /api/notifications filters)
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .is('read_at', null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`),

      // 6: Procurement response changes by others (team changes)
      supabase
        .from('bid_response_history')
        .select(
          'id, response_id, edited_by, created_at, bid_responses!inner(question_id, bid_questions!inner(workspace_id, workspaces!inner(name)))',
        )
        .gt('created_at', sinceDate)
        .neq('edited_by', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      // 7: User's own bid response edits (recent work)
      supabase
        .from('bid_response_history')
        .select(
          'id, response_id, edited_by, created_at, bid_responses!inner(question_id, bid_questions!inner(workspace_id, question_text, workspaces!inner(id, name)))',
        )
        .eq('edited_by', userId)
        .order('created_at', { ascending: false })
        .limit(5),
    ]),
    fetchActiveProcurementWithStats(supabase),
  ]);

  // --- Extract team changes ---
  const team_changes: TeamChange[] = [];
  if (results[0].status === 'fulfilled') {
    const { data, error } = results[0].value;
    if (error) {
      errors.push('team_changes query failed');
    } else if (data) {
      for (const row of data) {
        const ci = row.content_items as unknown as {
          title: string;
          primary_domain: string;
        } | null;
        team_changes.push({
          user_id: row.created_by ?? '',
          user_name: null, // Resolved client-side via useDisplayNames
          action: mapChangeTypeToAction(
            row.change_type ?? 'edit',
          ) as TeamChange['action'],
          entity_type: 'content_item',
          entity_id: row.content_item_id ?? '',
          entity_title: ci?.title ?? 'Untitled',
          domain: ci?.primary_domain ?? undefined,
          created_at: row.created_at,
        });
      }
    }
  } else {
    errors.push('team_changes query failed');
  }

  // --- Extract bid response team changes ---
  if (results[6].status === 'fulfilled') {
    const { data, error } = results[6].value;
    if (error) {
      errors.push('bid_response team_changes query failed');
    } else if (data) {
      for (const row of data) {
        const br = row.bid_responses as unknown as {
          question_id: string;
          bid_questions: {
            workspace_id: string;
            workspaces: { name: string };
          };
        } | null;
        team_changes.push({
          user_id: row.edited_by ?? '',
          user_name: null,
          action: 'updated',
          entity_type: 'bid_response',
          entity_id: row.response_id,
          entity_title: br?.bid_questions?.workspaces?.name ?? 'Untitled Procurement',
          domain: undefined,
          created_at: row.created_at,
          workspace_id: br?.bid_questions?.workspace_id,
          question_id: br?.question_id,
        });
      }
    }
  } else {
    errors.push('bid_response team_changes query failed');
  }

  // Sort combined team changes by date (content_history + bid_response_history)
  team_changes.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

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
          entity_id: row.content_item_id ?? '',
          entity_title: ci?.title ?? 'Untitled',
          action: mapChangeTypeToAction(
            row.change_type ?? 'edit',
          ) as RecentWorkItem['action'],
          href: `/item/${row.content_item_id}`,
          created_at: row.created_at,
        });
      }
    }
  } else {
    errors.push('my_recent_work query failed');
  }

  // --- Extract user's own bid response edits ---
  if (results[7].status === 'fulfilled') {
    const { data, error } = results[7].value;
    if (error) {
      errors.push('bid_response my_recent_work query failed');
    } else if (data) {
      for (const row of data) {
        const br = row.bid_responses as unknown as {
          question_id: string;
          bid_questions: {
            workspace_id: string;
            question_text: string;
            workspaces: { id: string; name: string };
          };
        } | null;
        const questionText =
          br?.bid_questions?.question_text ?? 'Untitled question';
        const procurementId = br?.bid_questions?.workspaces?.id;
        my_recent_work.push({
          entity_type: 'bid_response',
          entity_id: row.response_id,
          entity_title:
            questionText.length > 60
              ? `${questionText.slice(0, 57)}...`
              : questionText,
          action: 'edited',
          href: procurementId ? `/procurement/${procurementId}/session` : '/procurement',
          created_at: row.created_at,
          workspace_id: procurementId,
          question_id: br?.question_id,
        });
      }
    }
  } else {
    errors.push('bid_response my_recent_work query failed');
  }

  // Sort combined recent work by date, collapse repeated audit rows for the
  // same entity, and limit to 5. Multiple content_history rows per item are
  // legitimate (publication-state transitions, edits, imports), but reorient
  // should present the latest entity once rather than duplicate the same UUID.
  my_recent_work.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const latestRecentWork = dedupeRecentWorkByEntity(my_recent_work).slice(0, 5);

  // --- Extract active bids with question stats (from shared helper) ---
  const { workspaces: procurementWorkspaces, statsMap } = activeBidsResult;
  const bid_summary: ProcurementBriefing[] = [];

  for (const workspace of procurementWorkspaces) {
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const stats = statsMap.get(workspace.id);
    const deadline = (meta?.deadline as string) ?? null;
    const urgency = getDeadlineUrgency(deadline);
    const totalQ = stats?.total_questions ?? 0;
    const answeredQ =
      (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);

    bid_summary.push({
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
    });
  }

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

  // --- Extract freshness counts ---
  let staleOrExpired = 0;
  if (results[2].status === 'fulfilled') {
    const { data, error } = results[2].value;
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
  if (results[3].status === 'fulfilled') {
    const r = results[3].value as { count?: number | null; error?: unknown };
    if (!r.error) {
      pendingReviews = r.count ?? 0;
    }
  }

  // --- Extract quality flags count (distinct items with unresolved flags) ---
  let qualityFlags = 0;
  if (results[4].status === 'fulfilled') {
    const r = results[4].value as { data?: unknown[] | null; error?: unknown };
    if (!r.error) {
      qualityFlags = Array.isArray(r.data) ? r.data.length : 0;
    }
  }

  // --- Extract unread notifications count ---
  let unreadNotifications = 0;
  if (results[5].status === 'fulfilled') {
    const r = results[5].value as { count?: number | null; error?: unknown };
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

  // Unread notifications above threshold (5+)
  if (unreadNotifications >= 5) {
    urgent.push({
      type: 'notification',
      priority: 3,
      title: `${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}`,
      detail: 'You have unread notifications that may need attention',
      href: '/settings?tab=notifications',
      entity_id: 'notifications',
    });
  }

  // Quality flags (admin only)
  if (qualityFlags > 0) {
    urgent.push({
      type: 'quality_flag',
      priority: 3,
      title: `${qualityFlags} unresolved quality flag${qualityFlags === 1 ? '' : 's'}`,
      detail: 'Items flagged during ingestion that need review',
      href: '/browse?quality=flagged',
      entity_id: 'quality_flags',
    });
  }

  // Sort by priority
  urgent.sort((a, b) => a.priority - b.priority);

  // Get user display name from auth (reuse authUser fetched earlier)
  const { display_name: userDisplayName, has_display_name: hasDisplayName } =
    getUserDisplayName(authUser);

  return {
    last_active_at: lastActiveAt,
    last_active_relative: formatRelativeDate(lastActiveAt),
    urgent,
    team_changes,
    my_recent_work: latestRecentWork,
    bid_summary,
    counts: {
      unread_notifications: unreadNotifications,
      pending_reviews: pendingReviews,
      stale_or_expired: staleOrExpired,
      quality_flags: qualityFlags,
    },
    generated_at: new Date().toISOString(),
    user_display_name: userDisplayName,
    has_display_name: hasDisplayName,
    errors,
  };
}

/**
 * Resolve user UUIDs to display names (first name only for reorient
 * briefings). S156 WP-2: routes through `resolveUserDisplayNames` which
 * wraps the `get_user_display_names` SQL function (single round trip,
 * SECURITY DEFINER), replacing the previous `auth.admin.getUserById`
 * Promise.allSettled loop that silently degraded for pipeline-owned
 * content. Pipeline service account resolves to `'Pipeline (system)'`
 * and unknown UUIDs resolve to `'A team member'` — both are passed
 * through unchanged rather than split on space (the "first token of
 * 'A team member'" would render as `'A'`, which is worse than the
 * fallback).
 */
export async function resolveDisplayNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;

  const uniqueIds = [...new Set(userIds)];

  const { createServiceClient } = await import('@/lib/supabase/server');
  const serviceClient = createServiceClient();

  const { resolveUserDisplayNames } = await import('@/lib/users/display-names');
  const map = await resolveUserDisplayNames(serviceClient, uniqueIds);

  for (const [id, info] of map) {
    // Reorient briefings prefer first names ("Alice" not "Alice Smith"),
    // but the SQL function's sentinel fallbacks ('Pipeline (system)' and
    // 'A team member') MUST pass through unchanged. Splitting them on
    // space would produce 'Pipeline' and 'A' respectively — the second
    // is the S156 verification report L-1 bug. Detect both sentinels
    // by exact match.
    if (
      info.display_name === 'A team member' ||
      info.display_name === 'Pipeline (system)'
    ) {
      names.set(id, info.display_name);
      continue;
    }
    const first = info.display_name.split(' ')[0] ?? info.display_name;
    names.set(id, first);
  }

  return names;
}
