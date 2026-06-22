import { defineRoute } from "@/lib/api/define-route";
import {
    authFailureResponse,
    getAuthenticatedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import { CoverageMatrixParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from "zod";

export const maxDuration = 30;

const CoverageMatrixResponseSchema = z.object({
  matrix: z.array(z.unknown()), // get_coverage_matrix RPC Json rows
  summary: z.array(z.unknown()), // get_coverage_summary RPC Json rows
});

export const GET = defineRoute(CoverageMatrixResponseSchema, async (request: NextRequest) => {
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
      logger.error({ err: matrixResult.error }, 'Coverage matrix RPC error');
      return NextResponse.json({ error: 'Failed to load coverage data' }, { status: 500 });
    }

    if (summaryResult.error) {
      logger.error({ err: summaryResult.error }, 'Coverage summary RPC error');
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
});
