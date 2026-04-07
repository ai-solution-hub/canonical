import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { CoverageMatrixParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(CoverageMatrixParamsSchema, request.nextUrl.searchParams);
    if (!parsed.success) return parsed.response;
    const { layer } = parsed.data;

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
