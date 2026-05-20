import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { TeamChange, RecentWorkItem, ProcurementBriefing } from '@/types/reorient';
import { fetchActiveProcurementWithStats } from '@/lib/procurement/procurement-queries';
import { formatRelativeDate } from '@/lib/format';
import { getUserDisplayName } from '@/lib/user/display-name';

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

export type DeadlineUrgency =
  | 'overdue'
  | 'urgent'
  | 'approaching'
  | 'normal'
  | 'unknown';

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
  return Math.ceil(
    (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
}

// ---------------------------------------------------------------------------
// Legacy adapter — maps UnifiedDashboardData back to DashboardData shape
// for backward-compatible API responses and formatters.
// ---------------------------------------------------------------------------

export function unifiedToDashboardData(
  unified: UnifiedDashboardData,
): DashboardData {
  const src = unified.attention_sources;
  return {
    needs_attention: {
      governance_review_count: src.governance_review_count,
      unverified_count: src.unverified_count,
      quality_flag_count: src.quality_flag_count,
      stale_content_count: src.stale_content_count,
      expired_content_count: src.expired_content_count,
    },
    active_bids: unified.active_bids,
    freshness_summary: unified.freshness_summary,
    unread_notification_count: src.unread_notification_count,
    recent_activity: unified.recent_activity,
    user_role: unified.user_role,
    errors: unified.errors,
  };
}

// ---------------------------------------------------------------------------
// Unified Dashboard Data
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

  /** Active procurements with stats */
  active_bids: ActiveBidSummary[];

  /** Freshness summary for QuickStatsStrip */
  freshness_summary: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };

  /** Reorient data — personal context only */
  reorient: {
    user_display_name: string | null;
    has_display_name: boolean;
    last_active_relative: string;
    last_active_at: string | null;
    team_changes: TeamChange[];
    my_recent_work: RecentWorkItem[];
    bid_summary: ProcurementBriefing[];
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
// Unified fetch — all dashboard + reorient queries in a single pass.
// Each query runs exactly ONCE.
// ---------------------------------------------------------------------------

/**
 * Fetch all dashboard data in a single pass. Returns attention source counts,
 * active procurements, freshness summary, reorient personal context, recent activity,
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

  // --- Phase 1: User's last activity + cert relationships (needed to scope later queries) ---
  const [lastWriteResult, lastReadResult, certRelResult] = await Promise.all([
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
    // Fetch certification relationship targets for expiry count
    supabase
      .from('entity_relationships')
      .select('target_entity')
      .eq('relationship_type', 'holds'),
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    authUser = user;
  } catch {
    // Non-critical — will fall back to defaults
  }

  let lastActiveAt: string | null = null;
  if (lastWriteAt && lastReadAt) {
    lastActiveAt =
      new Date(lastWriteAt) >= new Date(lastReadAt) ? lastWriteAt : lastReadAt;
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
  // Attention counts (queries 0,1,2,3,4,10,12,13) consolidated into single RPC.
  // Remaining queries: activity feed, team changes, recent work, bid history, cert expiry.
  const [results, activeBidsResult] = await Promise.all([
    Promise.allSettled([
      // 0: Attention counts (replaces queries 0,1,2,3,4,10,12,13)
      // Note: quality_flag_count here filters archived_at IS NULL, which differs
      // from get_review_breakdown_stats (no archived filter). This is intentional —
      // see migration comment in 20260328234541_review_stats_rpc_functions.sql.
      supabase.rpc('get_dashboard_attention_counts', {
        p_user_id: userId,
        p_role: effectiveRole,
      }),

      // 1: Recent activity (grouped RPC — unchanged)
      supabase.rpc('get_grouped_activity_feed', {
        p_limit: 10,
        p_is_admin: isAdmin,
      }),

      // 2: Team changes — content_history since last active (others' work)
      supabase
        .from('content_history')
        .select(
          'id, content_item_id, change_type, change_summary, created_by, created_at, content_items!inner(title, primary_domain)',
        )
        .gt('created_at', sinceDate)
        .neq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      // 3: User's own recent work — content_history
      supabase
        .from('content_history')
        .select(
          'id, content_item_id, change_type, change_summary, created_at, content_items!inner(title)',
        )
        .eq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // 4: Procurement response changes by others (team changes)
      supabase
        .from('bid_response_history')
        .select(
          'id, response_id, edited_by, created_at, bid_responses!inner(question_id, bid_questions!inner(workspace_id, workspaces!inner(name)))',
        )
        .gt('created_at', sinceDate)
        .neq('edited_by', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      // 5: User's own bid response edits (recent work)
      supabase
        .from('bid_response_history')
        .select(
          'id, response_id, edited_by, created_at, bid_responses!inner(question_id, bid_questions!inner(workspace_id, question_text, workspaces!inner(id, name)))',
        )
        .eq('edited_by', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // 6: Certification expiry — entity_mentions with certification metadata
      // containing expiry_date within 90 days. Uses certRelResult from Phase 1.
      certRelResult.data && certRelResult.data.length > 0
        ? supabase
            .from('entity_mentions')
            .select('canonical_name, metadata')
            .in(
              'canonical_name',
              certRelResult.data.map((r) => r.target_entity),
            )
            .or(
              'entity_type.eq.certification,entity_type_override.eq.certification',
            )
        : Promise.resolve({ data: [], error: null }),
    ]),
    fetchActiveProcurementWithStats(supabase),
  ]);

  // --- Extract attention counts from RPC (query 0) ---
  let governance_review_count = 0;
  let unverified_count = 0;
  let quality_flag_count = 0;
  const freshness_summary = { fresh: 0, aging: 0, stale: 0, expired: 0 };
  let stale_content_count = 0;
  let expired_content_count = 0;
  let unread_notification_count = 0;
  let expiring_content_date_count = 0;
  let coverage_gap_count = 0;

  if (results[0].status === 'fulfilled') {
    const { data, error } = results[0].value;
    if (error) {
      errors.push('attention_counts RPC failed');
    } else if (data) {
      const counts = data as {
        governance_review_count: number;
        unverified_count: number;
        quality_flag_count: number;
        stale_content_count: number;
        expired_content_count: number;
        expiring_content_date_count: number;
        unread_notification_count: number;
        coverage_gap_count: number;
        freshness_summary: {
          fresh: number;
          aging: number;
          stale: number;
          expired: number;
        };
      };
      governance_review_count = counts.governance_review_count ?? 0;
      unverified_count = counts.unverified_count ?? 0;
      quality_flag_count = counts.quality_flag_count ?? 0;
      stale_content_count = counts.stale_content_count ?? 0;
      expired_content_count = counts.expired_content_count ?? 0;
      expiring_content_date_count = counts.expiring_content_date_count ?? 0;
      unread_notification_count = counts.unread_notification_count ?? 0;
      coverage_gap_count = counts.coverage_gap_count ?? 0;
      if (counts.freshness_summary) {
        freshness_summary.fresh = counts.freshness_summary.fresh ?? 0;
        freshness_summary.aging = counts.freshness_summary.aging ?? 0;
        freshness_summary.stale = counts.freshness_summary.stale ?? 0;
        freshness_summary.expired = counts.freshness_summary.expired ?? 0;
      }
    }
  } else {
    errors.push('attention_counts RPC failed');
  }

  // --- Extract recent activity (query 1) ---
  let recent_activity: GroupedActivityItem[] = [];
  if (results[1].status === 'fulfilled') {
    const { data, error } = results[1].value;
    if (error) {
      errors.push('recent_activity query failed');
    } else if (data) {
      recent_activity = (
        data as Array<{
          id: string;
          type: string;
          entity_type: string;
          entity_id: string;
          summary: string;
          user_id: string | null;
          latest_at: string | null;
          earliest_at: string | null;
          event_count: number;
        }>
      ).map((row) => ({
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

  // --- Extract team changes — content_history (query 2) ---
  const team_changes: TeamChange[] = [];
  if (results[2].status === 'fulfilled') {
    const { data, error } = results[2].value;
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
          user_name: null,
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

  // --- Extract user's recent work — content_history (query 3) ---
  const my_recent_work: RecentWorkItem[] = [];
  if (results[3].status === 'fulfilled') {
    const { data, error } = results[3].value;
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

  // --- Extract bid response team changes (query 4) ---
  if (results[4].status === 'fulfilled') {
    const { data, error } = results[4].value;
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

  // --- Extract user's own bid response edits (query 5) ---
  if (results[5].status === 'fulfilled') {
    const { data, error } = results[5].value;
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
  // legitimate (publication-state transitions, edits, imports), but the
  // dashboard "pick up where you left off" surface should show the latest
  // entity once rather than render duplicate React keys for the same UUID.
  my_recent_work.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const latestRecentWork = dedupeRecentWorkByEntity(my_recent_work).slice(0, 5);

  // --- Build active procurements (from shared helper — single query) ---
  const { workspaces: procurementWorkspaces, statsMap } = activeBidsResult;
  const active_bids: ActiveBidSummary[] = procurementWorkspaces.map((workspace) => {
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const stats = statsMap.get(workspace.id);
    const deadline = (meta?.deadline as string) ?? null;

    return {
      id: workspace.id,
      name: workspace.name ?? 'Untitled Procurement',
      buyer: (meta?.buyer as string) ?? null,
      status: (meta?.status as string) ?? 'draft',
      deadline,
      days_until_deadline: getDaysUntilDeadline(deadline),
      total_questions: stats?.total_questions ?? 0,
      answered_questions:
        (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0),
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
  const bid_summary: ProcurementBriefing[] = procurementWorkspaces.map((workspace) => {
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const stats = statsMap.get(workspace.id);
    const deadline = (meta?.deadline as string) ?? null;
    const urgency = getDeadlineUrgency(deadline);
    const totalQ = stats?.total_questions ?? 0;
    const answeredQ =
      (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);

    return {
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
    };
  });

  // Sort bid_summary by deadline urgency
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

  // --- Resolve user display name ---
  const { display_name: userDisplayName, has_display_name: hasDisplayName } =
    getUserDisplayName(authUser);

  // --- Extract expiring certification count (query 6) ---
  let expiring_cert_count = 0;
  if (results[6].status === 'fulfilled') {
    const { data, error } = results[6].value;
    if (error) {
      errors.push('expiring_cert_count query failed');
    } else if (data) {
      const now = new Date();
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      // Deduplicate by canonical_name and count those with expiry within 90 days
      const seen = new Set<string>();
      for (const row of data as {
        canonical_name: string;
        metadata: Record<string, unknown> | null;
      }[]) {
        if (seen.has(row.canonical_name)) continue;
        seen.add(row.canonical_name);
        const expiryDate = (row.metadata as Record<string, unknown> | null)
          ?.expiry_date as string | undefined;
        if (expiryDate) {
          const expiry = new Date(expiryDate);
          const diffMs = expiry.getTime() - now.getTime();
          // Count if expired or expiring within 90 days
          if (diffMs <= ninetyDaysMs) {
            expiring_cert_count++;
          }
        }
      }
    }
  } else {
    errors.push('expiring_cert_count query failed');
  }

  // Coverage gap count is now included in the attention counts RPC (query 0)

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
      has_display_name: hasDisplayName,
      last_active_relative: formatRelativeDate(lastActiveAt),
      last_active_at: lastActiveAt,
      team_changes,
      my_recent_work: latestRecentWork,
      bid_summary,
    },
    recent_activity,
    user_role: effectiveRole,
    errors,
  };
}
