/**
 * POST /api/oauth/revoke
 *
 * Revokes an OAuth grant for the authenticated user.
 * Invalidates the client's sessions and refresh tokens immediately.
 */
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/validation';
import { safeErrorMessage } from '@/lib/error';

const RevokeSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
});

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = parseBody(RevokeSchema, body);
    if (!parsed.success) return parsed.response;

    const { error } = await supabase.auth.oauth.revokeGrant({
      clientId: parsed.data.clientId,
    });

    if (error) {
      return NextResponse.json({ error: safeErrorMessage(error, 'Failed to revoke OAuth grant') }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to revoke OAuth grant') },
      { status: 500 },
    );
  }
}
