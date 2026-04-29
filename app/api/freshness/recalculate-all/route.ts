import { NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { logger, updateRequestContext } from '@/lib/logger';
import { withRequestContextBare } from '@/lib/route-context';

export const maxDuration = 30;

/**
 * POST /api/freshness/recalculate-all
 *
 * Recalculate freshness for ALL content items via the
 * `recalculate_all_freshness()` PostgreSQL function (runs entirely in SQL).
 * Admin-only. No request body required.
 *
 * Phase 2 (S15 WP1): wrapped with `withRequestContextBare` so every log
 * line and any Sentry event raised from inside the handler carries the
 * shared `requestId` minted upstream by `proxy.ts`.
 */
export const POST = withRequestContextBare(async () => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Upgrade the request scope with the resolved user — anonymous traffic
    // already has a requestId; this lets Sentry+log lines carry userId.
    updateRequestContext({ userId: user.id, userRole: 'admin' });

    const { allowed } = checkRateLimit(
      `freshness:recalculate-all:${user.id}`,
      5,
      60_000,
    );
    if (!allowed) return rateLimitResponse();

    const { data, error } = await supabase.rpc('recalculate_all_freshness');

    if (error) {
      logger.error(
        { err: error, op: 'freshness.recalculate_all' },
        'Failed to recalculate freshness',
      );
      return NextResponse.json(
        { error: 'Failed to recalculate freshness' },
        { status: 500 },
      );
    }

    // The RPC returns a single-row table with summary counts
    const result = Array.isArray(data) ? data[0] : data;

    return NextResponse.json({
      updated: result?.total_count ?? 0,
      total: result?.total_count ?? 0,
      summary: {
        fresh: result?.fresh_count ?? 0,
        aging: result?.aging_count ?? 0,
        stale: result?.stale_count ?? 0,
        expired: result?.expired_count ?? 0,
      },
      recalculated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(
      { err, op: 'freshness.recalculate_all' },
      'Failed to recalculate freshness',
    );
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to recalculate freshness') },
      { status: 500 },
    );
  }
});
