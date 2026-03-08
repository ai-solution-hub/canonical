import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

/**
 * GET /api/activity
 *
 * Unified activity feed showing recent changes across the KB.
 * Admin-only. Uses the `get_grouped_activity_feed` RPC which combines
 * version history and quality events with grouping.
 *
 * Query params:
 *   - limit  (default 20, max 100)
 *   - before (ISO timestamp cursor for pagination, optional)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase, role } = auth;

    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1),
      100,
    );
    const before = url.searchParams.get('before') || undefined;

    const { data, error } = await supabase.rpc('get_grouped_activity_feed', {
      p_limit: limit,
      p_is_admin: role === 'admin',
      p_before: before,
    });

    if (error) {
      console.error('Failed to fetch activity feed:', error);
      return NextResponse.json(
        { error: 'Failed to fetch activity feed' },
        { status: 500 },
      );
    }

    // Map RPC response: latest_at -> created_at (matches ActivityItem interface)
    const activities = ((data ?? []) as Array<{
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

    return NextResponse.json({
      activities,
      limit,
      has_more: activities.length >= limit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch activity feed') },
      { status: 500 },
    );
  }
}
