import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  fetchUnifiedDashboardData,
  unifiedToDashboardData,
} from '@/lib/dashboard';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * GET /api/dashboard
 *
 * Aggregated dashboard data for client-side refresh.
 * Initial page render uses server-side queries directly.
 * All authenticated users can access.
 */
export async function GET() {
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
}
