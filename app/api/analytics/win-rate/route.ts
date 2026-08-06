import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// (DomainStats deleted — id-417 / DR-130: the per-domain win-rate scope
// stood on record_lifecycle.domain, dropped; get_aggregate_win_rate_stats
// now returns the 'overall' scope row only.)

interface OverallStats {
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
  unique_items_cited: number;
  unique_procurements: number;
  // ID-130 T-B7 — separate shortlist pass-rate (see DomainStats).
  shortlist_total: number;
  shortlist_passed: number;
  shortlist_pass_rate: number;
}

interface AggregateWinRateResponse {
  overall: OverallStats;
}

// ---------------------------------------------------------------------------
// GET /api/analytics/win-rate
// ---------------------------------------------------------------------------

const WinRateStatsSchema = z.object({
  total_citations: z.number(),
  winning_citations: z.number(),
  losing_citations: z.number(),
  pending_citations: z.number(),
  win_rate: z.number(),
  unique_items_cited: z.number(),
  unique_procurements: z.number(),
  // ID-130 T-B7 — separate shortlist pass-rate fields.
  shortlist_total: z.number(),
  shortlist_passed: z.number(),
  shortlist_pass_rate: z.number(),
});
const WinRateResponseSchema = z.object({
  overall: WinRateStatsSchema,
});
export const GET = defineRoute(WinRateResponseSchema, async () => {
  try {
    // Auth — any authenticated user may read
    const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Call the aggregate RPC
    const { data, error } = await supabase.rpc('get_aggregate_win_rate_stats');

    if (error) {
      logger.error({ err: error }, 'get_aggregate_win_rate_stats RPC error');
      return NextResponse.json(
        { error: 'Failed to fetch aggregate win-rate data' },
        { status: 500 },
      );
    }

    // ID-130 T-B7 — the rewritten get_aggregate_win_rate_stats RPC gains shortlist
    // pass-rate columns (shortlist_total/passed/pass_rate). The generated RPC row type
    // does not carry them until the {130.9} types regen, so read rows through a permissive
    // record shape (the values are coerced via Number(... ?? 0) below). `scope` stays typed
    // for the overall-vs-domain discrimination.
    type WinRateRow = Record<string, unknown> & { scope: string };
    const rows = (Array.isArray(data) ? data : []) as unknown as WinRateRow[];

    // id-417 / DR-130: the RPC returns the 'overall' scope row only (the
    // per-domain scope retired with record_lifecycle.domain).
    const overallRow = rows.find((r) => r.scope === 'overall');

    // Build overall stats (default to zeros if no overall row)
    const overall: OverallStats = {
      total_citations: Number(overallRow?.total_citations ?? 0),
      winning_citations: Number(overallRow?.winning_citations ?? 0),
      losing_citations: Number(overallRow?.losing_citations ?? 0),
      pending_citations: Number(overallRow?.pending_citations ?? 0),
      win_rate: Number(overallRow?.win_rate ?? 0),
      unique_items_cited: Number(overallRow?.unique_items_cited ?? 0),
      unique_procurements: Number(overallRow?.unique_procurements ?? 0),
      shortlist_total: Number(overallRow?.shortlist_total ?? 0),
      shortlist_passed: Number(overallRow?.shortlist_passed ?? 0),
      shortlist_pass_rate: Number(overallRow?.shortlist_pass_rate ?? 0),
    };

    const response: AggregateWinRateResponse = { overall };

    return NextResponse.json(response);
  } catch (err) {
    logger.error({ err }, 'Win-rate analytics route error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
});
