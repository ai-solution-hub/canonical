import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import {
  DedupQueueQuerySchema,
  DedupQueueResponseSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const GET = defineRoute(
  DedupQueueResponseSchema,
  async (request: NextRequest) => {
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
          'id, title, content, dedup_status, created_at, primary_domain, content_owner_id, ingestion_source, superseded_by, metadata, publication_status',
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
  },
);
