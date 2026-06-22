import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import { PipelineRunsParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 15;

// Array of pipeline_runs rows for the selected columns. Nullability per the
// pipeline_runs table (squash_baseline migration): id/pipeline_name/status/
// started_at/created_at are NOT NULL; the rest are nullable. progress is jsonb
// → opaque.
const PipelineRunsResponseSchema = z.array(
  z.object({
    id: z.string(),
    pipeline_name: z.string(),
    status: z.string(),
    progress: z.unknown(), // jsonb column — opaque Json
    source_filename: z.string().nullable(),
    items_created: z.array(z.string()).nullable(),
    items_processed: z.number().nullable(),
    workspace_id: z.string().nullable(),
    error_message: z.string().nullable(),
    started_at: z.string(),
    completed_at: z.string().nullable(),
    created_at: z.string(),
    created_by: z.string().nullable(),
  }),
);

export const GET = defineRoute(
  PipelineRunsResponseSchema,
  async (request: NextRequest) => {
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
  },
);
