import { NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';
import type { ContentOwnerStats } from '@/types/owner';

export const maxDuration = 30;

/**
 * GET /api/content-owners/stats
 *
 * Returns content ownership statistics enriched with display names.
 * Available to all authenticated users.
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

    // Enrich with display names using service client (auth.users not accessible via RLS)
    const ownerIds = stats.map((s) => s.owner_id);

    const displayNames: Record<string, string> = {};

    try {
      const serviceClient = createServiceClient();

      const results = await Promise.allSettled(
        ownerIds.map((id: string) => serviceClient.auth.admin.getUserById(id)),
      );

      for (let i = 0; i < ownerIds.length; i++) {
        const settled = results[i];
        if (settled.status !== 'fulfilled') continue;
        const user = settled.value?.data?.user;
        if (!user) continue;

        const displayName =
          (user.user_metadata?.display_name as string) ??
          (user.user_metadata?.full_name as string) ??
          (user.email ? user.email.split('@')[0] : null);

        if (displayName) {
          displayNames[user.id] = displayName;
        }
      }
    } catch (err) {
      console.warn('Failed to resolve display names for owner stats:', err);
    }

    // Merge display names into stats
    const enrichedStats = stats.map((s) => ({
      ...s,
      display_name: displayNames[s.owner_id] ?? null,
    }));

    return NextResponse.json(enrichedStats);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch content owner stats') },
      { status: 500 },
    );
  }
}
