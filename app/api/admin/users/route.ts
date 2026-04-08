import { NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';

export const maxDuration = 30;

interface UserWithRole {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
}

/** GET /api/admin/users — list all users with their roles (admin only) */
export async function GET() {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    const serviceClient = createServiceClient();

    // Fetch all users from Supabase Auth
    const { data: authData, error: authError } =
      await serviceClient.auth.admin.listUsers({ perPage: 1000 });

    if (authError) {
      console.error('Failed to list users:', authError);
      return NextResponse.json(
        { error: 'Failed to list users' },
        { status: 500 },
      );
    }

    // Fetch all user roles
    const { data: roles, error: rolesError } = await serviceClient
      .from('user_roles')
      .select('user_id, role');

    if (rolesError) {
      console.error('Failed to fetch user roles:', rolesError);
      return NextResponse.json(
        { error: 'Failed to fetch user roles' },
        { status: 500 },
      );
    }

    const roleMap = new Map(
      (roles ?? []).map((r: { user_id: string; role: string }) => [
        r.user_id,
        r.role,
      ]),
    );

    // Filter out infrastructure service accounts. The Team Members UI is
    // a roster of humans — the pipeline service account is not a person
    // and would confuse the UI. Note this is NOT a mitigation for the
    // S156 listUsers() scan-error bug (that's fixed at the DB layer by the
    // 20260408134124 corrective migration); it is a UI presentation choice.
    // See docs/audits/s156-auth-admin-sweep.md and WP-6 of the resolution
    // spec for context.
    const users: UserWithRole[] = (authData.users ?? [])
      .filter((u) => u.id !== PIPELINE_SYSTEM_USER_ID)
      .map((u) => ({
        id: u.id,
        email: u.email ?? '',
        display_name: (u.user_metadata?.display_name as string) ?? null,
        role: (roleMap.get(u.id) as string) ?? 'viewer',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      }));

    return NextResponse.json(users);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list users') },
      { status: 500 },
    );
  }
}
