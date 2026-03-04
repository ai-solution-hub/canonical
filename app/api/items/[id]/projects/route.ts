import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ItemProjectBodySchema, ProjectCreateBodySchema } from '@/lib/validation/schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/items/[id]/projects — list projects for an item */
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

    const { data, error } = await supabase.rpc('get_item_projects', {
      p_item_id: id,
    });

    if (error) {
      console.error('Failed to fetch item projects:', error);
      return NextResponse.json(
        { error: 'Failed to fetch item projects' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch item projects') },
      { status: 500 },
    );
  }
}

/** POST /api/items/[id]/projects — assign or unassign a project, or create+assign inline */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
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
      const parsed = parseBody(ProjectCreateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      // Create the project
      const { data: project, error: createError } = await supabase
        .from('projects')
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
            { error: `A project named "${parsed.data.name}" already exists` },
            { status: 409 },
          );
        }
        console.error('Failed to create project:', createError);
        return NextResponse.json(
          { error: 'Failed to create project' },
          { status: 500 },
        );
      }

      // Assign the new project to the item
      const { error: assignError } = await supabase
        .from('content_item_projects')
        .insert({
          content_item_id: id,
          project_id: project.id,
        });

      if (assignError) {
        console.error('Failed to assign project:', assignError);
        return NextResponse.json(
          { error: 'Project created but failed to assign to item' },
          { status: 500 },
        );
      }

      return NextResponse.json(project, { status: 201 });
    }

    // Standard assign/unassign
    const parsed = parseBody(ItemProjectBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { project_id, action } = parsed.data;

    if (action === 'assign') {
      const { error } = await supabase
        .from('content_item_projects')
        .insert({
          content_item_id: id,
          project_id,
        });

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'Project already assigned to this item' },
            { status: 409 },
          );
        }
        console.error('Failed to assign project:', error);
        return NextResponse.json(
          { error: 'Failed to assign project' },
          { status: 500 },
        );
      }
    } else {
      const { error } = await supabase
        .from('content_item_projects')
        .delete()
        .eq('content_item_id', id)
        .eq('project_id', project_id);

      if (error) {
        console.error('Failed to unassign project:', error);
        return NextResponse.json(
          { error: 'Failed to unassign project' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update item projects') },
      { status: 500 },
    );
  }
}
