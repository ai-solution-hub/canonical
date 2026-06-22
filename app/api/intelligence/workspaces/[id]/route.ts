// app/api/intelligence/workspaces/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { IntelligenceWorkspaceUpdateSchema } from '@/lib/validation/schemas';
import {
  INTELLIGENCE_WORKSPACE_SELECT,
  extractContextFromSatellite,
} from '@/lib/intelligence/workspace-context';

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
      .select(INTELLIGENCE_WORKSPACE_SELECT)
      .eq('id', id)
      .eq('application_types.key', 'intelligence')
      .eq('is_archived', false)
      .single();

    if (error || !workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 },
      );
    }

    // Project typed top-level context from the satellite JOIN result.
    const workspaceContext = extractContextFromSatellite(
      workspace.intelligence_workspaces,
    );
    let companyProfileName: string | null = null;

    if (workspaceContext.companyProfileId) {
      const profile = await sb(
        supabase
          .from('company_profiles')
          .select('name')
          .eq('id', workspaceContext.companyProfileId)
          .maybeSingle(),
        'company_profiles.byId',
      );
      companyProfileName = profile?.name ?? null;
    }

    // Drop the joined projections from the response shape — callers consume
    // the flat typed fields.
    const {
      application_types: _appTypes,
      intelligence_workspaces: _intelSat,
      ...wsRest
    } = workspace;

    return NextResponse.json({
      ...wsRest,
      company_profile_id: workspaceContext.companyProfileId,
      guide_id: workspaceContext.guideId,
      relevance_threshold: workspaceContext.relevanceThreshold,
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

    // Workspace access check — must be an intelligence workspace, not archived.
    // 404 on miss (signals access denied to non-admin/editor too; not leaking
    // existence).
    const { data: existingWorkspace, error: existingError } = await supabase
      .from('workspaces')
      .select('id, application_types!inner(key)')
      .eq('id', id)
      .eq('application_types.key', 'intelligence')
      .eq('is_archived', false)
      .maybeSingle();
    if (existingError || !existingWorkspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 },
      );
    }

    // Apply direct field changes to workspaces (name, description, etc.).
    if (Object.keys(directFields).length > 0) {
      const { error: directError } = await supabase
        .from('workspaces')
        .update(directFields)
        .eq('id', id);
      if (directError) {
        return NextResponse.json(
          { error: 'Failed to update workspace' },
          { status: 500 },
        );
      }
    }

    // Apply relevance_threshold to the intelligence_workspaces satellite (typed
    // column UPDATE — no JSONB merge needed post-T2).
    if (relevance_threshold !== undefined) {
      const { error: satelliteError } = await supabase
        .from('intelligence_workspaces')
        .update({ relevance_threshold })
        .eq('workspace_id', id);
      if (satelliteError) {
        return NextResponse.json(
          { error: 'Failed to update relevance threshold' },
          { status: 500 },
        );
      }
    }

    // Re-fetch the workspace + satellite for the response shape.
    const { data: refreshed, error: refreshError } = await supabase
      .from('workspaces')
      .select(INTELLIGENCE_WORKSPACE_SELECT)
      .eq('id', id)
      .single();
    if (refreshError || !refreshed) {
      return NextResponse.json(
        { error: 'Failed to refresh workspace after update' },
        { status: 500 },
      );
    }

    const updatedContext = extractContextFromSatellite(
      refreshed.intelligence_workspaces,
    );

    const {
      application_types: _appTypes,
      intelligence_workspaces: _intelSat,
      ...refreshedRest
    } = refreshed;

    return NextResponse.json({
      ...refreshedRest,
      company_profile_id: updatedContext.companyProfileId,
      guide_id: updatedContext.guideId,
      relevance_threshold: updatedContext.relevanceThreshold,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update workspace') },
      { status: 500 },
    );
  }
}
