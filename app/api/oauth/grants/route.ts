/**
 * GET /api/oauth/grants
 *
 * Lists all active OAuth grants for the authenticated user.
 * Used by the Connected Apps section of the settings page.
 */
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// `grants`: external Supabase OAuth SDK shape (auth.oauth.listGrants()) — opaque element.
const GrantsResponseSchema = z.object({ grants: z.array(z.unknown()) });
export const GET = defineRoute(GrantsResponseSchema, async () => {
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
});
