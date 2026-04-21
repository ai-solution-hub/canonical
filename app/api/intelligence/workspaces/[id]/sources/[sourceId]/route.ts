// app/api/intelligence/workspaces/[id]/sources/[sourceId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { FeedSourceUpdateSchema } from '@/lib/validation/schemas';

type RouteContext = { params: Promise<{ id: string; sourceId: string }> };

/** GET /api/intelligence/workspaces/:id/sources/:sourceId — get a single feed source */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id, sourceId } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('feed_sources')
      .select('*')
      .eq('id', sourceId)
      .eq('workspace_id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Feed source not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch feed source') },
      { status: 500 },
    );
  }
}

/** PATCH /api/intelligence/workspaces/:id/sources/:sourceId — update a feed source */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id, sourceId } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(FeedSourceUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    // F-3 / D-4: Reset consecutive_failures when re-enabling a source.
    // Check raw body (not parsed) — Zod .default(true) fires even when is_active
    // is absent, so parsed.data.is_active is always true. We only want to reset
    // failures when the caller explicitly sends is_active: true.
    let updatePayload = { ...parsed.data };
    if (raw.is_active === true) {
      const { data: current, error: lookupError } = await supabase
        .from('feed_sources')
        .select('is_active')
        .eq('id', sourceId)
        .eq('workspace_id', id)
        .single();

      if (!lookupError && current && current.is_active === false) {
        updatePayload = { ...updatePayload, consecutive_failures: 0 };
      }
    }

    const { data, error } = await supabase
      .from('feed_sources')
      .update(updatePayload)
      .eq('id', sourceId)
      .eq('workspace_id', id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Feed source not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update feed source') },
      { status: 500 },
    );
  }
}

/** DELETE /api/intelligence/workspaces/:id/sources/:sourceId — soft-delete (archive) a feed source */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id, sourceId } = await context.params;
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Check for hard delete confirmation
    const { searchParams } = new URL(request.url);
    const confirmHardDelete = searchParams.get('confirm') === 'hard_delete';

    if (confirmHardDelete) {
      // Hard delete — permanently removes the source and cascades
      const { error } = await supabase
        .from('feed_sources')
        .delete()
        .eq('id', sourceId)
        .eq('workspace_id', id);

      if (error) {
        return NextResponse.json(
          { error: 'Failed to delete feed source' },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true, action: 'hard_delete' });
    }

    // Soft delete (default) — set is_active = false
    const { data, error } = await supabase
      .from('feed_sources')
      .update({ is_active: false })
      .eq('id', sourceId)
      .eq('workspace_id', id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Feed source not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, action: 'archived' });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete feed source') },
      { status: 500 },
    );
  }
}
