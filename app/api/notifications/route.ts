import { NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

/**
 * GET /api/notifications
 *
 * List unread/active notifications for the current user.
 * Returns notifications that have not been dismissed and are not expired,
 * ordered by most recent first.
 *
 * Response shape: { notifications: Notification[], unreadCount: number }
 *
 * The `unreadCount` is computed server-side via a separate count-only query
 * (no LIMIT) so it stays accurate even when the notification list is capped
 * at 50 items. This aligns with the dashboard's server-rendered count.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const now = new Date().toISOString();

    // Run both queries in parallel for efficiency
    const [listResult, countResult] = await Promise.all([
      // 1: Paginated notification list (read + unread, capped at 50)
      supabase
        .from('notifications')
        .select(
          'id, title, message, type, entity_type, entity_id, user_id, read_at, dismissed_at, expires_at, created_at',
        )
        .eq('user_id', user.id)
        .is('dismissed_at', null)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order('created_at', { ascending: false })
        .limit(50),

      // 2: Accurate unread count (no limit) — mirrors dashboard query in lib/dashboard.ts
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('dismissed_at', null)
        .is('read_at', null)
        .or(`expires_at.is.null,expires_at.gt.${now}`),
    ]);

    if (listResult.error) {
      console.error('Failed to fetch notifications:', listResult.error);
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 },
      );
    }

    if (countResult.error) {
      console.error('Failed to count unread notifications:', countResult.error);
      // Non-fatal: fall back to client-side count from the capped list
      const notifications = listResult.data ?? [];
      return NextResponse.json({
        notifications,
        unreadCount: notifications.filter(
          (n: { read_at: string | null }) => !n.read_at,
        ).length,
      });
    }

    return NextResponse.json({
      notifications: listResult.data ?? [],
      unreadCount: countResult.count ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch notifications') },
      { status: 500 },
    );
  }
}
