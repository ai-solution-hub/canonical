// app/api/intelligence/workspaces/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { IntelligenceWorkspaceUpdateSchema } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update'];

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/intelligence/workspaces/:id — get a single intelligence workspace */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', id)
      .eq('type', 'intelligence')
      .eq('is_archived', false)
      .single();

    if (error || !workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 },
      );
    }

    // Fetch linked company profile name
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const profileId = meta?.company_profile_id as string | undefined;
    let companyProfileName: string | null = null;

    if (profileId) {
      const profile = await sb(
        supabase
          .from('company_profiles')
          .select('name')
          .eq('id', profileId)
          .maybeSingle(),
        'company_profiles.byId',
      );
      companyProfileName = profile?.name ?? null;
    }

    return NextResponse.json({
      ...workspace,
      company_profile_name: companyProfileName,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch workspace') },
      { status: 500 },
    );
  }
}

/** PATCH /api/intelligence/workspaces/:id — update a workspace */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, role } = auth;

    const raw = await request.json();
    const parsed = parseBody(IntelligenceWorkspaceUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { relevance_threshold, ...directFields } = parsed.data;

    if (
      Object.keys(directFields).length === 0 &&
      relevance_threshold === undefined
    ) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 },
      );
    }

    // SI-L5: relevance_threshold is admin-only because it changes pipeline behaviour.
    if (relevance_threshold !== undefined && role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can change the relevance threshold' },
        { status: 403 },
      );
    }

    // Build the database update payload. Direct columns are passed through;
    // relevance_threshold is merged into the existing domain_metadata JSONB.
    const updatePayload: WorkspaceUpdate = { ...directFields };

    if (relevance_threshold !== undefined) {
      // Fetch the current workspace to merge into existing domain_metadata
      // (avoid clobbering company_profile_id, guide_id, etc.).
      const { data: existing, error: fetchError } = await supabase
        .from('workspaces')
        .select('domain_metadata')
        .eq('id', id)
        .eq('type', 'intelligence')
        .eq('is_archived', false)
        .single();

      if (fetchError || !existing) {
        return NextResponse.json(
          { error: 'Workspace not found' },
          { status: 404 },
        );
      }

      const currentMeta = (existing.domain_metadata ?? {}) as Record<
        string,
        unknown
      >;
      updatePayload.domain_metadata = {
        ...currentMeta,
        relevance_threshold,
      };
    }

    const { data, error } = await supabase
      .from('workspaces')
      .update(updatePayload)
      .eq('id', id)
      .eq('type', 'intelligence')
      .eq('is_archived', false)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update workspace') },
      { status: 500 },
    );
  }
}
