import { NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

/**
 * POST /api/freshness/recalculate-all
 *
 * Recalculate freshness for ALL content items via the
 * `recalculate_all_freshness()` PostgreSQL function (runs entirely in SQL).
 * Admin-only. No request body required.
 */
export async function POST() {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase.rpc('recalculate_all_freshness');

    if (error) {
      console.error('Failed to recalculate freshness:', error);
      return NextResponse.json(
        { error: 'Failed to recalculate freshness' },
        { status: 500 },
      );
    }

    // The RPC returns a single-row table with summary counts
    const result = Array.isArray(data) ? data[0] : data;

    return NextResponse.json({
      updated: result?.total_count ?? 0,
      total: result?.total_count ?? 0,
      summary: {
        fresh: result?.fresh_count ?? 0,
        aging: result?.aging_count ?? 0,
        stale: result?.stale_count ?? 0,
        expired: result?.expired_count ?? 0,
      },
      recalculated_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to recalculate freshness') },
      { status: 500 },
    );
  }
}
