import { NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DomainStats {
  domain: string;
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
  unique_items_cited: number;
  unique_bids: number;
}

interface OverallStats {
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
  unique_items_cited: number;
  unique_bids: number;
}

interface AggregateWinRateResponse {
  overall: OverallStats;
  by_domain: DomainStats[];
}

// ---------------------------------------------------------------------------
// GET /api/analytics/win-rate
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // Auth — any authenticated user may read
    const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Call the aggregate RPC
    const { data, error } = await supabase.rpc('get_aggregate_win_rate_stats');

    if (error) {
      console.error('get_aggregate_win_rate_stats RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch aggregate win-rate data' },
        { status: 500 },
      );
    }

    const rows = Array.isArray(data) ? data : [];

    // Separate overall from domain rows
    const overallRow = rows.find(
      (r: { scope: string }) => r.scope === 'overall',
    );
    const domainRows = rows.filter(
      (r: { scope: string }) => r.scope !== 'overall',
    );

    // Build overall stats (default to zeros if no overall row)
    const overall: OverallStats = {
      total_citations: Number(overallRow?.total_citations ?? 0),
      winning_citations: Number(overallRow?.winning_citations ?? 0),
      losing_citations: Number(overallRow?.losing_citations ?? 0),
      pending_citations: Number(overallRow?.pending_citations ?? 0),
      win_rate: Number(overallRow?.win_rate ?? 0),
      unique_items_cited: Number(overallRow?.unique_items_cited ?? 0),
      unique_bids: Number(overallRow?.unique_bids ?? 0),
    };

    // Build domain stats, sorted by win_rate descending (not alphabetical)
    const by_domain: DomainStats[] = domainRows
      .map(
        (r: {
          scope: string;
          total_citations: unknown;
          winning_citations: unknown;
          losing_citations: unknown;
          pending_citations: unknown;
          win_rate: unknown;
          unique_items_cited: unknown;
          unique_bids: unknown;
        }) => ({
          domain: r.scope,
          total_citations: Number(r.total_citations ?? 0),
          winning_citations: Number(r.winning_citations ?? 0),
          losing_citations: Number(r.losing_citations ?? 0),
          pending_citations: Number(r.pending_citations ?? 0),
          win_rate: Number(r.win_rate ?? 0),
          unique_items_cited: Number(r.unique_items_cited ?? 0),
          unique_bids: Number(r.unique_bids ?? 0),
        }),
      )
      .sort((a: DomainStats, b: DomainStats) => b.win_rate - a.win_rate);

    const response: AggregateWinRateResponse = { overall, by_domain };

    return NextResponse.json(response);
  } catch (err) {
    console.error('Win-rate analytics route error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
