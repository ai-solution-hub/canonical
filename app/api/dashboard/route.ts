import { NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { fetchDashboardData } from '@/lib/dashboard';

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

    const dashboard = await fetchDashboardData(supabase, user.id, isAdmin);

    // If ALL queries failed, return 500
    if (dashboard.errors.length >= 7) {
      return NextResponse.json(
        { error: 'Dashboard data unavailable' },
        { status: 500 },
      );
    }

    return NextResponse.json(dashboard, {
      headers: {
        'Cache-Control': 'private, max-age=30',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch dashboard data') },
      { status: 500 },
    );
  }
}
