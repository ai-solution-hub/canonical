/**
 * GET /api/oauth/grants
 *
 * Lists all active OAuth grants for the authenticated user.
 * Used by the Connected Apps section of the settings page.
 */
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data, error } = await supabase.auth.oauth.listGrants();

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to list OAuth grants') },
        { status: 500 },
      );
    }

    return NextResponse.json({ grants: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list OAuth grants') },
      { status: 500 },
    );
  }
}
