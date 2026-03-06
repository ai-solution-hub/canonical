import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

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
  recent_activity: ActivityItem[];
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

export async function fetchDashboardData(
  supabase: SupabaseClient<Database>,
  userId: string,
  isAdmin: boolean,
  role?: string,
): Promise<DashboardData> {
  const errors: string[] = [];

  const results = await Promise.allSettled([
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

    // 2: Quality flags unresolved
    supabase
      .from('ingestion_quality_log')
      .select('*', { count: 'exact', head: true })
      .eq('resolved', false),

    // 3: Freshness breakdown
    supabase.rpc('get_freshness_breakdown'),

    // 4: Active bids
    supabase
      .from('workspaces')
      .select(
        'id, name, domain_metadata, is_archived, created_at, updated_at',
      )
      .eq('type', 'bid')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false }),

    // 5: Unread notifications
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('dismissed_at', null),

    // 6: Recent activity (content_history)
    supabase
      .from('content_history')
      .select(
        'id, content_item_id, version, change_summary, change_type, created_by, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(15),

    // 7: Quality flags for admin activity feed
    isAdmin
      ? supabase
          .from('ingestion_quality_log')
          .select('id, content_item_id, flag_type, severity, created_at')
          .order('created_at', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: null, error: null }),
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

  // --- Extract quality flag count ---
  let quality_flag_count: number | null = null;
  if (results[2].status === 'fulfilled') {
    const { count, error } = results[2].value;
    if (error) {
      errors.push('quality_flag_count query failed');
    } else {
      quality_flag_count = count ?? 0;
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

  // --- Extract active bids with question stats ---
  let active_bids: ActiveBidSummary[] = [];
  if (results[4].status === 'fulfilled') {
    const { data: workspaces, error } = results[4].value;
    if (error) {
      errors.push('active_bids query failed');
    } else if (workspaces && workspaces.length > 0) {
      // Fetch question stats batch
      const bidIds = workspaces.map((p) => p.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: batchStats } = await (supabase.rpc as any)(
        'get_bid_question_stats_batch',
        { p_project_ids: bidIds },
      );

      const statsMap = new Map<string, Record<string, number>>();
      if (batchStats) {
        for (const row of batchStats) {
          statsMap.set(row.project_id, row);
        }
      }

      active_bids = workspaces.map((workspace) => {
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
    }
  } else {
    errors.push('active_bids query failed');
  }

  // --- Extract unread notification count ---
  let unread_notification_count = 0;
  if (results[5].status === 'fulfilled') {
    const { count, error } = results[5].value;
    if (error) {
      errors.push('unread_notification_count query failed');
    } else {
      unread_notification_count = count ?? 0;
    }
  } else {
    errors.push('unread_notification_count query failed');
  }

  // --- Extract recent activity ---
  let recent_activity: ActivityItem[] = [];
  if (results[6].status === 'fulfilled') {
    const { data, error } = results[6].value;
    if (error) {
      errors.push('recent_activity query failed');
    } else if (data) {
      recent_activity = data
        .filter((entry) => {
          // Non-admin: only show edit and rollback events
          if (!isAdmin && entry.change_type === 'quality_flag') return false;
          return true;
        })
        .slice(0, 10)
        .map((entry) => ({
          id: entry.id,
          type: entry.change_type === 'rollback' ? 'rollback' : 'edit',
          entity_type: 'content_item',
          entity_id: entry.content_item_id,
          summary: entry.change_summary ?? `Version ${entry.version}`,
          user_id: entry.created_by,
          created_at: entry.created_at,
        }));
    }
  } else {
    errors.push('recent_activity query failed');
  }

  // --- Merge quality flags into activity for admins (result index 7) ---
  if (isAdmin && results[7].status === 'fulfilled') {
    const r7 = results[7].value as {
      data: Array<{
        id: string;
        content_item_id: string;
        flag_type: string;
        severity: string;
        created_at: string;
      }> | null;
      error: unknown;
    };
    if (r7.data) {
      const qualityEvents: ActivityItem[] = r7.data.map((entry) => ({
        id: entry.id,
        type: 'quality_flag',
        entity_type: 'content_item',
        entity_id: entry.content_item_id,
        summary: `${entry.severity}: ${entry.flag_type.replace(/_/g, ' ')}`,
        user_id: null,
        created_at: entry.created_at,
      }));
      recent_activity = [...recent_activity, ...qualityEvents]
        .sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 10);
    }
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
