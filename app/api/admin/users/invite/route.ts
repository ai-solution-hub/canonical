import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { UserInviteBodySchema } from '@/lib/validation/schemas';

/** POST /api/admin/users/invite — invite a new user by email (admin only) */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
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
      console.error('Failed to invite user:', inviteError);
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
    const { error: roleError } = await serviceClient
      .from('user_roles')
      .insert({
        user_id: inviteData.user.id,
        role,
      });

    if (roleError) {
      console.error('Failed to set user role:', roleError);
      // The user was created but role assignment failed — log but don't fail
      // The user will default to 'viewer' via the application fallback
    }

    return NextResponse.json(
      {
        id: inviteData.user.id,
        email: inviteData.user.email,
        role,
        display_name: display_name ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to invite user') },
      { status: 500 },
    );
  }
}
