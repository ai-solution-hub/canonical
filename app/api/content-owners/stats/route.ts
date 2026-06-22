import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { resolveUserDisplayNames } from '@/lib/users/display-names';
import type { ContentOwnerStats } from '@/types/owner';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const ContentOwnerStatItemSchema = z.object({
  owner_id: z.string(),
  total_items: z.number(),
  fresh_count: z.number(),
  aging_count: z.number(),
  stale_count: z.number(),
  expired_count: z.number(),
  unverified_count: z.number(),
  display_name: z.string().nullable(),
});
const ContentOwnerStatsResponseSchema = z.array(ContentOwnerStatItemSchema);
export const GET = defineRoute(ContentOwnerStatsResponseSchema, async () => {
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
});
