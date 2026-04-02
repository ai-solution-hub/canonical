// app/api/intelligence/workspaces/[id]/metrics/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const TrendParamsSchema = z.object({
  granularity: z.enum(['daily', 'weekly']).default('daily'),
  period: z.enum(['30d', '90d', '180d']).default('90d'),
});

/**
 * GET /api/intelligence/workspaces/:id/metrics/trend
 *
 * Returns filter ratio trend data bucketed by day or week.
 *
 * Query params:
 *   - granularity: 'daily' | 'weekly' (default: 'daily')
 *   - period: '30d' | '90d' | '180d' (default: '90d')
 *
 * Returns: array of { date, total, passed, filtered, ratio } sorted oldest-first.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      TrendParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { granularity, period } = parsed.data;

    // Compute cutoff date from period
    const days = period === '30d' ? 30 : period === '90d' ? 90 : 180;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // TODO: Migrate to an RPC function (e.g. get_filter_ratio_trend) when data
    // volume grows beyond ~500 articles/week. Application-level grouping is
    // acceptable at current scale.

    // Fetch (ingested_at, passed) pairs for this workspace within the period
    const { data: articles, error } = await supabase
      .from('feed_articles')
      .select('ingested_at, passed')
      .eq('workspace_id', id)
      .gte('ingested_at', cutoff.toISOString())
      .order('ingested_at', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch trend data' },
        { status: 500 },
      );
    }

    // Group articles by date bucket
    const buckets = new Map<string, { total: number; passed: number }>();

    for (const article of articles ?? []) {
      const date = new Date(article.ingested_at);
      const bucketKey =
        granularity === 'daily' ? formatDateKey(date) : formatWeekKey(date);

      const bucket = buckets.get(bucketKey) ?? { total: 0, passed: 0 };
      bucket.total += 1;
      if (article.passed) bucket.passed += 1;
      buckets.set(bucketKey, bucket);
    }

    // Convert to sorted array (oldest first)
    const trend = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { total, passed }]) => ({
        date,
        total,
        passed,
        filtered: total - passed,
        ratio: total > 0 ? Math.round((passed / total) * 100) : 0,
      }));

    return NextResponse.json(trend);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch trend data') },
      { status: 500 },
    );
  }
}

/** Format a date as YYYY-MM-DD for daily buckets */
function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Format a date as its ISO week start (Monday) YYYY-MM-DD for weekly buckets */
function formatWeekKey(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  // Adjust to Monday (day 1). Sunday (0) maps to previous Monday (-6).
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
