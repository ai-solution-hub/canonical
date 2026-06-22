/**
 * POST /api/oauth/revoke
 *
 * Revokes an OAuth grant for the authenticated user.
 * Invalidates the client's sessions and refresh tokens immediately.
 */
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { RevokeSchema } from '@/lib/validation/schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: Request) => {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const body = await request.json().catch((_err) => null);
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
});
