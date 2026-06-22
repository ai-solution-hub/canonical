import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import { PipelineRunsParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 15;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase, role } = auth;

    const parsed = parseSearchParams(
      PipelineRunsParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { limit, pipeline_name: pipelineName, status, all } = parsed.data;
    const showAll = all === true && role === 'admin';

    let query = supabase
      .from('pipeline_runs')
      .select(
        'id, pipeline_name, status, progress, source_filename, items_created, items_processed, workspace_id, error_message, started_at, completed_at, created_at, created_by',
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    // Scope to user unless admin requesting all
    if (!showAll) {
      query = query.eq('created_by', user.id);
    }

    if (pipelineName) {
      query = query.eq('pipeline_name', pipelineName);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ err: error }, 'Failed to fetch pipeline runs');
      return NextResponse.json(
        { error: 'Failed to fetch pipeline runs' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch pipeline runs') },
      { status: 500 },
    );
  }
});
