import { NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';

export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    // Fetch all stats in parallel
    const [totalResult, verifiedResult, recentResult, domainResult] =
      await Promise.all([
        // Total item count
        supabase
          .from('content_items')
          .select('*', { count: 'exact', head: true }),
        // Verified item count
        supabase
          .from('content_items')
          .select('*', { count: 'exact', head: true })
          .not('verified_at', 'is', null),
        // Recent items (last 7 days)
        supabase
          .from('content_items')
          .select('*', { count: 'exact', head: true })
          .gte(
            'captured_date',
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          ),
        // Domain breakdown
        supabase.rpc('get_filter_counts'),
      ]);

    const totalItems = totalResult.count ?? 0;
    const verifiedItems = verifiedResult.count ?? 0;
    const recentItems = recentResult.count ?? 0;

    // Parse domain counts from filter counts RPC
    let domainCounts: Record<string, number> = {};
    if (domainResult.data && typeof domainResult.data === 'object') {
      const filterCounts = domainResult.data as Record<
        string,
        Record<string, number>
      >;
      domainCounts = filterCounts.domain ?? {};
    }

    const domainCount = Object.keys(domainCounts).filter(
      (k) => domainCounts[k] > 0,
    ).length;

    const verifiedPercentage =
      totalItems > 0 ? Math.round((verifiedItems / totalItems) * 100) : 0;

    return NextResponse.json({
      totalItems,
      verifiedItems,
      verifiedPercentage,
      recentItems,
      domainCount,
      domainCounts,
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 },
    );
  }
}
