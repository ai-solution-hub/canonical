// app/api/intelligence/workspaces/[id]/health/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import {
  getPipelineHealth,
  getSourceHealthSummary,
} from '@/lib/intelligence/health';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/intelligence/workspaces/:id/health — pipeline + source health */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: workspaceId } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Verify workspace exists and user has access
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();

    if (wsError || !workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 },
      );
    }

    // Fetch both pipeline-wide health and workspace-specific source health
    const [pipelineHealth, sourceHealth] = await Promise.all([
      getPipelineHealth(supabase),
      getSourceHealthSummary(supabase, workspaceId),
    ]);

    return NextResponse.json({
      pipeline: pipelineHealth,
      sources: sourceHealth,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch pipeline health') },
      { status: 500 },
    );
  }
}
