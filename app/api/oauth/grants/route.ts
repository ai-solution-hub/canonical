/**
 * GET /api/oauth/grants
 *
 * Lists all active OAuth grants for the authenticated user.
 * Used by the Connected Apps section of the settings page.
 */
import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

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
