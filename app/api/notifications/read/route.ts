import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { NotificationReadBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
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
      logger.error({ err: error }, 'Failed to mark notifications as read');
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
});
