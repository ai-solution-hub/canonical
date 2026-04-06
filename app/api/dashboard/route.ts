import { NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  fetchUnifiedDashboardData,
  unifiedToDashboardData,
} from '@/lib/dashboard';

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
    if (!auth) return unauthorisedResponse();
    const { user, supabase } = auth;

    // Check if user is admin for activity filtering
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();
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
      console.warn(
        'Dashboard partial failure:',
        dashboard.errors.join('; '),
      );
    }

    return NextResponse.json(
      {
        ...dashboard,
        // Mirror the items/[id] PATCH warnings[] envelope so the UI has a
        // single, well-known field to render. `errors` is kept for backward
        // compatibility with existing consumers.
        warnings: dashboard.errors,
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
