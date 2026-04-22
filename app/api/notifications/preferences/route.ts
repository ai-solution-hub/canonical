import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { NotificationPreferencesPutBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 10;

/** Default preferences when no row exists for a user. */
const DEFAULT_PREFERENCES = {
  email_weekly_change_report: true,
  email_review_assigned: true,
  email_owned_content_flagged: true,
} as const;

// ---------------------------------------------------------------------------
// GET - fetch current user's notification preferences
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const { data, error } = await supabase
      .from('user_notification_prefs')
      .select(
        'email_weekly_change_report, email_review_assigned, email_owned_content_flagged, updated_at',
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Notification prefs fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load notification preferences' },
        { status: 500 },
      );
    }

    // Return stored prefs or sensible defaults (all ON)
    const preferences = data ?? { ...DEFAULT_PREFERENCES, updated_at: null };

    return NextResponse.json({ preferences });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Notification preferences failed') },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PUT - upsert notification preferences for the current user
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const body = await request.json();
    const parsed = parseBody(NotificationPreferencesPutBodySchema, body);
    if (!parsed.success) return parsed.response;

    const { data, error } = await supabase
      .from('user_notification_prefs')
      .upsert(
        {
          user_id: user.id,
          ...parsed.data,
        },
        { onConflict: 'user_id' },
      )
      .select(
        'email_weekly_change_report, email_review_assigned, email_owned_content_flagged, updated_at',
      )
      .single();

    if (error) {
      console.error('Notification prefs upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to update notification preferences' },
        { status: 500 },
      );
    }

    return NextResponse.json({ preferences: data });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Notification preferences update failed') },
      { status: 500 },
    );
  }
}
