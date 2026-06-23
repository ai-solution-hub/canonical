import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import {
  ChangeReportDomainSummarySchema,
  parseJsonbArray,
} from '@/lib/validation/jsonb';
import type { ChangeReport } from '@/types/change-reports';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// Mirrors the ChangeReport interface for the fields this route populates.
// domain_summaries reuses ChangeReportDomainSummarySchema (the same schema fed
// to parseJsonbArray). narrative_summary/tokens_used are nullable per the
// change_reports table; the optional item_ids/filters/governance_summary are
// never set by this handler so they are omitted.
const ChangeReportSchema = z.object({
  id: z.string(),
  frequency: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  item_count: z.number(),
  domain_summaries: z.array(ChangeReportDomainSummarySchema),
  narrative_summary: z.string().nullable(),
  generated_at: z.string(),
  generated_by: z.string(),
  tokens_used: z.number().nullable(),
  created_at: z.string(),
});

// 2xx branches: { digest: null } when no report exists, else { digest: <report> }.
const ChangeReportLatestResponseSchema = z.object({
  digest: ChangeReportSchema.nullable(),
});

export const GET = defineRoute(ChangeReportLatestResponseSchema, async () => {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('change_reports')
      .select(
        'id, frequency, period_start, period_end, item_count, domain_summaries, narrative_summary, generated_at, generated_by, tokens_used, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ err: error }, 'Failed to fetch latest digest');
      return NextResponse.json(
        { error: 'Failed to fetch latest digest' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ digest: null });
    }

    const digest: ChangeReport = {
      id: data.id,
      frequency: data.frequency,
      period_start: data.period_start,
      period_end: data.period_end,
      item_count: data.item_count,
      domain_summaries: parseJsonbArray(
        ChangeReportDomainSummarySchema,
        data.domain_summaries,
      ),
      narrative_summary: data.narrative_summary,
      generated_at: data.generated_at,
      generated_by: data.generated_by,
      tokens_used: data.tokens_used,
      created_at: data.created_at,
    };

    return NextResponse.json({ digest });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch latest digest') },
      { status: 500 },
    );
  }
});
