import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { DigestListParamsSchema } from '@/lib/validation/schemas';
import {
  parseJsonbArray,
  DigestDomainSummarySchema,
  ThemeClusterSchema,
} from '@/lib/validation/jsonb';
import type { Digest } from '@/types/digest';

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { searchParams } = new URL(request.url);
    const parsed = parseSearchParams(DigestListParamsSchema, searchParams);
    if (!parsed.success) return parsed.response;
    const { limit, offset } = parsed.data;

    // Fetch digests with pagination
    const { data, error, count } = await supabase
      .from('digests')
      .select(
        'id, digest_type, period_start, period_end, item_count, domain_summaries, theme_clusters, narrative_summary, generated_at, generated_by, tokens_used, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch digests:', error);
      return NextResponse.json(
        { error: 'Failed to fetch digests' },
        { status: 500 },
      );
    }

    const digests: Digest[] = (data ?? []).map((row) => ({
      id: row.id,
      digest_type: row.digest_type,
      period_start: row.period_start,
      period_end: row.period_end,
      item_count: row.item_count,
      domain_summaries: parseJsonbArray(
        DigestDomainSummarySchema,
        row.domain_summaries,
      ),
      theme_clusters: parseJsonbArray(ThemeClusterSchema, row.theme_clusters),
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
}
