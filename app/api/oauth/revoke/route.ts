/**
 * POST /api/oauth/revoke
 *
 * Revokes an OAuth grant for the authenticated user.
 * Invalidates the client's sessions and refresh tokens immediately.
 */
import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { parseBody } from '@/lib/validation';
import { RevokeSchema } from '@/lib/validation/schemas';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const body = await request.json().catch(() => null);
    const parsed = parseBody(RevokeSchema, body);
    if (!parsed.success) return parsed.response;

    const { error } = await supabase.auth.oauth.revokeGrant({
      clientId: parsed.data.clientId,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to revoke OAuth grant') },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to revoke OAuth grant') },
      { status: 500 },
    );
  }
}
