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

    // Run the RPC + the awaiting_publication count in parallel. The RPC's
    // existing fields scope to non-archived content_items where
    // governance_review_status != 'draft' (per
    // get_review_breakdown_stats() body); a separate count for
    // publication_status='in_review' is needed because in_review rows can
    // share the governance != 'draft' guard but the count is conceptually
    // orthogonal — used only as the count badge for tab 6 of /review.
    //
    // Spec: docs/specs/review-page-tabs-refactor-spec.md §8 (b), §12 OQ4.
    const [statsResult, awaitingResult] = await Promise.all([
      supabase.rpc('get_review_breakdown_stats'),
      supabase
        .from('content_items')
        .select('id', { count: 'exact', head: true })
        .eq('publication_status', 'in_review')
        .is('archived_at', null),
    ]);

    if (statsResult.error) {
      logger.error(
        { err: statsResult.error },
        'Failed to fetch review breakdown stats',
      );
      return NextResponse.json(
        { error: 'Failed to fetch review statistics' },
        { status: 500 },
      );
    }
    if (awaitingResult.error) {
      logger.error(
        { err: awaitingResult.error },
        'Failed to fetch awaiting_publication count',
      );
      return NextResponse.json(
        { error: 'Failed to fetch review statistics' },
        { status: 500 },
      );
    }

    // The RPC returns the full ReviewStatsResponse shape (minus unverified +
    // awaiting_publication — both computed in this handler).
    const stats = statsResult.data as Omit<
      ReviewStatsResponse,
      'unverified' | 'awaiting_publication'
    > & {
      total: number;
      verified: number;
    };

    // Compute unverified from total - verified (same as before)
    const response: ReviewStatsResponse = {
      ...stats,
      unverified: stats.total - stats.verified,
      awaiting_publication: awaitingResult.count ?? 0,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review statistics') },
      { status: 500 },
    );
  }
}
