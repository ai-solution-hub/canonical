import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { NotificationsResponseSchema } from '@/lib/validation/schemas';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export const GET = defineRoute(NotificationsResponseSchema, async () => {
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
      logger.error({ err: listResult.error }, 'Failed to fetch notifications');
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 },
      );
    }

    if (countResult.error) {
      logger.error(
        { err: countResult.error },
        'Failed to count unread notifications',
      );
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
});
