import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { UserRoleUpdateBodySchema } from '@/lib/validation/schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/admin/users/[userId] — update a user's role (admin only) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    const { userId } = await params;
    if (!UUID_RE.test(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parsed = parseBody(UserRoleUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { role } = parsed.data;

    const serviceClient = createServiceClient();

    // Upsert the role (handles both existing and missing user_roles entries)
    const { error } = await serviceClient
      .from('user_roles')
      .upsert(
        { user_id: userId, role },
        { onConflict: 'user_id' },
      );

    if (error) {
      console.error('Failed to update user role:', error);
      return NextResponse.json(
        { error: 'Failed to update user role' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: userId, role });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update user role') },
      { status: 500 },
    );
  }
}

/** DELETE /api/admin/users/[userId] — deactivate a user by banning them (admin only) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    const { userId } = await params;
    if (!UUID_RE.test(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Prevent admin from deactivating themselves
    if (userId === auth.user.id) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account' },
        { status: 400 },
      );
    }

    const serviceClient = createServiceClient();

    // Ban the user permanently — Supabase uses ban_duration for this.
    // '876000h' is ~100 years, effectively permanent.
    const { error: banError } = await serviceClient.auth.admin.updateUserById(
      userId,
      { ban_duration: '876000h' },
    );

    if (banError) {
      console.error('Failed to deactivate user:', banError);
      return NextResponse.json(
        { error: 'Failed to deactivate user' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to deactivate user') },
      { status: 500 },
    );
  }
}
