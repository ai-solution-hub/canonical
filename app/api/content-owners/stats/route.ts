import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { resolveUserDisplayNames } from '@/lib/users/display-names';
import type { ContentOwnerStats } from '@/types/owner';

export const maxDuration = 30;

/**
 * GET /api/content-owners/stats
 *
 * Returns content ownership statistics enriched with display names.
 * Available to all authenticated users.
 *
 * S156 WP-2: display-name resolution now uses the
 * `get_user_display_names` SQL function (single round trip, batch
 * resolved) instead of the old `auth.admin.getUserById` loop which
 * silently degraded for pipeline-owned content.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Call get_content_owner_stats RPC
    const { data, error: rpcError } = await supabase.rpc(
      'get_content_owner_stats',
    );

    if (rpcError) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            rpcError,
            'Failed to fetch content owner stats',
          ),
        },
        { status: 500 },
      );
    }

    const stats = data as ContentOwnerStats[] | null;

    if (!stats || stats.length === 0) {
      return NextResponse.json([]);
    }

    // Batch-resolve display names for every owner_id in one SQL round
    // trip. Pipeline service account returns 'Pipeline (system)', unknown
    // owners return 'A team member'. See lib/users/display-names.ts for
    // the full contract.
    const ownerIds = stats.map((s) => s.owner_id);
    const displayNameMap = await resolveUserDisplayNames(supabase, ownerIds);

    const enrichedStats = stats.map((s) => ({
      ...s,
      display_name: displayNameMap.get(s.owner_id)?.display_name ?? null,
    }));

    return NextResponse.json(enrichedStats);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch content owner stats') },
      { status: 500 },
    );
  }
}
