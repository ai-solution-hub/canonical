import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 30;

// ──────────────────────────────────────────
// GET /api/jobs/:id/status -- poll job status
// ──────────────────────────────────────────

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: jobId } = await params;
      if (!UUID_RE.test(jobId)) {
        return NextResponse.json(
          { error: 'Invalid job ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const { data: job, error } = await supabase
        .from('processing_queue')
        .select(
          'id, job_type, status, payload, result, error_message, created_at, started_at, completed_at',
        )
        .eq('id', jobId)
        .single();

      if (error || !job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json(job);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch job status') },
        { status: 500 },
      );
    }
  },
);
