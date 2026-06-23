// app/api/intelligence/workspaces/[id]/articles/[articleId]/flag/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { FeedFlagCreateSchema, FeedFlagSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string; articleId: string }> };

export const POST = defineRoute(
  FeedFlagSchema,
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { articleId } = await context.params;
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase, user } = auth;

      const raw = await request.json();
      const parsed = parseBody(FeedFlagCreateSchema, raw);
      if (!parsed.success) return parsed.response;

      // Fetch the article to get prompt_version_id
      const { data: article, error: articleError } = await supabase
        .from('feed_articles')
        .select('id, prompt_version_id')
        .eq('id', articleId)
        .single();

      if (articleError || !article) {
        return NextResponse.json(
          { error: 'Article not found' },
          { status: 404 },
        );
      }

      const { data, error } = await supabase
        .from('feed_flags')
        .insert({
          feed_article_id: articleId,
          flagged_by: user.id,
          flag_type: parsed.data.flag_type,
          notes: parsed.data.notes ?? null,
          prompt_version_id: (article as { prompt_version_id: string | null })
            .prompt_version_id,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { error: 'Failed to create flag' },
          { status: 500 },
        );
      }

      return NextResponse.json(data, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create flag') },
        { status: 500 },
      );
    }
  },
);

export const GET = defineRoute(
  z.unknown(),
  async (_request: NextRequest, context: RouteContext) => {
    try {
      const { articleId } = await context.params;
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { data, error } = await supabase
        .from('feed_flags')
        .select('*')
        .eq('feed_article_id', articleId)
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch flags' },
          { status: 500 },
        );
      }

      return NextResponse.json(data ?? []);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch flags') },
        { status: 500 },
      );
    }
  },
);
