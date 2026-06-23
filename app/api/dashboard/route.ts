import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import {
  fetchUnifiedDashboardData,
  unifiedToDashboardData,
} from '@/lib/dashboard';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// GroupedActivityItem (extends ActivityItem) from @/lib/dashboard.
const DashboardGroupedActivityItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  summary: z.string(),
  user_id: z.string().nullable(),
  created_at: z.string().nullable(),
  latest_at: z.string().nullable(),
  earliest_at: z.string().nullable(),
  event_count: z.number(),
});

// ActiveProcurementSummary from @/lib/dashboard.
const DashboardActiveBidSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  buyer: z.string().nullable(),
  status: z.string(),
  deadline: z.string().nullable(),
  days_until_deadline: z.number().nullable(),
  total_questions: z.number(),
  answered_questions: z.number(),
  approved_questions: z.number(),
});

// DashboardData (@/lib/dashboard) spread + warnings[] envelope. Count fields
// mirror the DashboardData interface's declared `number | null`.
const DashboardResponseSchema = z.object({
  needs_attention: z.object({
    governance_review_count: z.number().nullable(),
    unverified_count: z.number().nullable(),
    quality_flag_count: z.number().nullable(),
    stale_content_count: z.number().nullable(),
    expired_content_count: z.number().nullable(),
  }),
  active_bids: z.array(DashboardActiveBidSummarySchema),
  freshness_summary: z.object({
    fresh: z.number(),
    aging: z.number(),
    stale: z.number(),
    expired: z.number(),
  }),
  unread_notification_count: z.number(),
  recent_activity: z.array(DashboardGroupedActivityItemSchema),
  user_role: z.string(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const GET = defineRoute(DashboardResponseSchema, async () => {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Check if user is admin for activity filtering
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    // PGRST116 (no rows) is not an error here — it just means the user has
    // no explicit role and should default to viewer. Any other DB error must
    // surface as a warning so an admin who hits a transient DB glitch is not
    // silently downgraded to the viewer dashboard.
    const roleWarnings: string[] = [];
    if (roleError && roleError.code !== 'PGRST116') {
      logger.error(
        { err: roleError },
        'Failed to look up user role for dashboard',
      );
      roleWarnings.push(
        'Could not verify your role; some sections may be hidden until you reload.',
      );
    }
    const isAdmin = roleData?.role === 'admin';

    const role = roleData?.role ?? 'viewer';
    const unified = await fetchUnifiedDashboardData(
      supabase,
      user.id,
      isAdmin,
      role,
    );
    const dashboard = unifiedToDashboardData(unified);

    // If ALL queries failed, return 500
    if (dashboard.errors.length >= 7) {
      return NextResponse.json(
        { error: 'Dashboard data unavailable' },
        { status: 500 },
      );
    }

    // Surface partial failures to the client and to server logs so a single
    // failing query (e.g. my_recent_work) does not silently render as an
    // empty section. The UI is expected to render `warnings[]` as a banner.
    if (dashboard.errors.length > 0) {
      logger.warn(
        { err: dashboard.errors.join('; ') },
        'Dashboard partial failure',
      );
    }

    return NextResponse.json(
      {
        ...dashboard,
        // Mirror the items/[id] PATCH warnings[] envelope so the UI has a
        // single, well-known field to render. `errors` is kept for backward
        // compatibility with existing consumers.
        warnings: [...roleWarnings, ...dashboard.errors],
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=30',
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch dashboard data') },
      { status: 500 },
    );
  }
});
