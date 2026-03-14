import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse, getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ItemWorkspaceBodySchema, WorkspaceCreateBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/items/[id]/workspaces — list workspaces for an item */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc('get_item_workspaces', {
      p_item_id: id,
    });

    if (error) {
      console.error('Failed to fetch item workspaces:', error);
      return NextResponse.json(
        { error: 'Failed to fetch item workspaces' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch item workspaces') },
      { status: 500 },
    );
  }
}

/** POST /api/items/[id]/workspaces — assign or unassign a workspace, or create+assign inline */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();

    // Check if this is a create+assign request
    if (raw.create) {
      const parsed = parseBody(WorkspaceCreateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      // Create the workspace
      const { data: workspace, error: createError } = await supabase
        .from('workspaces')
        .insert({
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          color: parsed.data.color ?? '#6366f1',
          icon: parsed.data.icon ?? 'folder',
          created_by: user.id,
        })
        .select()
        .single();

      if (createError) {
        if (createError.code === '23505') {
          return NextResponse.json(
            { error: `A workspace named "${parsed.data.name}" already exists` },
            { status: 409 },
          );
        }
        console.error('Failed to create workspace:', createError);
        return NextResponse.json(
          { error: 'Failed to create workspace' },
          { status: 500 },
        );
      }

      // Assign the new workspace to the item
      const { error: assignError } = await supabase
        .from('content_item_workspaces')
        .insert({
          content_item_id: id,
          workspace_id: workspace.id,
        });

      if (assignError) {
        console.error('Failed to assign workspace:', assignError);
        return NextResponse.json(
          { error: 'Workspace created but failed to assign to item' },
          { status: 500 },
        );
      }

      return NextResponse.json(workspace, { status: 201 });
    }

    // Standard assign/unassign
    const parsed = parseBody(ItemWorkspaceBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { workspace_id, action } = parsed.data;

    if (action === 'assign') {
      const { error } = await supabase
        .from('content_item_workspaces')
        .insert({
          content_item_id: id,
          workspace_id,
        });

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'Workspace already assigned to this item' },
            { status: 409 },
          );
        }
        console.error('Failed to assign workspace:', error);
        return NextResponse.json(
          { error: 'Failed to assign workspace' },
          { status: 500 },
        );
      }
    } else {
      const { error } = await supabase
        .from('content_item_workspaces')
        .delete()
        .eq('content_item_id', id)
        .eq('workspace_id', workspace_id);

      if (error) {
        console.error('Failed to unassign workspace:', error);
        return NextResponse.json(
          { error: 'Failed to unassign workspace' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update item workspaces') },
      { status: 500 },
    );
  }
}
