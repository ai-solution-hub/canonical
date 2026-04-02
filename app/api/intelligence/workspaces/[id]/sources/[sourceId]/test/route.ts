// app/api/intelligence/workspaces/[id]/sources/[sourceId]/test/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { pollFeed } from '@/lib/intelligence/feed-poller';

type RouteContext = { params: Promise<{ id: string; sourceId: string }> };

/** POST /api/intelligence/workspaces/:id/sources/:sourceId/test — test poll a feed source */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id, sourceId } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Fetch the source to get its URL
    const { data: source, error: sourceError } = await supabase
      .from('feed_sources')
      .select('id, url, etag, last_modified')
      .eq('id', sourceId)
      .eq('workspace_id', id)
      .single();

    if (sourceError || !source) {
      return NextResponse.json(
        { error: 'Feed source not found' },
        { status: 404 },
      );
    }

    // Test poll the feed
    const result = await pollFeed(source);

    if (result.status === 'error' || result.status === 'timeout') {
      return NextResponse.json({
        success: false,
        itemCount: 0,
        sampleTitles: [],
        error: result.error ?? `Feed poll returned status: ${result.status}`,
      });
    }

    return NextResponse.json({
      success: true,
      itemCount: result.items.length,
      sampleTitles: result.items.slice(0, 5).map((item) => item.title),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to test feed source') },
      { status: 500 },
    );
  }
}
