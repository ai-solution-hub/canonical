import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import {
  ChangeReportDomainSummarySchema,
  parseJsonbArray,
} from '@/lib/validation/jsonb';
import { ChangeReportListParamsSchema } from '@/lib/validation/schemas';
import type { ChangeReport } from '@/types/change-reports';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { searchParams } = new URL(request.url);
    const parsed = parseSearchParams(
      ChangeReportListParamsSchema,
      searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { limit, offset } = parsed.data;

    // Fetch digests with pagination
    const { data, error, count } = await supabase
      .from('change_reports')
      .select(
        'id, frequency, period_start, period_end, item_count, domain_summaries, narrative_summary, generated_at, generated_by, tokens_used, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ err: error }, 'Failed to fetch digests');
      return NextResponse.json(
        { error: 'Failed to fetch digests' },
        { status: 500 },
      );
    }

    const digests: ChangeReport[] = (data ?? []).map((row) => ({
      id: row.id,
      frequency: row.frequency,
      period_start: row.period_start,
      period_end: row.period_end,
      item_count: row.item_count,
      domain_summaries: parseJsonbArray(
        ChangeReportDomainSummarySchema,
        row.domain_summaries,
      ),
      narrative_summary: row.narrative_summary,
      generated_at: row.generated_at,
      generated_by: row.generated_by,
      tokens_used: row.tokens_used,
      created_at: row.created_at,
    }));

    return NextResponse.json({ digests, total: count ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch digest list') },
      { status: 500 },
    );
  }
});
