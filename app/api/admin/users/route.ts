import { NextResponse } from 'next/server';
import { getAuthorisedClient, unauthorisedResponse, forbiddenResponse } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';

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
    if (!auth) {
      // Distinguish between not authenticated and not authorised
      const { getAuthenticatedClient } = await import('@/lib/auth');
      const basicAuth = await getAuthenticatedClient();
      if (!basicAuth) return unauthorisedResponse();
      return forbiddenResponse();
    }

    const serviceClient = createServiceClient();

    // Fetch all users from Supabase Auth
    const { data: authData, error: authError } =
      await serviceClient.auth.admin.listUsers();

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

    const users: UserWithRole[] = (authData.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? '',
      display_name:
        (u.user_metadata?.display_name as string) ?? null,
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
