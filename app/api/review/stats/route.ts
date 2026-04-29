import { NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import type { ReviewStatsResponse } from '@/types/review';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * GET /api/review/stats — aggregate counts for the review progress bar.
 *
 * Returns total, verified, flagged, and unverified counts, plus breakdowns
 * by domain, content type, source file, and source document.
 * Used by the ReviewProgressBar component.
 *
 * All aggregation is performed server-side via the `get_review_breakdown_stats`
 * RPC function, replacing the previous 7-query JS aggregation pattern.
 */
export async function GET() {
  try {
    // Auth + role check — editors and admins only
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Rate limit: 20 requests per minute
    const { allowed } = checkRateLimit(`review-stats:${user.id}`, 20, 60_000);
    if (!allowed) return rateLimitResponse();

    const { data, error } = await supabase.rpc('get_review_breakdown_stats');

    if (error) {
      logger.error({ err: error }, 'Failed to fetch review breakdown stats');
      return NextResponse.json(
        { error: 'Failed to fetch review statistics' },
        { status: 500 },
      );
    }

    // The RPC returns the full ReviewStatsResponse shape (minus unverified)
    const stats = data as Omit<ReviewStatsResponse, 'unverified'> & {
      total: number;
      verified: number;
    };

    // Compute unverified from total - verified (same as before)
    const response: ReviewStatsResponse = {
      ...stats,
      unverified: stats.total - stats.verified,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review statistics') },
      { status: 500 },
    );
  }
}
