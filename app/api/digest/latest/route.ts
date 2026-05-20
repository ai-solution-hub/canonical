import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  parseJsonbArray,
  DigestDomainSummarySchema,
  ThemeClusterSchema,
} from '@/lib/validation/jsonb';
import type { Digest } from '@/types/digest';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

export async function GET() {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('change_reports')
      .select(
        'id, digest_type, period_start, period_end, item_count, domain_summaries, theme_clusters, narrative_summary, generated_at, generated_by, tokens_used, created_at',
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

    const digest: Digest = {
      id: data.id,
      digest_type: data.digest_type,
      period_start: data.period_start,
      period_end: data.period_end,
      item_count: data.item_count,
      domain_summaries: parseJsonbArray(
        DigestDomainSummarySchema,
        data.domain_summaries,
      ),
      theme_clusters: parseJsonbArray(ThemeClusterSchema, data.theme_clusters),
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
}
