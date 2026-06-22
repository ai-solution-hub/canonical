import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { mapGroupedActivityRows } from '@/lib/dashboard';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import { ActivityParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, role } = auth;

    const parsed = parseSearchParams(
      ActivityParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { limit, before } = parsed.data;

    const rpcParams: {
      p_limit: number;
      p_is_admin: boolean;
      p_before?: string;
    } = {
      p_limit: limit,
      p_is_admin: role === 'admin',
    };
    if (before) {
      rpcParams.p_before = before;
    }

    const { data, error } = await supabase.rpc(
      'get_grouped_activity_feed',
      rpcParams,
    );

    if (error) {
      logger.error({ err: error }, 'Failed to fetch activity feed');
      return NextResponse.json(
        { error: 'Failed to fetch activity feed' },
        { status: 500 },
      );
    }

    // Map RPC rows -> GroupedActivityItem (shared mapper; canonical home @/lib/dashboard).
    const activities = mapGroupedActivityRows(data);

    return NextResponse.json({
      activities,
      limit,
      has_more: activities.length >= limit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch activity feed') },
      { status: 500 },
    );
  }
});
