import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import { paginationParams } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;

      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid item ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      const HistoryParamsSchema = paginationParams({ limit: 50 });
      const parsed = parseSearchParams(
        HistoryParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const { limit, offset } = parsed.data;

      const { data, error, count } = await supabase
        .from('content_history')
        .select(
          'id, content_item_id, version, change_summary, change_reason, change_type, created_by, created_at',
          { count: 'exact' },
        )
        .eq('content_item_id', id)
        .order('version', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logger.error({ err: error }, 'Failed to fetch version history');
        return NextResponse.json(
          { error: 'Failed to fetch version history' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        versions: data ?? [],
        total: count ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch version history') },
        { status: 500 },
      );
    }
  },
);
