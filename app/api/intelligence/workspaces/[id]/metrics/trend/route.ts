// app/api/intelligence/workspaces/[id]/metrics/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const TrendParamsSchema = z.object({
  granularity: z.enum(['daily', 'weekly']).default('daily'),
  period: z.enum(['30d', '90d', '180d']).default('90d'),
});

/**
 * GET /api/intelligence/workspaces/:id/metrics/trend
 *
 * Returns filter ratio trend data bucketed by day or week.
 *
 * Query params:
 *   - granularity: 'daily' | 'weekly' (default: 'daily')
 *   - period: '30d' | '90d' | '180d' (default: '90d')
 *
 * Returns: array of { date, total, passed, filtered, ratio } sorted oldest-first.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      TrendParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { granularity, period } = parsed.data;

    // Convert period string to days for the RPC
    const periodDays = period === '30d' ? 30 : period === '90d' ? 90 : 180;

    const { data, error } = await supabase.rpc('get_filter_ratio_trend', {
      p_workspace_id: id,
      p_granularity: granularity,
      p_period_days: periodDays,
    });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch trend data' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch trend data') },
      { status: 500 },
    );
  }
}
