// app/api/intelligence/workspaces/[id]/flags/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Query params for GET /api/intelligence/workspaces/:id/flags.
 *
 * - `resolved` defaults to `false` (only unresolved flags)
 * - `flag_type` is optional; filters by false_positive / false_negative
 */
const FlagListParamsSchema = z.object({
  resolved: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),
  flag_type: z.enum(['false_positive', 'false_negative']).optional(),
});

/**
 * Shape returned to the client for each flag.
 * Flattens the joined feed_articles / feed_sources context so the UI
 * does not need to walk nested objects.
 */
export interface WorkspaceFlagRow {
  id: string;
  feed_article_id: string;
  flag_type: string;
  flagged_by: string;
  notes: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_notes: string | null;
  resolution_type: string | null;
  prompt_version_id: string | null;
  created_at: string;
  // Joined context
  article_title: string | null;
  article_external_url: string | null;
  article_relevance_score: number | null;
  article_relevance_reasoning: string | null;
  article_relevance_category: string | null;
  article_passed: boolean | null;
  source_name: string | null;
}

/**
 * GET /api/intelligence/workspaces/:id/flags
 *
 * Lists flags for a workspace, joined with article + source context.
 * Default: only unresolved flags. Supports `?resolved=true` and
 * `?flag_type=false_positive|false_negative`.
 *
 * Auth: admin + editor.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      FlagListParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    const { resolved, flag_type: flagType } = parsed.data;

    // Nested select: feed_flags → feed_articles (inner join) → feed_sources.
    // The inner join on feed_articles allows filtering by
    // feed_articles.workspace_id at the PostgREST level.
    let query = supabase
      .from('feed_flags')
      .select(
        `id, feed_article_id, flag_type, flagged_by, notes, resolved,
         resolved_at, resolved_by, resolved_notes, resolution_type,
         prompt_version_id, created_at,
         feed_articles!inner(
           workspace_id, title, external_url, relevance_score,
           relevance_reasoning, relevance_category, passed,
           feed_sources(name)
         )`,
      )
      .eq('feed_articles.workspace_id', id)
      .eq('resolved', resolved);

    if (flagType) {
      query = query.eq('flag_type', flagType);
    }

    query = query.order('created_at', { ascending: false });

    const rows = await sb(query, 'feed_flags.byWorkspace');

    // Flatten the joined shape for the client. Supabase returns nested
    // relations as objects when the FK is one-to-one (here both
    // feed_articles and feed_sources).
    const flags: WorkspaceFlagRow[] = (rows ?? []).map(
      (row: Record<string, unknown>) => {
        const article = row.feed_articles as
          | {
              title: string | null;
              external_url: string | null;
              relevance_score: number | null;
              relevance_reasoning: string | null;
              relevance_category: string | null;
              passed: boolean | null;
              feed_sources: { name: string | null } | null;
            }
          | null;
        const source = article?.feed_sources ?? null;

        return {
          id: row.id as string,
          feed_article_id: row.feed_article_id as string,
          flag_type: row.flag_type as string,
          flagged_by: row.flagged_by as string,
          notes: (row.notes as string | null) ?? null,
          resolved: row.resolved as boolean,
          resolved_at: (row.resolved_at as string | null) ?? null,
          resolved_by: (row.resolved_by as string | null) ?? null,
          resolved_notes: (row.resolved_notes as string | null) ?? null,
          resolution_type: (row.resolution_type as string | null) ?? null,
          prompt_version_id: (row.prompt_version_id as string | null) ?? null,
          created_at: row.created_at as string,
          article_title: article?.title ?? null,
          article_external_url: article?.external_url ?? null,
          article_relevance_score: article?.relevance_score ?? null,
          article_relevance_reasoning: article?.relevance_reasoning ?? null,
          article_relevance_category: article?.relevance_category ?? null,
          article_passed: article?.passed ?? null,
          source_name: source?.name ?? null,
        };
      },
    );

    return NextResponse.json(flags);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch workspace flags') },
      { status: 500 },
    );
  }
}
