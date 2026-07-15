import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type {
  TeamChange,
  RecentWorkItem,
  ProcurementBriefing,
} from '@/types/reorient';
import { fetchActiveProcurementWithStats } from '@/lib/domains/procurement/procurement-queries';
import { formatRelativeDate } from '@/lib/format';
import { getUserDisplayName } from '@/lib/users/self-display-name';
import { UNCLASSIFIED_TAXONOMY_OR_PREDICATE } from '@/lib/validation/schemas';
import { dedupeRecentWorkByEntity } from '@/lib/activity/recent-work';
import {
  formResponseRowToTeamChange,
  formResponseRowToRecentWork,
} from '@/lib/activity/team-changes';
import { buildProcurementSummary } from '@/lib/activity/bid-summary';
import { parseJsonb, FreshnessSummarySchema } from '@/lib/validation/jsonb';
import { tryQuery } from '@/lib/supabase/safe';
import {
  isActive,
  type ProcurementWorkflowState,
} from '@/lib/domains/procurement/procurement-workflow';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

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
  active_forms: ActiveProcurementSummary[];
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

export interface ActiveProcurementSummary {
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

/** Raw row shape returned by the `get_grouped_activity_feed` RPC. */
export interface GroupedActivityRow {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  user_id: string | null;
  latest_at: string | null;
  earliest_at: string | null;
  event_count: number;
}

/**
 * Project a `get_grouped_activity_feed` RPC row into the client
 * `GroupedActivityItem` shape (collapsing `latest_at` -> `created_at`).
 *
 * Canonical mapper shared by the unified dashboard aggregator and
 * `GET /api/activity` — both previously inlined this identical projection.
 */
export function mapGroupedActivityRow(
  row: GroupedActivityRow,
): GroupedActivityItem {
  return {
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
  };
}

/** Map a raw `get_grouped_activity_feed` payload into `GroupedActivityItem[]`. */
export function mapGroupedActivityRows(data: unknown): GroupedActivityItem[] {
  return ((data ?? []) as GroupedActivityRow[]).map(mapGroupedActivityRow);
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
    active_forms: unified.active_forms,
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
    // coverage_gap_count RETIRED (ID-131.19 S450 Wave 1 Fix 1, DR-034) —
    // content_items-era coverage feature has no home post content_items
    // retirement; see the migration comment in
    // supabase/migrations/20260706103000_id131_attention_counts_rewrite.sql.
    /**
     * Count of non-archived content_items on the taxonomy 'unclassified'
     * sentinel (primary_domain='unclassified' OR primary_subtopic=
     * 'unclassified'), per ID-63 {63.11}. Drives the dashboard
     * taxonomy-coverage actionable-insight (ID-63.12).
     */
    unclassified_count: number;
  };

  /** Active procurements with stats */
  active_forms: ActiveProcurementSummary[];

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
    forms_summary: ProcurementBriefing[];
  };

  /** Recent activity feed */
  recent_activity: GroupedActivityItem[];

  /** User role */
  user_role: string;

  /** Partial failure tracking */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Active procurements — form_instances read (ID-145 {145.20} BI-30)
// ---------------------------------------------------------------------------

/** Columns read off `form_instances` for the dashboard active-items list (BI-30). */
const ACTIVE_FORM_INSTANCE_COLUMNS =
  'id, name, issuing_organisation, deadline, workflow_state';

/**
 * Fetch the dashboard's active-procurement list DIRECTLY off `form_instances`
 * (ID-145 {145.20} BI-30) — the item IS the form post-form-first
 * re-architecture, so this reads `workflow_state`/`deadline`/
 * `issuing_organisation` straight off the form row. "Active" = non-terminal
 * `workflow_state` (`isActive()` excludes won/lost/withdrawn — the single
 * source is `PROCUREMENT_WORKFLOW_STATES`, BI-18); there is no
 * `is_archived` concept on `form_instances`. Mirrors the form-scoped read
 * already landed in `lib/mcp/tools/procurement.ts`'s `list_active_procurement`
 * tool (ID-145 {145.21} DR-056 re-key) — that tool could not go through
 * `fetchActiveProcurementWithStats` for the same reason this function exists
 * independently of it: that helper stays workspace/`domain_metadata`-shaped
 * for its other caller, `lib/reorient.ts`'s `forms_summary` (out of this
 * Subtask's scope).
 *
 * On failure, logs and degrades to an empty list WITHOUT pushing onto the
 * shared `fetchUnifiedDashboardData` `errors[]` array — `GET
 * /api/dashboard` (app/api/dashboard/route.ts, outside this Subtask's file
 * ownership) treats `errors.length >= 7` as an "every query failed"
 * all-down signal; adding an 8th distinct failure string would silently
 * shift that threshold's meaning. This mirrors the pre-existing silent-empty
 * behaviour of `fetchActiveProcurementWithStats` for the same data lane, but
 * adds actual logging (an improvement, not a regression).
 */
async function fetchActiveFormInstanceSummaries(
  supabase: SupabaseClient<Database>,
): Promise<ActiveProcurementSummary[]> {
  const formsResult = await tryQuery(
    supabase
      .from('form_instances')
      .select(ACTIVE_FORM_INSTANCE_COLUMNS)
      .order('updated_at', { ascending: false }),
    'dashboard.active_form_instances',
  );

  if (!formsResult.ok) {
    logBestEffortWarn(
      'dashboard.active_forms.fetch',
      'dashboard: active_form_instances query failed — degrading to empty active_forms',
      { err: formsResult.error },
    );
    return [];
  }

  const activeForms = (formsResult.data ?? []).filter((form) =>
    isActive((form.workflow_state as ProcurementWorkflowState) ?? 'draft'),
  );

  const formIds = activeForms.map((form) => form.id);
  const statsMap = new Map<
    string,
    {
      total_questions: number;
      drafted_count: number;
      complete_count: number;
    }
  >();
  if (formIds.length > 0) {
    const batchStats = await tryQuery(
      supabase.rpc('get_form_question_stats_batch', {
        p_project_ids: formIds,
      }),
      'dashboard.active_form_instances.question_stats',
    );
    if (batchStats.ok) {
      for (const row of batchStats.data ?? []) {
        statsMap.set(row.workspace_id, row);
      }
    } else {
      logBestEffortWarn(
        'dashboard.active_forms.stats_batch',
        'dashboard: active_form_instances question-stats batch failed — stats default to zero',
        { err: batchStats.error },
      );
    }
  }

  return activeForms.map((form) => {
    const stats = statsMap.get(form.id);
    const deadline = form.deadline ?? null;

    return {
      id: form.id,
      name: form.name ?? 'Untitled Procurement',
      buyer: form.issuing_organisation ?? null,
      status: form.workflow_state ?? 'draft',
      deadline,
      days_until_deadline: getDaysUntilDeadline(deadline),
      total_questions: stats?.total_questions ?? 0,
      answered_questions:
        (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0),
      approved_questions: stats?.complete_count ?? 0,
    };
  });
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

  // --- Phase 1: Cert relationships (needed to scope later queries) ---
  // ID-131.19 S450 Wave 1 Fix 4: the content_history "last write" leg was
  // RETIRED in the prior commit (content_history drops at M6; no
  // cross-entity-type write-timestamp equivalent exists — see the
  // team_changes/my_recent_work retirement note at Phase 2 below for the
  // full audit). This follow-up (Checker finding, spec-compliance) RETIRES
  // the read_marks "last read" leg too — read_marks ALSO drops at M6
  // (migrations/20260706110000_id131_drops.sql), it is a
  // reading-progress (content_items-era) signal with no new-model
  // equivalent, and its only other live reader (hooks/use-progress.ts) was
  // itself an orphan (0 production callers) and has been deleted alongside.
  // last_active_at now derives from last_sign_in_at / the 24h fallback only.
  const certRelQuery = await tryQuery(
    supabase
      .from('entity_relationships')
      .select('target_entity')
      .eq('relationship_type', 'holds'),
    'dashboard.cert_relationships',
  );
  if (!certRelQuery.ok) {
    errors.push('cert_relationships query failed');
  }
  const certRelData = certRelQuery.ok ? certRelQuery.data : null;

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
  if (authUser?.last_sign_in_at) {
    lastActiveAt = authUser.last_sign_in_at;
  }

  const sinceDate = lastActiveAt
    ? lastActiveAt
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // --- Phase 2: All queries in parallel (each runs exactly ONCE) ---
  // Attention counts (queries 0,1,2,3,4,10,12,13) consolidated into single RPC.
  // Remaining queries: activity feed, team changes, recent work, bid history, cert expiry.
  const [results, activeProcurementsResult, activeFormInstances] =
    await Promise.all([
      Promise.allSettled([
        // 0: Attention counts (replaces queries 0,1,2,3,4,10,12,13)
        // Note: quality_flag_count here filters archived_at IS NULL, which differs
        // from get_review_breakdown_stats (no archived filter). This is intentional —
        // see migration comment in 20260328234541_review_stats_rpc_functions.sql.
        supabase.rpc('get_dashboard_attention_counts', {
          p_user_id: userId,
          p_role: effectiveRole,
        }),

        // 1: Recent activity. ID-131 {131.19}: get_grouped_activity_feed drops
        // at M6 (IMS activity-feed feature, content_items-anchored) — the RPC
        // call is removed and this leg is stubbed to an always-empty result so
        // the module keeps compiling with the same `{data, error}` shape the
        // extraction below expects. `recent_activity` is therefore always `[]`
        // until a facet/typed-record-based activity feed replaces it (flagged
        // for the Orchestrator/Curator — out of this Subtask's scope).
        Promise.resolve({
          data: [] as GroupedActivityRow[],
          error: null as { message: string } | null,
        }),

        // 2: Procurement response changes by others (team changes)
        supabase
          .from('form_response_history')
          .select(
            'id, response_id, edited_by, created_at, form_responses!inner(question_id, form_questions!inner(workspace_id, workspaces!inner(name)))',
          )
          .gt('created_at', sinceDate)
          .neq('edited_by', userId)
          .order('created_at', { ascending: false })
          .limit(20),

        // 3: User's own bid response edits (recent work)
        supabase
          .from('form_response_history')
          .select(
            'id, response_id, edited_by, created_at, form_responses!inner(question_id, form_questions!inner(workspace_id, question_text, workspaces!inner(id, name)))',
          )
          .eq('edited_by', userId)
          .order('created_at', { ascending: false })
          .limit(5),

        // 4: Certification expiry — entity_mentions with certification metadata
        // containing expiry_date within 90 days. Uses certRelData from Phase 1.
        certRelData && certRelData.length > 0
          ? supabase
              .from('entity_mentions')
              .select('canonical_name, metadata')
              .in(
                'canonical_name',
                certRelData.map((r) => r.target_entity),
              )
              .or(
                'entity_type.eq.certification,entity_type_override.eq.certification',
              )
          : Promise.resolve({ data: [], error: null }),

        // 5: Taxonomy-coverage gap (ID-63.12) — count of non-archived
        // source_documents that landed on the 'unclassified' sentinel
        // established by {63.11} (primary_domain='unclassified' OR
        // primary_subtopic='unclassified'). ID-131 {131.19}: content_items is
        // dying — primary_domain/primary_subtopic/archived_at live on
        // source_documents (M3). head:true + count:'exact' avoids transferring
        // rows. Mirrors the Inv-7 taxonomy-miss concept that the {63.8}
        // flow-end webhook emits as its taxonomy-miss counter.
        supabase
          .from('source_documents')
          .select('id', { count: 'exact', head: true })
          .is('archived_at', null)
          .or(UNCLASSIFIED_TAXONOMY_OR_PREDICATE),
      ]),
      // Kept UNCHANGED — still workspace/`domain_metadata`-shaped — for the
      // `forms_summary` reorient derivation below (out of {145.20}'s
      // BI-30..33 scope; see fetchActiveFormInstanceSummaries's doc comment).
      fetchActiveProcurementWithStats(supabase),
      // ID-145 {145.20} BI-30: the dashboard's own active-items list reads
      // form_instances directly.
      fetchActiveFormInstanceSummaries(supabase),
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

  if (results[0].status === 'fulfilled') {
    const { data, error } = results[0].value;
    if (error) {
      errors.push('attention_counts RPC failed');
    } else if (data && data[0]) {
      // ID-70: get_dashboard_attention_counts now returns a single typed row
      // (RETURNS TABLE) — 7 scalar columns + a freshness_summary jsonb column
      // validated at this boundary via parseJsonb (matches get_filter_counts).
      // ID-131.19 S450 Wave 1 Fix 1: coverage_gap_count RETIRED (DR-034) —
      // no longer part of the RETURNS TABLE shape, nothing to read here.
      const counts = data[0];
      governance_review_count = counts.governance_review_count ?? 0;
      unverified_count = counts.unverified_count ?? 0;
      quality_flag_count = counts.quality_flag_count ?? 0;
      stale_content_count = counts.stale_content_count ?? 0;
      expired_content_count = counts.expired_content_count ?? 0;
      expiring_content_date_count = counts.expiring_content_date_count ?? 0;
      unread_notification_count = counts.unread_notification_count ?? 0;
      const fs = parseJsonb(FreshnessSummarySchema, counts.freshness_summary);
      if (fs) {
        freshness_summary.fresh = fs.fresh;
        freshness_summary.aging = fs.aging;
        freshness_summary.stale = fs.stale;
        freshness_summary.expired = fs.expired;
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
      recent_activity = mapGroupedActivityRows(data);
    }
  } else {
    errors.push('recent_activity query failed');
  }

  // team_changes / my_recent_work are sourced solely from the
  // form_response_history legs (queries 2 + 3) — the content_history legs
  // were retired outright above (ID-131.19 S450 Wave 1 Fix 4).
  const team_changes: TeamChange[] = [];
  const my_recent_work: RecentWorkItem[] = [];

  // --- Extract bid response team changes (query 2) ---
  if (results[2].status === 'fulfilled') {
    const { data, error } = results[2].value;
    if (error) {
      errors.push('bid_response team_changes query failed');
    } else if (data) {
      for (const row of data) {
        team_changes.push(formResponseRowToTeamChange(row));
      }
    }
  } else {
    errors.push('bid_response team_changes query failed');
  }

  // Sort team changes by date. Sourced solely from form_response_history now
  // (the content_history leg is retired, ID-131.19 S450 Wave 1 Fix 4) — the
  // DB query already orders descending, but this stays as a defensive
  // re-sort in case that ever changes.
  team_changes.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // --- Extract user's own bid response edits (query 3) ---
  if (results[3].status === 'fulfilled') {
    const { data, error } = results[3].value;
    if (error) {
      errors.push('bid_response my_recent_work query failed');
    } else if (data) {
      for (const row of data) {
        my_recent_work.push(formResponseRowToRecentWork(row));
      }
    }
  } else {
    errors.push('bid_response my_recent_work query failed');
  }

  // Sort recent work by date, collapse repeated rows for the same entity,
  // and limit to 5. Sourced solely from form_response_history now (the
  // content_history leg is retired, ID-131.19 S450 Wave 1 Fix 4) — a bid
  // response can still be edited multiple times, so the dedup-by-entity
  // step still matters: the "pick up where you left off" surface should
  // show the latest entity once rather than render duplicate React keys.
  my_recent_work.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const latestRecentWork = dedupeRecentWorkByEntity(my_recent_work).slice(0, 5);

  // --- Build active procurements — ID-145 {145.20} BI-30 ---
  // Sourced directly from `activeFormInstances` (form_instances,
  // non-terminal workflow_state) — NOT from the shared
  // `fetchActiveProcurementWithStats` workspace/`domain_metadata` helper.
  // `procurementWorkspaces`/`statsMap` below are kept ONLY for the
  // `forms_summary` reorient derivation, which stays on the pre-{145.20}
  // shape (out of this Subtask's scope).
  const { workspaces: procurementWorkspaces, statsMap } =
    activeProcurementsResult;
  const active_forms: ActiveProcurementSummary[] = [...activeFormInstances];

  // Sort by deadline urgency (most urgent first)
  active_forms.sort((a, b) => {
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

  // --- Build forms_summary for reorient (from the same bid data) ---
  const forms_summary = buildProcurementSummary(
    procurementWorkspaces,
    statsMap,
  );

  // --- Resolve user display name ---
  const { display_name: userDisplayName, has_display_name: hasDisplayName } =
    getUserDisplayName(authUser);

  // --- Extract expiring certification count (query 4) ---
  let expiring_cert_count = 0;
  if (results[4].status === 'fulfilled') {
    const { data, error } = results[4].value;
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

  // --- Extract taxonomy-coverage gap count (query 5) — ID-63.12 ---
  let unclassified_count = 0;
  if (results[5].status === 'fulfilled') {
    const { count, error } = results[5].value;
    if (error) {
      errors.push('unclassified_count query failed');
    } else {
      unclassified_count = count ?? 0;
    }
  } else {
    errors.push('unclassified_count query failed');
  }

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
      unclassified_count,
    },
    active_forms,
    freshness_summary,
    reorient: {
      user_display_name: userDisplayName,
      has_display_name: hasDisplayName,
      last_active_relative: formatRelativeDate(lastActiveAt),
      last_active_at: lastActiveAt,
      team_changes,
      my_recent_work: latestRecentWork,
      forms_summary,
    },
    recent_activity,
    user_role: effectiveRole,
    errors,
  };
}
