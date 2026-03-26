import { NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse, rateLimitResponse } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import type { ReviewStatsResponse } from '@/types/review';

export const maxDuration = 30;

/**
 * GET /api/review/stats — aggregate counts for the review progress bar.
 *
 * Returns total, verified, flagged, and unverified counts, plus breakdowns
 * by domain and source file. Used by the ReviewProgressBar component.
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

    // Run the four aggregate queries in parallel
    const [totalResult, verifiedResult, flaggedResult, draftResult] = await Promise.all([
      // Total content items (excluding drafts)
      supabase
        .from('content_items')
        .select('id', { count: 'exact', head: true })
        .or('governance_review_status.is.null,governance_review_status.neq.draft'),

      // Verified items (verified_at IS NOT NULL, excluding drafts)
      supabase
        .from('content_items')
        .select('id', { count: 'exact', head: true })
        .not('verified_at', 'is', null)
        .or('governance_review_status.is.null,governance_review_status.neq.draft'),

      // Flagged items (open review_needed flags — fetch IDs to count distinct)
      supabase
        .from('ingestion_quality_log')
        .select('content_item_id')
        .eq('flag_type', 'review_needed')
        .eq('resolved', false)
        .limit(10000),

      // Draft items (governance_review_status = 'draft')
      supabase
        .from('content_items')
        .select('id', { count: 'exact', head: true })
        .eq('governance_review_status', 'draft'),
    ]);

    if (totalResult.error) {
      console.error('Failed to fetch total count:', totalResult.error);
      return NextResponse.json(
        { error: 'Failed to fetch review statistics' },
        { status: 500 },
      );
    }

    const total = totalResult.count ?? 0;
    const verified = verifiedResult.count ?? 0;
    const flagged = new Set(flaggedResult.data?.map(r => r.content_item_id)).size;
    const draft = draftResult.count ?? 0;
    const unverified = total - verified;

    // Fetch domain, content type, and source file breakdowns for filter UI.
    // Uses a lightweight query fetching only the columns needed for aggregation.
    const { data: breakdownItems } = await supabase
      .from('content_items')
      .select('primary_domain, content_type, verified_at, source_file, governance_review_status')
      .or('governance_review_status.is.null,governance_review_status.neq.draft')
      .limit(10000);

    const by_domain: Record<string, { total: number; verified: number }> = {};
    const by_content_type: Record<string, { total: number; verified: number }> = {};
    const by_source_file: Record<string, { total: number; verified: number }> = {};

    if (Array.isArray(breakdownItems)) {
      for (const item of breakdownItems) {
        // Domain breakdown
        const domain = item.primary_domain ?? 'Uncategorised';
        if (!by_domain[domain]) {
          by_domain[domain] = { total: 0, verified: 0 };
        }
        by_domain[domain].total++;
        if (item.verified_at) {
          by_domain[domain].verified++;
        }

        // Content type breakdown
        const contentType = item.content_type ?? 'other';
        if (!by_content_type[contentType]) {
          by_content_type[contentType] = { total: 0, verified: 0 };
        }
        by_content_type[contentType].total++;
        if (item.verified_at) {
          by_content_type[contentType].verified++;
        }

        // Source file breakdown (from proper column)
        const sourceFile = item.source_file as string | undefined;
        if (sourceFile) {
          if (!by_source_file[sourceFile]) {
            by_source_file[sourceFile] = { total: 0, verified: 0 };
          }
          by_source_file[sourceFile].total++;
          if (item.verified_at) {
            by_source_file[sourceFile].verified++;
          }
        }
      }
    }

    // Source document breakdown — items linked via source_document_id FK
    const by_source_document: Record<string, { total: number; verified: number; name: string }> = {};
    const { data: sourceDocItems } = await supabase
      .from('content_items')
      .select('source_document_id, verified_at')
      .not('source_document_id', 'is', null)
      .or('governance_review_status.is.null,governance_review_status.neq.draft')
      .limit(10000);

    if (Array.isArray(sourceDocItems)) {
      // Collect unique source_document_ids
      const docIds = [...new Set(
        sourceDocItems
          .map((r: { source_document_id: string | null }) => r.source_document_id)
          .filter((id): id is string => id !== null),
      )];

      // Fetch source document names
      let docNameMap: Record<string, string> = {};
      if (docIds.length > 0) {
        const { data: docRows } = await supabase
          .from('source_documents')
          .select('id, filename')
          .in('id', docIds);
        if (Array.isArray(docRows)) {
          docNameMap = Object.fromEntries(
            docRows.map((r: { id: string; filename: string }) => [r.id, r.filename]),
          );
        }
      }

      for (const item of sourceDocItems) {
        const docId = (item as { source_document_id: string }).source_document_id;
        if (!by_source_document[docId]) {
          by_source_document[docId] = {
            total: 0,
            verified: 0,
            name: docNameMap[docId] ?? docId.slice(0, 8),
          };
        }
        by_source_document[docId].total++;
        if ((item as { verified_at: string | null }).verified_at) {
          by_source_document[docId].verified++;
        }
      }
    }

    const response: ReviewStatsResponse = {
      total,
      verified,
      flagged,
      unverified,
      draft,
      by_domain,
      by_content_type,
      by_source_file,
      by_source_document,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review statistics') },
      { status: 500 },
    );
  }
}
