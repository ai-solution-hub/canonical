import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  MutationResultSchema,
  TagDeleteBodySchema,
  TagFilteredParamsSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`tags:list:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    const params = request.nextUrl.searchParams;
    const hasFilterParams =
      params.has('type') ||
      params.has('min_count') ||
      params.has('search') ||
      params.has('limit') ||
      params.has('offset');

    if (hasFilterParams) {
      // Filtered/paginated path
      const parsed = parseSearchParams(TagFilteredParamsSchema, params);
      if (!parsed.success) return parsed.response;

      const { type, min_count, search, limit, offset } = parsed.data;

      // If type is specified, call the filtered RPC for that type
      // If no type, call for both and combine
      if (type) {
        const { data, error } = await supabase.rpc('get_tag_counts_filtered', {
          p_type: type,
          p_min_count: min_count ?? 1,
          p_search: search,
          p_limit: limit ?? 50,
          p_offset: offset ?? 0,
        });

        if (error) {
          return NextResponse.json(
            { error: safeErrorMessage(error, 'Failed to fetch tag counts') },
            { status: 500 },
          );
        }

        const rows = data ?? [];
        const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

        return NextResponse.json({
          tags: rows.map(
            (r: { tag: string; count: number; source: string }) => ({
              tag: r.tag,
              count: Number(r.count),
              source: r.source,
            }),
          ),
          total: totalCount,
        });
      }

      // No type specified — fetch both AI and user tags
      const [aiResult, userResult] = await Promise.all([
        supabase.rpc('get_tag_counts_filtered', {
          p_type: 'ai',
          p_min_count: min_count ?? 1,
          p_search: search,
          p_limit: limit ?? 50,
          p_offset: offset ?? 0,
        }),
        supabase.rpc('get_tag_counts_filtered', {
          p_type: 'user',
          p_min_count: min_count ?? 1,
          p_search: search,
          p_limit: limit ?? 50,
          p_offset: offset ?? 0,
        }),
      ]);

      if (aiResult.error) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              aiResult.error,
              'Failed to fetch tag counts',
            ),
          },
          { status: 500 },
        );
      }
      if (userResult.error) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              userResult.error,
              'Failed to fetch tag counts',
            ),
          },
          { status: 500 },
        );
      }

      const aiRows = aiResult.data ?? [];
      const userRows = userResult.data ?? [];
      const combined = [...aiRows, ...userRows]
        .map((r: { tag: string; count: number; source: string }) => ({
          tag: r.tag,
          count: Number(r.count),
          source: r.source,
        }))
        .sort((a, b) => b.count - a.count);

      const aiTotal = aiRows.length > 0 ? Number(aiRows[0].total_count) : 0;
      const userTotal =
        userRows.length > 0 ? Number(userRows[0].total_count) : 0;

      return NextResponse.json({
        tags: combined,
        total: aiTotal + userTotal,
      });
    }

    // Legacy path: return all tag counts (no filtering)
    const { data, error } = await supabase.rpc('get_all_tag_counts');

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch tag counts') },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch tag counts') },
      { status: 500 },
    );
  }
});

export const DELETE = defineRoute(
  MutationResultSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { allowed } = checkRateLimit(`tags:delete:${user.id}`, 10, 60_000);
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(TagDeleteBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { tag, type } = parsed.data;

      const { data, error } = await supabase.rpc('delete_tag', {
        p_tag: tag,
        p_type: type,
      });

      if (error) {
        return NextResponse.json(
          { error: safeErrorMessage(error, 'Failed to delete tag') },
          { status: 500 },
        );
      }

      return NextResponse.json({ affected: data ?? 0 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete tag') },
        { status: 500 },
      );
    }
  },
);
