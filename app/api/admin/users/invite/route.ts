import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/server';
import { parseBody } from '@/lib/validation';
import { UserInviteBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = parseBody(UserInviteBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { email, role, display_name } = parsed.data;

    const serviceClient = createServiceClient();

    // Invite the user via Supabase Auth
    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: {
          display_name: display_name ?? null,
          invited_by: auth.user.id,
        },
      });

    if (inviteError) {
      logger.error({ err: inviteError }, 'Failed to invite user');
      // Check for duplicate user
      if (inviteError.message?.includes('already been registered')) {
        return NextResponse.json(
          { error: 'A user with this email address already exists' },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to invite user' },
        { status: 500 },
      );
    }

    if (!inviteData.user) {
      return NextResponse.json(
        { error: 'Invitation was sent but no user was created' },
        { status: 500 },
      );
    }

    // Pre-create the user_roles entry (Option B from spec)
    const { error: roleError } = await serviceClient.from('user_roles').insert({
      user_id: inviteData.user.id,
      role,
    });

    // If role assignment fails after a successful invite we cannot transparently
    // roll back the Supabase Auth user, so surface the partial state to the
    // admin: the user was invited but their role defaulted to 'viewer' and
    // must be corrected manually. Returning a warnings envelope (rather than
    // failing the whole request) mirrors the pattern used by
    // `app/api/items/[id]/route.ts` for best-effort writes.
    const warnings: string[] = [];
    if (roleError) {
      logger.error({ err: roleError }, 'Failed to set user role');
      warnings.push(
        `User invited but role assignment failed — user will default to 'viewer' on first sign-in. Update the role manually. (${roleError.message})`,
      );
    }

    return NextResponse.json(
      {
        id: inviteData.user.id,
        email: inviteData.user.email,
        role: roleError ? 'viewer' : role,
        display_name: display_name ?? null,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to invite user') },
      { status: 500 },
    );
  }
});
