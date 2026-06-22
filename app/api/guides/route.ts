import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody, parseSearchParams } from '@/lib/validation';
import { guideCreateSchema } from '@/lib/validation/guide-schemas';
import { GuideListParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

/** Row shape returned by the get_guide_coverage() RPC */
interface GuideSectionRow {
  guide_id: string;
  guide_name: string;
  guide_slug: string;
  guide_type: string;
  domain_filter: string;
  section_id: string;
  section_name: string;
  section_order: number;
  expected_layer: string | null;
  is_required: boolean;
  content_count: number;
  fresh_count: number;
  stale_count: number;
}

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      GuideListParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const {
      type: typeFilter,
      include_unpublished: includeUnpublished,
      include,
    } = parsed.data;

    let query = supabase
      .from('guides')
      .select(
        'id, slug, name, description, guide_type, domain_filter, icon, color, display_order, is_published, created_by, created_at, updated_at',
      )
      .order('display_order')
      .order('name');

    if (typeFilter) {
      query = query.eq('guide_type', typeFilter);
    }

    // RLS handles published/unpublished visibility based on role
    // but if the caller explicitly wants only published, filter here
    if (!includeUnpublished) {
      query = query.eq('is_published', true);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ err: error }, 'Failed to fetch guides');
      return NextResponse.json(
        { error: 'Failed to fetch guides' },
        { status: 500 },
      );
    }

    // When ?include=stats, enrich each guide with section/content counts
    // Uses the same get_guide_coverage() RPC as the coverage page to ensure
    // consistent stats (the previous manual calculation always returned zeros
    // because all seeded sections have subtopic_filter = NULL).
    const includeStats = include === 'stats';
    if (includeStats && data && data.length > 0) {
      const { data: coverageRows, error: covErr } =
        await supabase.rpc('get_guide_coverage');

      if (!covErr && coverageRows) {
        const statsMap = new Map<
          string,
          {
            total_sections: number;
            populated_sections: number;
            required_sections: number;
            populated_required: number;
          }
        >();

        for (const row of coverageRows as unknown as GuideSectionRow[]) {
          const existing = statsMap.get(row.guide_id) ?? {
            total_sections: 0,
            populated_sections: 0,
            required_sections: 0,
            populated_required: 0,
          };

          existing.total_sections += 1;
          if (row.content_count > 0) existing.populated_sections += 1;
          if (row.is_required) existing.required_sections += 1;
          if (row.is_required && row.content_count > 0)
            existing.populated_required += 1;

          statsMap.set(row.guide_id, existing);
        }

        const enriched = data.map((guide) => ({
          ...guide,
          stats: statsMap.get(guide.id) ?? {
            total_sections: 0,
            populated_sections: 0,
            required_sections: 0,
            populated_required: 0,
          },
        }));

        return NextResponse.json(enriched);
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch guides') },
      { status: 500 },
    );
  }
});

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const rl = checkRateLimit(`guides-create:${user.id}`, 20, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(guideCreateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { data, error } = await supabase
      .from('guides')
      .insert({
        ...parsed.data,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A guide with slug "${parsed.data.slug}" already exists` },
          { status: 409 },
        );
      }
      logger.error({ err: error }, 'Failed to create guide');
      return NextResponse.json(
        { error: 'Failed to create guide' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create guide') },
      { status: 500 },
    );
  }
});
