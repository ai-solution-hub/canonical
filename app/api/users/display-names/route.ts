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

    // Fetch only the requested users by ID (not all users)
    const results = await Promise.allSettled(
      validIds.map((id) => serviceClient.auth.admin.getUserById(id)),
    );

    const result: Record<string, string> = {};

    for (let i = 0; i < validIds.length; i++) {
      const settled = results[i];
      if (settled.status !== 'fulfilled') continue;
      const user = settled.value?.data?.user;
      if (!user) continue;

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
