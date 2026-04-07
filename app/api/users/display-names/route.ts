import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { DisplayNamesBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * POST /api/users/display-names — resolve user UUIDs to display names.
 *
 * Accepts { ids: string[] } and returns { [uuid]: displayName }.
 * Available to all authenticated users.
 *
 * Strategy: read `user_roles.display_name` first (fast, single query).
 * For any IDs missing a display_name, fall back to `auth.admin.getUserById`
 * to extract a name from user_metadata or email.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);

    const raw = await request.json();
    const parsed = parseBody(DisplayNamesBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { ids } = parsed.data;
    // All IDs are already validated as UUIDs by the schema

    const result: Record<string, string> = {};

    // Primary: read display_name from user_roles (accessible via RLS to all authenticated users)
    const roleRows = await sb(
      auth.supabase
        .from('user_roles')
        .select('user_id, display_name')
        .in('user_id', ids),
      'user_roles.display_names',
    );

    for (const row of roleRows) {
      if (row.display_name) {
        result[row.user_id] = row.display_name;
      }
    }

    // Fallback: for any IDs not resolved via user_roles, try auth.admin
    const unresolvedIds = ids.filter((id) => !result[id]);

    if (unresolvedIds.length > 0) {
      const serviceClient = createServiceClient();
      const authResults = await Promise.allSettled(
        unresolvedIds.map((id) => serviceClient.auth.admin.getUserById(id)),
      );

      for (let i = 0; i < unresolvedIds.length; i++) {
        const settled = authResults[i];
        if (settled.status !== 'fulfilled') continue;
        const user = settled.value?.data?.user;
        if (!user) continue;

        const displayName =
          (user.user_metadata?.display_name as string) ??
          (user.user_metadata?.full_name as string) ??
          (user.email ? user.email.split('@')[0] : null);

        if (displayName) {
          result[user.id] = displayName;
        }
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to resolve display names') },
      { status: 500 },
    );
  }
}
