import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { PipelineRunsParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 15;

/**
 * GET /api/pipeline-runs
 *
 * Retrieve recent pipeline runs for the authenticated user.
 * Editors and admins can see their own runs. Admins can optionally
 * see all runs via ?all=true.
 *
 * Query params:
 *   - limit: number of results (default 20, max 100)
 *   - pipeline_name: filter by pipeline name (e.g. 'file_upload')
 *   - status: filter by status (e.g. 'running', 'completed', 'failed')
 *   - all: if 'true' and user is admin, return all users' runs
 */
export async function GET(request: NextRequest) {
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
      console.error('Failed to fetch pipeline runs:', error);
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
}
