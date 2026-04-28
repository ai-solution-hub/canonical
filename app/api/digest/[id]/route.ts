import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  parseJsonbArray,
  DigestDomainSummarySchema,
  ThemeClusterSchema,
} from '@/lib/validation/jsonb';
import type { Digest } from '@/types/digest';

export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id } = await params;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid digest ID format' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('digests')
      .select(
        'id, digest_type, period_start, period_end, item_count, domain_summaries, theme_clusters, narrative_summary, generated_at, generated_by, tokens_used, item_ids, created_at',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch digest:', error);
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch digest') },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'Digest not found' }, { status: 404 });
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
      item_ids: data.item_ids ?? undefined,
      created_at: data.created_at,
    };

    return NextResponse.json({ digest });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch digest') },
      { status: 500 },
    );
  }
}
