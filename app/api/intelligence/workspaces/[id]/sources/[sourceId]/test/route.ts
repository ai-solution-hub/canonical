// app/api/intelligence/workspaces/[id]/sources/[sourceId]/test/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { pollFeed, pollWebSource } from '@/lib/intelligence/feed-poller';
import { TestPollResultSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string; sourceId: string }> };

export const POST = defineRoute(
  TestPollResultSchema,
  async (_request: NextRequest, context: RouteContext) => {
    try {
      const { id, sourceId } = await context.params;
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      // Fetch the source to get its URL and type
      const { data: source, error: sourceError } = await supabase
        .from('feed_sources')
        .select('id, url, etag, last_modified, source_type')
        .eq('id', sourceId)
        .eq('workspace_id', id)
        .single();

      if (sourceError || !source) {
        return NextResponse.json(
          { error: 'Feed source not found' },
          { status: 404 },
        );
      }

      // Branch on source_type: rss → pollFeed, web → pollWebSource
      const sourceType = source.source_type ?? 'rss';

      if (sourceType === 'api') {
        return NextResponse.json(
          {
            error: 'Test polling is not yet supported for API sources',
            source_type: sourceType,
          },
          { status: 501 },
        );
      }

      if (sourceType === 'web') {
        // S222 W3-A §2.3.4: pass `dryRun: true` so any future side-effect
        // bookkeeping inside pollWebSource is suppressed (admin-initiated
        // test must not affect `consecutive_failures` per AC-10). The route
        // itself does NOT call updateSourceAfterPoll for the test path —
        // that responsibility lives in pipeline.ts processFeedSource.
        const result = await pollWebSource(source, { dryRun: true });

        // AC-12: HEAD-304 short-circuits at zero credit; otherwise the
        // Firecrawl call is attempted (1 credit). The response field is a
        // *prediction* — a real poll cycle would burn this many credits
        // for this source under current state.
        const firecrawlCreditsExpected: 0 | 1 = result.firecrawlCalled ? 1 : 0;

        if (result.status === 'error' || result.status === 'timeout') {
          return NextResponse.json({
            success: false,
            itemCount: 0,
            sampleTitles: [],
            headPreflightStatus: result.headPreflightStatus,
            firecrawlCreditsExpected,
            error:
              result.error ?? `Feed poll returned status: ${result.status}`,
          });
        }

        return NextResponse.json({
          success: true,
          itemCount: result.items.length,
          sampleTitles: result.items.slice(0, 5).map((item) => item.title),
          headPreflightStatus: result.headPreflightStatus,
          firecrawlCreditsExpected,
        });
      }

      // RSS path (sourceType === 'rss')
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
  },
);
