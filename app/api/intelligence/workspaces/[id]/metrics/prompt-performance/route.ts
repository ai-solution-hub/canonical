// app/api/intelligence/workspaces/[id]/metrics/prompt-performance/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { sb } from '@/lib/supabase/safe';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (_request: NextRequest, context: RouteContext) => {
    try {
      const { id } = await context.params;
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      // Fetch all prompt versions for this workspace
      const { data: prompts, error: promptsError } = await supabase
        .from('feed_prompts')
        .select('id, version, is_active, change_notes, created_at')
        .eq('workspace_id', id)
        .order('version', { ascending: false });

      if (promptsError) {
        return NextResponse.json(
          { error: 'Failed to fetch prompt versions' },
          { status: 500 },
        );
      }

      if (!prompts || prompts.length === 0) {
        return NextResponse.json([]);
      }

      // For each prompt version, count articles and flags
      const results = await Promise.all(
        prompts.map(async (prompt) => {
          // Count articles scored with this prompt version
          const { count: totalArticles } = await supabase
            .from('feed_articles')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', id)
            .eq('prompt_version_id', prompt.id);

          const { count: passedArticles } = await supabase
            .from('feed_articles')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', id)
            .eq('prompt_version_id', prompt.id)
            .eq('passed', true);

          // Count flags on articles scored with this prompt version
          // JOIN feed_flags via feed_articles using !inner
          const flags = await sb(
            supabase
              .from('feed_flags')
              .select(
                'id, flag_type, feed_articles!inner(workspace_id, prompt_version_id)',
              )
              .eq('feed_articles.workspace_id', id)
              .eq('feed_articles.prompt_version_id', prompt.id),
            'feed_flags.byPromptVersion',
          );
          const fpFlags = flags.filter(
            (f: Record<string, unknown>) => f.flag_type === 'false_positive',
          ).length;
          const fnFlags = flags.filter(
            (f: Record<string, unknown>) => f.flag_type === 'false_negative',
          ).length;
          const totalFlags = flags.length;

          const articlesScored = totalArticles ?? 0;
          const articlesPassed = passedArticles ?? 0;

          return {
            version: prompt.version,
            prompt_id: prompt.id,
            is_active: prompt.is_active,
            change_notes: prompt.change_notes,
            created_at: prompt.created_at,
            articles_scored: articlesScored,
            articles_passed: articlesPassed,
            pass_rate:
              articlesScored > 0
                ? Math.round((articlesPassed / articlesScored) * 100)
                : 0,
            false_positive_flags: fpFlags,
            false_negative_flags: fnFlags,
            total_flags: totalFlags,
            flag_rate:
              articlesScored > 0
                ? Math.round((totalFlags / articlesScored) * 100)
                : 0,
          };
        }),
      );

      return NextResponse.json(results);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch prompt performance') },
        { status: 500 },
      );
    }
  },
);
