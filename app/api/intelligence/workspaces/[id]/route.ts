// app/api/intelligence/workspaces/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { IntelligenceWorkspaceUpdateSchema } from '@/lib/validation/schemas';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/intelligence/workspaces/:id — get a single intelligence workspace */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
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
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Fetch linked company profile name
    const meta = workspace.domain_metadata as Record<string, unknown> | null;
    const profileId = meta?.company_profile_id as string | undefined;
    let companyProfileName: string | null = null;

    if (profileId) {
      const { data: profile } = await supabase
        .from('company_profiles')
        .select('name')
        .eq('id', profileId)
        .single();
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
export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(IntelligenceWorkspaceUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const updateData = parsed.data;
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('workspaces')
      .update(updateData)
      .eq('id', id)
      .eq('type', 'intelligence')
      .eq('is_archived', false)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update workspace') },
      { status: 500 },
    );
  }
}
