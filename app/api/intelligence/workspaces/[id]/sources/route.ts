// app/api/intelligence/workspaces/[id]/sources/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBodyAsync } from '@/lib/validation';
import { FeedSourceCreateSchema } from '@/lib/validation/schemas';
import { validateFeedUrl } from '@/lib/intelligence/feed-poller';

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
    // S222 W3-A §2.3.4 D-4: schema is now async (web source-type triggers
    // `validateWebUrl` HEAD pre-flight). Use `parseBodyAsync` rather than
    // the synchronous `parseBody` helper.
    const parsed = await parseBodyAsync(FeedSourceCreateSchema, raw);
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

    // SI-M5: Validate feed URL before inserting
    if (parsed.data.source_type === 'rss' || !parsed.data.source_type) {
      const validation = await validateFeedUrl(parsed.data.url);
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: `Invalid feed URL: ${validation.error}`,
            details: {
              url: parsed.data.url,
              suggestion:
                'Ensure the URL points to a valid RSS or Atom feed. You can test by opening the URL in a browser — it should show XML content.',
            },
          },
          { status: 400 },
        );
      }

      // Use the feed title as the source name if none was provided, and include feed info
      const feedTitle = validation.title;
      const articleCount = validation.articleCount ?? 0;

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

      return NextResponse.json(
        { ...data, feed_title: feedTitle, initial_article_count: articleCount },
        { status: 201 },
      );
    }

    // Non-RSS sources (web, api) — skip feed validation
    // Web sources default to 360-min polling (6h) unless explicitly overridden
    const insertData = {
      ...parsed.data,
      workspace_id: id,
      created_by: user.id,
      ...(parsed.data.source_type === 'web' &&
        !raw.polling_interval_minutes && {
          polling_interval_minutes: 360,
        }),
    };

    const { data, error } = await supabase
      .from('feed_sources')
      .insert(insertData)
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
