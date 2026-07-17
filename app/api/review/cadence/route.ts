import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import type { FacetOwnerKind } from '@/lib/validation/owner-kind';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

/**
 * Review cadence response shape — aggregate review health metrics.
 */
export interface ReviewCadenceResponse {
  summary: {
    total_items: number;
    never_reviewed: number;
    reviewed_last_7_days: number;
    reviewed_last_30_days: number;
    reviewed_last_90_days: number;
    overdue: number;
    average_days_since_review: number;
  };
  overdue_items: Array<{
    id: string;
    title: string;
    primary_domain: string | null;
    verified_at: string | null;
    days_since_review: number;
    governance_review_status: string | null;
  }>;
  by_domain: Record<
    string,
    {
      total: number;
      never_reviewed: number;
      average_days: number;
      overdue: number;
    }
  >;
}

const ReviewCadenceResponseSchema = z.object({
  summary: z.object({
    total_items: z.number(),
    never_reviewed: z.number(),
    reviewed_last_7_days: z.number(),
    reviewed_last_30_days: z.number(),
    reviewed_last_90_days: z.number(),
    overdue: z.number(),
    average_days_since_review: z.number(),
  }),
  overdue_items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      primary_domain: z.string().nullable(),
      verified_at: z.string().nullable(),
      days_since_review: z.number(),
      governance_review_status: z.string().nullable(),
    }),
  ),
  by_domain: z.record(
    z.string(),
    z.object({
      total: z.number(),
      never_reviewed: z.number(),
      average_days: z.number(),
      overdue: z.number(),
    }),
  ),
});

export const GET = defineRoute(ReviewCadenceResponseSchema, async () => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Rate limit: 10 requests per minute
    const { allowed } = checkRateLimit(`review-cadence:${user.id}`, 10, 60_000);
    if (!allowed) return rateLimitResponse();

    // Fetch all content items with minimal columns for cadence calculations.
    // ID-131 {131.19} G-GOV-FACET: content_items is dying — verified_at/
    // governance_review_status live on the record_lifecycle facet (owner_kind
    // ='source_document'; q_a_pair owners excluded — this report has no SD
    // equivalent for a q_a_pair title/domain, and pre-refactor content_items
    // never included q_a_pairs either, so this preserves existing behaviour);
    // title/suggested_title/primary_domain live on source_documents.
    const { data: rawItems, error: itemsError } = await supabase
      .from('record_lifecycle')
      .select(
        'source_document_id, verified_at, governance_review_status, source_documents!inner(id, filename, suggested_title, primary_domain)',
      )
      .eq('owner_kind', 'source_document' satisfies FacetOwnerKind)
      .or(
        'governance_review_status.is.null,governance_review_status.neq.draft',
      );

    if (itemsError) {
      logger.error({ err: itemsError }, 'Review cadence items query error');
      return NextResponse.json(
        { error: 'Failed to fetch content items' },
        { status: 500 },
      );
    }

    const items = (rawItems ?? [])
      .filter((row) => row.source_documents !== null)
      .map((row) => ({
        id: row.source_document_id!,
        title: row.source_documents!.filename,
        suggested_title: row.source_documents!.suggested_title,
        primary_domain: row.source_documents!.primary_domain,
        verified_at: row.verified_at,
        governance_review_status: row.governance_review_status,
      }));

    // Fetch governance config for per-domain timeout_days
    const { data: configRows, error: configError } = await supabase
      .from('governance_config')
      .select('domain, timeout_days');

    if (configError) {
      logger.error({ err: configError }, 'Review cadence config query error');
      // Non-fatal — fall back to default timeout
    }

    // Build domain timeout lookup (default 90 days for cadence overdue threshold)
    const DEFAULT_OVERDUE_DAYS = 90;
    const domainTimeouts = new Map<string, number>();
    if (configRows) {
      for (const row of configRows) {
        // governance_config.timeout_days is for review assignment timeout (default 7).
        // For cadence "overdue" we use a higher threshold — 90 days by default.
        // If a domain has a configured timeout, we use the larger of that and 90.
        domainTimeouts.set(
          row.domain,
          Math.max(
            row.timeout_days ?? DEFAULT_OVERDUE_DAYS,
            DEFAULT_OVERDUE_DAYS,
          ),
        );
      }
    }

    const now = new Date();
    const allItems = items ?? [];

    // Compute per-item metrics
    let neverReviewed = 0;
    let reviewedLast7 = 0;
    let reviewedLast30 = 0;
    let reviewedLast90 = 0;
    let overdueCount = 0;
    let totalDaysSinceReview = 0;
    let reviewedItemCount = 0;

    const overdueItems: ReviewCadenceResponse['overdue_items'] = [];

    // Per-domain accumulators
    const domainMap = new Map<
      string,
      {
        total: number;
        never_reviewed: number;
        total_days: number;
        reviewed_count: number;
        overdue: number;
      }
    >();

    for (const item of allItems) {
      const domain = item.primary_domain ?? 'Uncategorised';
      const title = item.suggested_title ?? item.title ?? 'Untitled';

      // Ensure domain entry exists
      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          total: 0,
          never_reviewed: 0,
          total_days: 0,
          reviewed_count: 0,
          overdue: 0,
        });
      }
      const domainStats = domainMap.get(domain)!;
      domainStats.total++;

      if (!item.verified_at) {
        neverReviewed++;
        domainStats.never_reviewed++;
        // Never-reviewed items are always overdue
        overdueCount++;
        domainStats.overdue++;
        overdueItems.push({
          id: item.id,
          title,
          primary_domain: item.primary_domain,
          verified_at: null,
          days_since_review: -1, // Sentinel: never reviewed
          governance_review_status: item.governance_review_status,
        });
        continue;
      }

      const verifiedDate = new Date(item.verified_at);
      const daysSince = Math.floor(
        (now.getTime() - verifiedDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      totalDaysSinceReview += daysSince;
      reviewedItemCount++;
      domainStats.total_days += daysSince;
      domainStats.reviewed_count++;

      if (daysSince <= 7) reviewedLast7++;
      if (daysSince <= 30) reviewedLast30++;
      if (daysSince <= 90) reviewedLast90++;

      // Check overdue against domain-specific or default threshold
      const threshold = domainTimeouts.get(domain) ?? DEFAULT_OVERDUE_DAYS;
      if (daysSince > threshold) {
        overdueCount++;
        domainStats.overdue++;
        overdueItems.push({
          id: item.id,
          title,
          primary_domain: item.primary_domain,
          verified_at: item.verified_at,
          days_since_review: daysSince,
          governance_review_status: item.governance_review_status,
        });
      }
    }

    // Sort overdue items: never-reviewed first, then by most days since review
    overdueItems.sort((a, b) => {
      if (a.days_since_review === -1 && b.days_since_review !== -1) return -1;
      if (a.days_since_review !== -1 && b.days_since_review === -1) return 1;
      if (a.days_since_review === -1 && b.days_since_review === -1) return 0;
      return b.days_since_review - a.days_since_review;
    });

    // Limit overdue items to top 50 for response size
    const limitedOverdueItems = overdueItems.slice(0, 50);

    // Build per-domain breakdown
    const byDomain: ReviewCadenceResponse['by_domain'] = {};
    for (const [domain, stats] of domainMap) {
      byDomain[domain] = {
        total: stats.total,
        never_reviewed: stats.never_reviewed,
        average_days:
          stats.reviewed_count > 0
            ? Math.round(stats.total_days / stats.reviewed_count)
            : 0,
        overdue: stats.overdue,
      };
    }

    const response: ReviewCadenceResponse = {
      summary: {
        total_items: allItems.length,
        never_reviewed: neverReviewed,
        reviewed_last_7_days: reviewedLast7,
        reviewed_last_30_days: reviewedLast30,
        reviewed_last_90_days: reviewedLast90,
        overdue: overdueCount,
        average_days_since_review:
          reviewedItemCount > 0
            ? Math.round(totalDaysSinceReview / reviewedItemCount)
            : 0,
      },
      overdue_items: limitedOverdueItems,
      by_domain: byDomain,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review cadence') },
      { status: 500 },
    );
  }
});
