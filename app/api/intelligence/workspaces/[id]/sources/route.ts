// app/api/intelligence/workspaces/[id]/sources/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { FeedSourceCreateSchema } from '@/lib/validation/schemas';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/intelligence/workspaces/:id/sources — list feed sources for workspace */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('feed_sources')
      .select('*')
      .eq('workspace_id', id)
      .order('name');

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch feed sources' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch feed sources') },
      { status: 500 },
    );
  }
}

/** POST /api/intelligence/workspaces/:id/sources — create a feed source */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const raw = await request.json();
    const parsed = parseBody(FeedSourceCreateSchema, raw);
    if (!parsed.success) return parsed.response;

    // Verify workspace exists and is intelligence type
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id, type')
      .eq('id', id)
      .eq('type', 'intelligence')
      .eq('is_archived', false)
      .single();

    if (wsError || !workspace) {
      return NextResponse.json(
        { error: 'Intelligence workspace not found' },
        { status: 404 },
      );
    }

    const { data, error } = await supabase
      .from('feed_sources')
      .insert({
        ...parsed.data,
        workspace_id: id,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to create feed source' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create feed source') },
      { status: 500 },
    );
  }
}
