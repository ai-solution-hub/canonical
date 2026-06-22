import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

interface UserWithRole {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
}

/**
 * Fetch a `userId -> last_sign_in_at` map via the GoTrue admin API.
 *
 * Always returns a Map. On any failure (network, S156-class corruption,
 * permission) the Map is empty and downstream callers see `null` for
 * every user — the documented soft-failure mode. Errors are logged but
 * never re-thrown so the bulk read of user_profiles + user_roles
 * remains the load-bearing path.
 *
 * The map values are explicitly `string | null`: a real ISO timestamp
 * for users who have signed in, or `null` for users who have never
 * signed in (GoTrue returns `null` for `last_sign_in_at` in that case).
 */
async function fetchLastSignInMap(
  serviceClient: SupabaseClient<Database>,
): Promise<Map<string, string | null>> {
  const lastSignInById = new Map<string, string | null>();
  try {
    const { data: authData, error: authError } =
      await serviceClient.auth.admin.listUsers({ perPage: 1000 });
    if (authError) {
      logger.warn(
        { err: authError.message },
        '[admin/users] auth.admin.listUsers degraded; last_sign_in_at will be NULL',
      );
      return lastSignInById;
    }
    for (const u of authData.users ?? []) {
      lastSignInById.set(u.id, u.last_sign_in_at ?? null);
    }
  } catch (signInErr) {
    // Belt-and-braces: never let a GoTrue failure break the whole
    // route. The bulk read is the load-bearing path.
    logger.warn(
      { err: safeErrorMessage(signInErr, 'unknown error') },
      '[admin/users] auth.admin.listUsers threw; last_sign_in_at will be NULL',
    );
  }
  return lastSignInById;
}

// Mirrors the UserWithRole interface field-for-field. `email` is coerced to ''
// (never null) and `display_name`/`last_sign_in_at` are explicitly string|null.
const AdminUsersResponseSchema = z.array(
  z.object({
    id: z.string(),
    email: z.string(),
    display_name: z.string().nullable(),
    role: z.string(),
    created_at: z.string(),
    last_sign_in_at: z.string().nullable(),
  }),
);

export const GET = defineRoute(AdminUsersResponseSchema, async () => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    const serviceClient = createServiceClient();

    // Bulk read 1: user_profiles. Filter out the pipeline service
    // account at the DB layer — the Team Members UI is a roster of
    // humans, and the cosmetic filter is the same contract the pre-
    // WP-G3.4 implementation honoured (route.ts:58-61 before the rewrite).
    const { data: profiles, error: profilesError } = await serviceClient
      .from('user_profiles')
      .select('id, email, full_name, created_at')
      .neq('id', PIPELINE_SYSTEM_USER_ID);

    if (profilesError) {
      logger.error({ err: profilesError }, 'Failed to fetch user_profiles');
      return NextResponse.json(
        { error: 'Failed to list users' },
        { status: 500 },
      );
    }

    // Bulk read 2: user_roles. There is no FK between user_profiles
    // and user_roles (both FK to auth.users separately) so PostgREST
    // cannot auto-embed; join in JS.
    const { data: roles, error: rolesError } = await serviceClient
      .from('user_roles')
      .select('user_id, role');

    if (rolesError) {
      logger.error({ err: rolesError }, 'Failed to fetch user_roles');
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

    // last_sign_in_at is not in user_profiles v1 (D-G3.4-7). Fall back
    // to GoTrue admin API for that column only. If listUsers() fails
    // (S156-class corruption), the rest of the response still resolves —
    // the field just degrades to NULL across the board, which is the
    // intentional soft-failure mode.
    //
    // The widened contract (WP-S8i): values are explicitly `string |
    // null`. Missing rows MUST surface as `null`, never as `''`. The
    // UI distinguishes "never signed in" (display "Never") from a real
    // ISO timestamp; an empty string would be incorrectly rendered as
    // an Invalid Date by Date parsers.
    const lastSignInById = await fetchLastSignInMap(serviceClient);

    type ProfileRow = {
      id: string;
      email: string | null;
      full_name: string | null;
      created_at: string;
    };

    const users: UserWithRole[] = ((profiles ?? []) as ProfileRow[]).map(
      (p) => {
        const lastSignIn = lastSignInById.get(p.id);
        return {
          id: p.id,
          email: p.email ?? '',
          display_name: p.full_name,
          role: (roleMap.get(p.id) as string) ?? 'viewer',
          created_at: p.created_at,
          // Map.get() returns undefined when the key is missing; coerce
          // to null so the field is always `string | null`, never
          // `undefined` or `''`.
          last_sign_in_at: lastSignIn === undefined ? null : lastSignIn,
        };
      },
    );

    return NextResponse.json(users);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list users') },
      { status: 500 },
    );
  }
});
