import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type {
  TeamChange,
  RecentWorkItem,
  BidBriefing,
} from '@/types/reorient';
import { fetchActiveBidsWithStats } from '@/lib/bid-queries';
import { formatRelativeDate } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardData {
  needs_attention: {
    governance_review_count: number | null;
    unverified_count: number | null;
    quality_flag_count: number | null;
    stale_content_count: number | null;
    expired_content_count: number | null;
  };
  active_bids: ActiveBidSummary[];
  freshness_summary: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
  unread_notification_count: number;
  recent_activity: ActivityItem[] | GroupedActivityItem[];
  user_role: string;
  errors: string[];
}

export interface ActiveBidSummary {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  days_until_deadline: number | null;
  total_questions: number;
  answered_questions: number;
  approved_questions: number;
}

export interface ActivityItem {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  user_id: string | null;
  created_at: string | null;
}

export interface GroupedActivityItem extends ActivityItem {
  latest_at: string | null;
  earliest_at: string | null;
  event_count: number;
}

// ---------------------------------------------------------------------------
// Urgency helpers
// ---------------------------------------------------------------------------

export type DeadlineUrgency = 'overdue' | 'urgent' | 'approaching' | 'normal' | 'unknown';

export function getDeadlineUrgency(deadline: string | null): DeadlineUrgency {
  if (!deadline) return 'unknown';
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const diffMs = deadlineDate.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 'overdue';
  if (diffDays < 3) return 'urgent';
  if (diffDays < 14) return 'approaching';
  return 'normal';
}

export function getDaysUntilDeadline(deadline: string | null): number | null {
  if (!deadline) return null;
  const now = new Date();
  const deadlineDate = new Date(deadline);
  return Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Shared query logic (used by both server component and API route)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `fetchUnifiedDashboardData()` instead. This function runs
 * queries that duplicate those in `fetchReorientData()`. The unified fetch
 * eliminates 4 duplicate queries (freshness, governance, notifications, bids).
 */
export async function fetchDashboardData(
  supabase: SupabaseClient<Database>,
  userId: string,
  isAdmin: boolean,
  role?: string,
): Promise<DashboardData> {
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  // Run active bids query in parallel with the other queries
  const [results, activeBidsResult] = await Promise.all([
    Promise.allSettled([
      // 0: Governance reviews pending
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true })
        .eq('governance_review_status', 'pending'),

      // 1: Unverified items
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true })
        .is('verified_at', null),

      // 2: Distinct content items with unresolved quality flags
      // Uses the same RPC as the browse filter so counts match
      supabase.rpc('get_items_with_quality_flags'),

      // 3: Freshness breakdown
      supabase.rpc('get_freshness_breakdown'),

      // 4: Unread notifications (aligned with /api/notifications + reorient filters)
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .is('read_at', null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`),

      // 5: Recent activity (grouped RPC — replaces separate content_history + quality_log queries)
      supabase.rpc('get_grouped_activity_feed', {
        p_limit: 10,
        p_is_admin: isAdmin,
      }),
    ]),
    fetchActiveBidsWithStats(supabase),
  ]);

  // --- Extract governance review count ---
  let governance_review_count: number | null = null;
  if (results[0].status === 'fulfilled') {
    const { count, error } = results[0].value;
    if (error) {
      errors.push('governance_review_count query failed');
    } else {
      governance_review_count = count ?? 0;
    }
  } else {
    errors.push('governance_review_count query failed');
  }

  // --- Extract unverified count ---
  let unverified_count: number | null = null;
  if (results[1].status === 'fulfilled') {
    const { count, error } = results[1].value;
    if (error) {
      errors.push('unverified_count query failed');
    } else {
      unverified_count = count ?? 0;
    }
  } else {
    errors.push('unverified_count query failed');
  }

  // --- Extract quality flag count (distinct items with unresolved flags) ---
  let quality_flag_count: number | null = null;
  if (results[2].status === 'fulfilled') {
    const { data, error } = results[2].value;
    if (error) {
      errors.push('quality_flag_count query failed');
    } else {
      quality_flag_count = Array.isArray(data) ? data.length : 0;
    }
  } else {
    errors.push('quality_flag_count query failed');
  }

  // --- Extract freshness ---
  const freshness_summary = { fresh: 0, aging: 0, stale: 0, expired: 0 };
  let stale_content_count: number | null = null;
  let expired_content_count: number | null = null;
  if (results[3].status === 'fulfilled') {
    const { data, error } = results[3].value;
    if (error) {
      errors.push('freshness_breakdown query failed');
    } else if (data) {
      for (const row of data as { freshness: string; count: number }[]) {
        const key = row.freshness as keyof typeof freshness_summary;
        if (key in freshness_summary) {
          freshness_summary[key] = row.count;
        }
      }
      stale_content_count = freshness_summary.stale;
      expired_content_count = freshness_summary.expired;
    }
  } else {
    errors.push('freshness_breakdown query failed');
  }

  // --- Extract active bids with question stats (from shared helper) ---
  const { workspaces: bidWorkspaces, statsMap } = activeBidsResult;
  const active_bids: ActiveBidSummary[] = bidWorkspaces.map((workspace) => {
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const stats = statsMap.get(workspace.id);
    const deadline = (meta?.deadline as string) ?? null;

    return {
      id: workspace.id,
      name: workspace.name ?? 'Untitled Bid',
      buyer: (meta?.buyer as string) ?? null,
      status: (meta?.status as string) ?? 'draft',
      deadline,
      days_until_deadline: getDaysUntilDeadline(deadline),
      total_questions: stats?.total_questions ?? 0,
      answered_questions: (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0),
      approved_questions: stats?.complete_count ?? 0,
    };
  });

  // Sort by deadline urgency (most urgent first)
  active_bids.sort((a, b) => {
    const urgencyOrder: Record<DeadlineUrgency, number> = {
      overdue: 0,
      urgent: 1,
      approaching: 2,
      normal: 3,
      unknown: 4,
    };
    const aUrgency = urgencyOrder[getDeadlineUrgency(a.deadline)];
    const bUrgency = urgencyOrder[getDeadlineUrgency(b.deadline)];
    return aUrgency - bUrgency;
  });

  // --- Extract unread notification count ---
  let unread_notification_count = 0;
  if (results[4].status === 'fulfilled') {
    const { count, error } = results[4].value;
    if (error) {
      errors.push('unread_notification_count query failed');
    } else {
      unread_notification_count = count ?? 0;
    }
  } else {
    errors.push('unread_notification_count query failed');
  }

  // --- Extract recent activity (grouped RPC) ---
  let recent_activity: GroupedActivityItem[] = [];
  if (results[5].status === 'fulfilled') {
    const { data, error } = results[5].value;
    if (error) {
      errors.push('recent_activity query failed');
    } else if (data) {
      recent_activity = (data as Array<{
        id: string;
        type: string;
        entity_type: string;
        entity_id: string;
        summary: string;
        user_id: string | null;
        latest_at: string | null;
        earliest_at: string | null;
        event_count: number;
      }>).map((row) => ({
        id: row.id,
        type: row.type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        summary: row.summary,
        user_id: row.user_id,
        created_at: row.latest_at,
        latest_at: row.latest_at,
        earliest_at: row.earliest_at,
        event_count: row.event_count,
      }));
    }
  } else {
    errors.push('recent_activity query failed');
  }

  return {
    needs_attention: {
      governance_review_count,
      unverified_count,
      quality_flag_count,
      stale_content_count,
      expired_content_count,
    },
    active_bids,
    freshness_summary,
    unread_notification_count,
    recent_activity,
    user_role: role ?? 'viewer',
    errors,
  };
}

// ---------------------------------------------------------------------------
// Unified Dashboard Data — combines fetchDashboardData + fetchReorientData
// ---------------------------------------------------------------------------

export interface UnifiedDashboardData {
  /** Attention source counts for building AttentionItems */
  attention_sources: {
    governance_review_count: number;
    unverified_count: number;
    quality_flag_count: number;
    stale_content_count: number;
    expired_content_count: number;
    expiring_cert_count: number;
    expiring_content_date_count: number;
    unread_notification_count: number;
    coverage_gap_count: number;
  };

  /** Active bids with stats */
  active_bids: ActiveBidSummary[];

  /** Freshness summary for QuickStatsStrip */
  freshness_summary: { fresh: number; aging: number; stale: number; expired: number };

  /** Reorient data — personal context only */
  reorient: {
    user_display_name: string | null;
    has_display_name: boolean;
    last_active_relative: string;
    last_active_at: string | null;
    team_changes: TeamChange[];
    my_recent_work: RecentWorkItem[];
    bid_summary: BidBriefing[];
  };

  /** Recent activity feed */
  recent_activity: GroupedActivityItem[];

  /** User role */
  user_role: string;

  /** Partial failure tracking */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Change type mapping (mirrored from reorient.ts for unified fetch)
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
// Unified fetch — eliminates duplicate queries from fetchDashboardData +
// fetchReorientData. Each query runs exactly ONCE.
// ---------------------------------------------------------------------------

/**
 * Fetch all dashboard data in a single pass. Replaces the pattern of calling
 * `fetchDashboardData()` and `fetchReorientData()` in parallel, which ran
 * 4 duplicate queries (freshness, governance reviews, notifications, active
 * bids).
 *
 * Returns a `UnifiedDashboardData` object containing attention source counts,
 * active bids, freshness summary, reorient personal context, recent activity,
 * and an error array tracking any partial failures.
 */
export async function fetchUnifiedDashboardData(
  supabase: SupabaseClient<Database>,
  userId: string,
  isAdmin: boolean,
  role?: string,
): Promise<UnifiedDashboardData> {
  const errors: string[] = [];
  const effectiveRole = role ?? 'viewer';
  const nowIso = new Date().toISOString();

  // --- Phase 1: User's last activity (needed to scope team_changes query) ---
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

  const lastWriteAt = lastWriteResult.data?.[0]?.created_at ?? null;
  const lastReadAt = lastReadResult.data?.[0]?.read_at ?? null;

  // Fetch auth user for last_sign_in_at fallback and display name
  let authUser: {
    last_sign_in_at?: string | null;
    user_metadata?: Record<string, unknown>;
    email?: string | null;
  } | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    authUser = user;
  } catch {
    // Non-critical — will fall back to defaults
  }

  let lastActiveAt: string | null = null;
  if (lastWriteAt && lastReadAt) {
    lastActiveAt = new Date(lastWriteAt) >= new Date(lastReadAt) ? lastWriteAt : lastReadAt;
  } else if (lastWriteAt) {
    lastActiveAt = lastWriteAt;
  } else if (lastReadAt) {
    lastActiveAt = lastReadAt;
  } else if (authUser?.last_sign_in_at) {
    lastActiveAt = authUser.last_sign_in_at;
  }

  const sinceDate = lastActiveAt
    ? lastActiveAt
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // --- Phase 2: All queries in parallel (each runs exactly ONCE) ---
  const [results, activeBidsResult] = await Promise.all([
    Promise.allSettled([
      // 0: Governance reviews pending (editor/admin only — skip for viewer)
      effectiveRole === 'viewer'
        ? Promise.resolve({ count: 0, error: null })
        : supabase
            .from('content_items')
            .select('*', { count: 'exact', head: true })
            .eq('governance_review_status', 'pending'),

      // 1: Unverified items
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true })
        .is('verified_at', null),

      // 2: Distinct content items with unresolved quality flags (admin only)
      isAdmin
        ? supabase.rpc('get_items_with_quality_flags')
        : Promise.resolve({ data: [], error: null }),

      // 3: Freshness breakdown (single query, used by multiple consumers)
      supabase.rpc('get_freshness_breakdown'),

      // 4: Unread notifications (aligned with /api/notifications + reorient filters)
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .is('read_at', null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`),

      // 5: Recent activity (grouped RPC)
      supabase.rpc('get_grouped_activity_feed', {
        p_limit: 10,
        p_is_admin: isAdmin,
      }),

      // 6: Team changes — content_history since last active (others' work)
      supabase
        .from('content_history')
        .select('id, content_item_id, change_type, change_summary, created_by, created_at, content_items!inner(title, primary_domain)')
        .gt('created_at', sinceDate)
        .neq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      // 7: User's own recent work — content_history
      supabase
        .from('content_history')
        .select('id, content_item_id, change_type, change_summary, created_at, content_items!inner(title)')
        .eq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // 8: Bid response changes by others (team changes)
      supabase
        .from('bid_response_history')
        .select('id, response_id, edited_by, created_at, bid_responses!inner(question_id, bid_questions!inner(project_id, workspaces!inner(name)))')
        .gt('created_at', sinceDate)
        .neq('edited_by', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      // 9: User's own bid response edits (recent work)
      supabase
        .from('bid_response_history')
        .select('id, response_id, edited_by, created_at, bid_responses!inner(question_id, bid_questions!inner(project_id, question_text, workspaces!inner(id, name)))')
        .eq('edited_by', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // 10: Expiring content dates — items with expiry_date within 30 days
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true })
        .not('expiry_date', 'is', null)
        .lte('expiry_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]),
    fetchActiveBidsWithStats(supabase),
  ]);

  // --- Extract governance review count (query 0) ---
  let governance_review_count = 0;
  if (results[0].status === 'fulfilled') {
    const r = results[0].value as { count?: number | null; error?: unknown };
    if (r.error) {
      errors.push('governance_review_count query failed');
    } else {
      governance_review_count = r.count ?? 0;
    }
  } else {
    errors.push('governance_review_count query failed');
  }

  // --- Extract unverified count (query 1) ---
  let unverified_count = 0;
  if (results[1].status === 'fulfilled') {
    const { count, error } = results[1].value;
    if (error) {
      errors.push('unverified_count query failed');
    } else {
      unverified_count = count ?? 0;
    }
  } else {
    errors.push('unverified_count query failed');
  }

  // --- Extract quality flag count (query 2, admin only) ---
  let quality_flag_count = 0;
  if (results[2].status === 'fulfilled') {
    const r = results[2].value as { data?: unknown[] | null; error?: unknown };
    if (r.error) {
      errors.push('quality_flag_count query failed');
    } else {
      quality_flag_count = Array.isArray(r.data) ? r.data.length : 0;
    }
  } else {
    errors.push('quality_flag_count query failed');
  }

  // --- Extract freshness breakdown (query 3 — single source of truth) ---
  const freshness_summary = { fresh: 0, aging: 0, stale: 0, expired: 0 };
  let stale_content_count = 0;
  let expired_content_count = 0;
  if (results[3].status === 'fulfilled') {
    const { data, error } = results[3].value;
    if (error) {
      errors.push('freshness_breakdown query failed');
    } else if (data) {
      for (const row of data as { freshness: string; count: number }[]) {
        const key = row.freshness as keyof typeof freshness_summary;
        if (key in freshness_summary) {
          freshness_summary[key] = row.count;
        }
      }
      stale_content_count = freshness_summary.stale;
      expired_content_count = freshness_summary.expired;
    }
  } else {
    errors.push('freshness_breakdown query failed');
  }

  // --- Extract unread notification count (query 4) ---
  let unread_notification_count = 0;
  if (results[4].status === 'fulfilled') {
    const { count, error } = results[4].value;
    if (error) {
      errors.push('unread_notification_count query failed');
    } else {
      unread_notification_count = count ?? 0;
    }
  } else {
    errors.push('unread_notification_count query failed');
  }

  // --- Extract recent activity (query 5) ---
  let recent_activity: GroupedActivityItem[] = [];
  if (results[5].status === 'fulfilled') {
    const { data, error } = results[5].value;
    if (error) {
      errors.push('recent_activity query failed');
    } else if (data) {
      recent_activity = (data as Array<{
        id: string;
        type: string;
        entity_type: string;
        entity_id: string;
        summary: string;
        user_id: string | null;
        latest_at: string | null;
        earliest_at: string | null;
        event_count: number;
      }>).map((row) => ({
        id: row.id,
        type: row.type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        summary: row.summary,
        user_id: row.user_id,
        created_at: row.latest_at,
        latest_at: row.latest_at,
        earliest_at: row.earliest_at,
        event_count: row.event_count,
      }));
    }
  } else {
    errors.push('recent_activity query failed');
  }

  // --- Extract team changes — content_history (query 6) ---
  const team_changes: TeamChange[] = [];
  if (results[6].status === 'fulfilled') {
    const { data, error } = results[6].value;
    if (error) {
      errors.push('team_changes query failed');
    } else if (data) {
      for (const row of data) {
        const ci = row.content_items as unknown as { title: string; primary_domain: string } | null;
        team_changes.push({
          user_id: row.created_by ?? '',
          user_name: null,
          action: mapChangeTypeToAction(row.change_type ?? 'edit') as TeamChange['action'],
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

  // --- Extract user's recent work — content_history (query 7) ---
  const my_recent_work: RecentWorkItem[] = [];
  if (results[7].status === 'fulfilled') {
    const { data, error } = results[7].value;
    if (error) {
      errors.push('my_recent_work query failed');
    } else if (data) {
      for (const row of data) {
        const ci = row.content_items as unknown as { title: string } | null;
        my_recent_work.push({
          entity_type: 'content_item',
          entity_id: row.content_item_id ?? '',
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

  // --- Extract bid response team changes (query 8) ---
  if (results[8].status === 'fulfilled') {
    const { data, error } = results[8].value;
    if (error) {
      errors.push('bid_response team_changes query failed');
    } else if (data) {
      for (const row of data) {
        const br = row.bid_responses as unknown as {
          question_id: string;
          bid_questions: {
            project_id: string;
            workspaces: { name: string };
          };
        } | null;
        team_changes.push({
          user_id: row.edited_by ?? '',
          user_name: null,
          action: 'updated',
          entity_type: 'bid_response',
          entity_id: row.response_id,
          entity_title: br?.bid_questions?.workspaces?.name ?? 'Untitled Bid',
          domain: undefined,
          created_at: row.created_at,
          workspace_id: br?.bid_questions?.project_id,
          question_id: br?.question_id,
        });
      }
    }
  } else {
    errors.push('bid_response team_changes query failed');
  }

  // Sort combined team changes by date (content_history + bid_response_history)
  team_changes.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // --- Extract user's own bid response edits (query 9) ---
  if (results[9].status === 'fulfilled') {
    const { data, error } = results[9].value;
    if (error) {
      errors.push('bid_response my_recent_work query failed');
    } else if (data) {
      for (const row of data) {
        const br = row.bid_responses as unknown as {
          question_id: string;
          bid_questions: {
            project_id: string;
            question_text: string;
            workspaces: { id: string; name: string };
          };
        } | null;
        const questionText = br?.bid_questions?.question_text ?? 'Untitled question';
        const bidId = br?.bid_questions?.workspaces?.id;
        my_recent_work.push({
          entity_type: 'bid_response',
          entity_id: row.response_id,
          entity_title: questionText.length > 60
            ? `${questionText.slice(0, 57)}...`
            : questionText,
          action: 'edited',
          href: bidId ? `/bid/${bidId}/session` : '/bid',
          created_at: row.created_at,
          workspace_id: bidId,
          question_id: br?.question_id,
        });
      }
    }
  } else {
    errors.push('bid_response my_recent_work query failed');
  }

  // Sort combined recent work by date and limit to 5
  my_recent_work.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  my_recent_work.splice(5);

  // --- Extract expiring content date count (query 10) ---
  let expiring_content_date_count = 0;
  if (results[10].status === 'fulfilled') {
    const { count, error } = results[10].value;
    if (error) {
      errors.push('expiring_content_date_count query failed');
    } else {
      expiring_content_date_count = count ?? 0;
    }
  } else {
    errors.push('expiring_content_date_count query failed');
  }

  // --- Build active bids (from shared helper — single query) ---
  const { workspaces: bidWorkspaces, statsMap } = activeBidsResult;
  const active_bids: ActiveBidSummary[] = bidWorkspaces.map((workspace) => {
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const stats = statsMap.get(workspace.id);
    const deadline = (meta?.deadline as string) ?? null;

    return {
      id: workspace.id,
      name: workspace.name ?? 'Untitled Bid',
      buyer: (meta?.buyer as string) ?? null,
      status: (meta?.status as string) ?? 'draft',
      deadline,
      days_until_deadline: getDaysUntilDeadline(deadline),
      total_questions: stats?.total_questions ?? 0,
      answered_questions: (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0),
      approved_questions: stats?.complete_count ?? 0,
    };
  });

  // Sort by deadline urgency (most urgent first)
  active_bids.sort((a, b) => {
    const urgencyOrder: Record<DeadlineUrgency, number> = {
      overdue: 0,
      urgent: 1,
      approaching: 2,
      normal: 3,
      unknown: 4,
    };
    const aUrgency = urgencyOrder[getDeadlineUrgency(a.deadline)];
    const bUrgency = urgencyOrder[getDeadlineUrgency(b.deadline)];
    return aUrgency - bUrgency;
  });

  // --- Build bid_summary for reorient (from the same bid data) ---
  const bid_summary: BidBriefing[] = bidWorkspaces.map((workspace) => {
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const stats = statsMap.get(workspace.id);
    const deadline = (meta?.deadline as string) ?? null;
    const urgency = getDeadlineUrgency(deadline);
    const totalQ = stats?.total_questions ?? 0;
    const answeredQ = (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);

    return {
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
    };
  });

  // Sort bid_summary by deadline urgency
  const urgencyOrder: Record<string, number> = {
    overdue: 0, urgent: 1, approaching: 2, normal: 3, unknown: 4,
  };
  bid_summary.sort((a, b) =>
    (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4),
  );

  // --- Resolve user display name ---
  let userDisplayName: string | null = null;
  const rawDisplayName =
    (authUser?.user_metadata?.display_name as string | undefined) ??
    (authUser?.user_metadata?.full_name as string | undefined);

  if (rawDisplayName) {
    userDisplayName = rawDisplayName.split(' ')[0] ?? rawDisplayName;
  } else if (authUser?.email) {
    const prefix = authUser.email.split('@')[0] ?? '';
    const cleaned = prefix.replace(/[._]+/g, ' ').replace(/\d+$/g, '').trim();
    if (cleaned.length > 0) {
      userDisplayName =
        cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    }
  }

  // --- Expiring certifications ---
  // TODO: Implement server-side certification expiry count. Currently the
  // compliance section does a complex client-side fetch via entity_mentions.
  // For now, hardcode to 0 until the attention data model consumes this.
  const expiring_cert_count = 0;

  // --- Coverage gaps ---
  // TODO: Implement coverage gap count. Currently requires the
  // content-suggestions API which involves template analysis. Set to 0
  // until the attention data model integrates this source.
  const coverage_gap_count = 0;

  return {
    attention_sources: {
      governance_review_count,
      unverified_count,
      quality_flag_count,
      stale_content_count,
      expired_content_count,
      expiring_cert_count,
      expiring_content_date_count,
      unread_notification_count,
      coverage_gap_count,
    },
    active_bids,
    freshness_summary,
    reorient: {
      user_display_name: userDisplayName,
      has_display_name: !!rawDisplayName,
      last_active_relative: formatRelativeDate(lastActiveAt),
      last_active_at: lastActiveAt,
      team_changes,
      my_recent_work,
      bid_summary,
    },
    recent_activity,
    user_role: effectiveRole,
    errors,
  };
}
