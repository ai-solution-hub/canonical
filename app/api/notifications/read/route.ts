import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { NotificationReadBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * POST /api/notifications/read
 *
 * Mark one or more notifications as read.
 * Only the notification owner can mark their notifications.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(NotificationReadBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { notification_ids } = parsed.data;

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .in('id', notification_ids)
      .is('read_at', null);

    if (error) {
      console.error('Failed to mark notifications as read:', error);
      return NextResponse.json(
        { error: 'Failed to mark notifications as read' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, count: notification_ids.length });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to mark notifications as read') },
      { status: 500 },
    );
  }
}
