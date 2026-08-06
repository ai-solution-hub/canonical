import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { ReviewStatsResponseSchema } from '@/lib/validation/schemas';
import type { ReviewStatsResponse } from '@/types/review';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

export const GET = defineRoute(ReviewStatsResponseSchema, async () => {
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
    // id-417 / DR-130: the unclassified-coverage count (ID-63.12) retired
    // with the subject-taxonomy axis — its sentinel columns are dropped.
    // ID-131 {131.19} G-GOV-FACET: content_items is dying — publication_status/
    // archived_at now live on source_documents.
    const [statsResult, awaitingResult] = await Promise.all([
      supabase.rpc('get_review_breakdown_stats'),
      supabase
        .from('source_documents')
        .select('id', { count: 'exact', head: true })
        .eq('publication_status', 'in_review')
        .is('archived_at', null)
        // BL-398 (S450): exclude tombstoned source_documents (GDPR
        // erasure, ID-138 {138.5} DR-023) from the awaiting_publication
        // badge count.
        .neq('admission_status', 'tombstoned'),
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
    // awaiting_publication — both computed in this handler). id-417 / DR-130:
    // the RPC no longer emits a by_domain key (record_lifecycle.domain
    // dropped) and the response shape retired it in lockstep.
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
});
