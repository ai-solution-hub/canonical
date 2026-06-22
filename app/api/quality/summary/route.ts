import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * GET /api/quality/summary
 *
 * Returns aggregate quality issue counts from ingestion_quality_log
 * using the get_quality_issue_counts() RPC function.
 * Available to all authenticated users.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase.rpc('get_quality_issue_counts');

    if (error) {
      logger.error({ err: error }, 'Quality counts query error');
      return NextResponse.json(
        { error: 'Failed to fetch quality issue counts' },
        { status: 500 },
      );
    }

    const counts = (data ?? []) as Array<{
      flag_type: string;
      severity: string;
      open_count: number;
    }>;

    const totalOpen = counts.reduce((sum, r) => sum + r.open_count, 0);
    const byType: Record<string, number> = {};
    for (const r of counts) {
      byType[r.flag_type] = (byType[r.flag_type] ?? 0) + r.open_count;
    }

    return NextResponse.json({
      total_open: totalOpen,
      by_type: byType,
      details: counts,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch quality statistics') },
      { status: 500 },
    );
  }
}
