import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const layer = request.nextUrl.searchParams.get('layer') || undefined;

    // Fetch matrix and summary in parallel
    const [matrixResult, summaryResult] = await Promise.all([
      supabase.rpc('get_coverage_matrix', { p_layer: layer }),
      supabase.rpc('get_coverage_summary'),
    ]);

    if (matrixResult.error) {
      console.error('Coverage matrix RPC error:', matrixResult.error);
      return NextResponse.json({ error: 'Failed to load coverage data' }, { status: 500 });
    }

    if (summaryResult.error) {
      console.error('Coverage summary RPC error:', summaryResult.error);
      return NextResponse.json({ error: 'Failed to load coverage summary' }, { status: 500 });
    }

    return NextResponse.json({
      matrix: matrixResult.data ?? [],
      summary: summaryResult.data ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Coverage data failed') },
      { status: 500 },
    );
  }
}
