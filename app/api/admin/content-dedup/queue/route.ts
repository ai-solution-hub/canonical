import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import { DedupQueueQuerySchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/admin/content-dedup/queue
 *
 * Lists `content_items` rows with `dedup_status='suspected_duplicate'` for
 * the admin dedup review surface. Excludes archived rows. Supports
 * `created_at` cursor pagination and a `primary_domain` filter.
 *
 * Auth: admin role only (returns 401 / 403 / 500 via `authFailureResponse`).
 *
 * Query params:
 *   - `domain`        (optional) — filter by `primary_domain`
 *   - `cursor`        (optional, ISO datetime) — paginate older-than
 *   - `limit`         (1..100, default 50) — page size
 *   - `sort`          (`created_at_desc` | `similarity_desc`,
 *                     default `created_at_desc`)
 *
 * For exact-hash soft-block matches (the only path that produces
 * `suspected_duplicate` today), similarity is 1.0 by definition. Therefore
 * `similarity_desc` is treated as equivalent to `created_at_desc` in v1;
 * §1.9 (near-dup merge dashboard) introduces real similarity scoring.
 *
 * Response: { items: SuspectedDuplicateRow[], hasMore: boolean,
 *             nextCursor: string | null }
 *
 * Spec: docs/specs/§1.7-admin-dedup-review-spec.md §5.1
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      DedupQueueQuerySchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { domain, cursor, limit } = parsed.data;

    let query = supabase
      .from('content_items')
      .select(
        'id, title, content, dedup_status, created_at, primary_domain, content_owner_id, ingest_source, superseded_by, metadata, publication_status',
      )
      .eq('dedup_status', 'suspected_duplicate')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      // peek-ahead for hasMore
      .limit(limit + 1);

    if (domain) query = query.eq('primary_domain', domain);
    if (cursor) query = query.lt('created_at', cursor);

    const { data: items, error } = await query;

    if (error) {
      logger.error(
        { err: error, op: 'admin.content-dedup.queue.load' },
        'Failed to load dedup queue',
      );
      return NextResponse.json(
        { error: 'Failed to load dedup queue' },
        { status: 500 },
      );
    }

    const rows = items ?? [];
    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = visible[visible.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? typeof lastRow.created_at === 'string'
          ? lastRow.created_at
          : null
        : null;

    return NextResponse.json({
      items: visible,
      hasMore,
      nextCursor,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load dedup queue') },
      { status: 500 },
    );
  }
}
