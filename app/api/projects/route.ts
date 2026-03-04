import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ProjectCreateBodySchema } from '@/lib/validation/schemas';

/** GET /api/projects — list projects (active only by default, ?include_archived=true for all) */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const includeArchived =
      request.nextUrl.searchParams.get('include_archived') === 'true';

    let query = supabase.from('projects').select('*').order('name');
    if (!includeArchived) {
      query = query.eq('is_archived', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch projects:', error);
      return NextResponse.json(
        { error: 'Failed to fetch projects' },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch projects') },
      { status: 500 },
    );
  }
}

/** POST /api/projects — create a project */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(ProjectCreateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { name, description, color, icon } = parsed.data;

    const { data, error } = await supabase
      .from('projects')
      .insert({
        name,
        description: description ?? null,
        color: color ?? '#6366f1',
        icon: icon ?? 'folder',
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A project named "${name}" already exists` },
          { status: 409 },
        );
      }
      console.error('Failed to create project:', error);
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create project') },
      { status: 500 },
    );
  }
}
