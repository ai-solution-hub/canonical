import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ProjectUpdateBodySchema } from '@/lib/validation/schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/projects/[id] — update a project */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid project ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(ProjectUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString(), updated_by: user.id };

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A project with that name already exists' },
          { status: 409 },
        );
      }
      console.error('Failed to update project:', error);
      return NextResponse.json(
        { error: 'Failed to update project' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update project') },
      { status: 500 },
    );
  }
}

/** DELETE /api/projects/[id] — archive (soft delete) or ?permanent=true for hard delete */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid project ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const permanent =
      request.nextUrl.searchParams.get('permanent') === 'true';

    if (permanent) {
      // Check for assigned items first
      const { count } = await supabase
        .from('content_item_projects')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', id);

      if (count && count > 0) {
        return NextResponse.json(
          {
            error:
              'Cannot delete a project with assigned items. Remove all items first.',
          },
          { status: 409 },
        );
      }

      // Hard delete
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Failed to delete project:', error);
        return NextResponse.json(
          { error: 'Failed to delete project' },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true });
    }

    // Soft delete (archive)
    const { data: archived, error } = await supabase
      .from('projects')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single();

    if (error || !archived) {
      if (!archived && !error) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 },
        );
      }
      console.error('Failed to archive project:', error);
      return NextResponse.json(
        { error: 'Failed to archive project' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete project') },
      { status: 500 },
    );
  }
}
