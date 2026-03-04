import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/users/display-names — resolve user UUIDs to display names.
 *
 * Accepts { ids: string[] } and returns { [uuid]: displayName }.
 * Available to all authenticated users. Uses the service client to
 * read from auth.users (which is not accessible via RLS).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();

    const body = await request.json();
    const ids: string[] = body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'Request body must include a non-empty "ids" array' },
        { status: 400 },
      );
    }

    // Limit to 50 IDs per request to prevent abuse
    if (ids.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 IDs per request' },
        { status: 400 },
      );
    }

    // Validate all IDs are UUIDs
    const validIds = ids.filter((id) => UUID_RE.test(id));
    if (validIds.length === 0) {
      return NextResponse.json({});
    }

    const serviceClient = createServiceClient();

    // Fetch users from Supabase Auth admin API
    const { data: authData, error: authError } =
      await serviceClient.auth.admin.listUsers({ perPage: 1000 });

    if (authError) {
      console.error('Failed to list users for display names:', authError);
      return NextResponse.json(
        { error: 'Failed to resolve user names' },
        { status: 500 },
      );
    }

    const result: Record<string, string> = {};
    const requestedSet = new Set(validIds);

    for (const user of authData.users ?? []) {
      if (!requestedSet.has(user.id)) continue;

      // Try display_name from user_metadata, then full_name, then email prefix
      const displayName =
        (user.user_metadata?.display_name as string) ??
        (user.user_metadata?.full_name as string) ??
        (user.email ? user.email.split('@')[0] : null);

      if (displayName) {
        result[user.id] = displayName;
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
