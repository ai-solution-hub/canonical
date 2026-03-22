import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse, getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { guideCreateSchema } from '@/lib/validation/guide-schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { rateLimitResponse } from '@/lib/auth';

export const maxDuration = 30;

/** GET /api/guides — list guides (published only for non-admins) */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const typeFilter = request.nextUrl.searchParams.get('type');
    const includeUnpublished = request.nextUrl.searchParams.get('include_unpublished') === 'true';

    let query = supabase
      .from('guides')
      .select('id, slug, name, description, guide_type, domain_filter, icon, color, display_order, is_published, created_by, created_at, updated_at')
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
      console.error('Failed to fetch guides:', error);
      return NextResponse.json(
        { error: 'Failed to fetch guides' },
        { status: 500 },
      );
    }

    // When ?include=stats, enrich each guide with section/content counts
    const includeStats = request.nextUrl.searchParams.get('include') === 'stats';
    if (includeStats && data && data.length > 0) {
      const guideIds = data.map((g) => g.id);
      const { data: sections, error: secErr } = await supabase
        .from('guide_sections')
        .select('guide_id, id, is_required, subtopic_filter')
        .in('guide_id', guideIds);

      if (!secErr && sections) {
        // Group sections by guide
        const sectionsByGuide = new Map<string, typeof sections>();
        for (const sec of sections) {
          const arr = sectionsByGuide.get(sec.guide_id) ?? [];
          arr.push(sec);
          sectionsByGuide.set(sec.guide_id, arr);
        }

        // Build stats per guide
        const statsMap = new Map<string, {
          total_sections: number;
          populated_sections: number;
          required_sections: number;
          populated_required: number;
        }>();

        for (const guide of data) {
          const guideSections = sectionsByGuide.get(guide.id) ?? [];
          const total = guideSections.length;
          const required = guideSections.filter((s) => s.is_required).length;
          let populated = 0;
          let populatedRequired = 0;

          if (total > 0 && guide.domain_filter) {
            const subtopicFilters = guideSections
              .map((s) => s.subtopic_filter)
              .filter(Boolean) as string[];

            if (subtopicFilters.length > 0) {
              const { data: contentCounts } = await supabase
                .from('content_items')
                .select('primary_subtopic')
                .eq('primary_domain', guide.domain_filter)
                .in('primary_subtopic', subtopicFilters);

              const populatedSubtopics = new Set(
                (contentCounts ?? []).map((c) => c.primary_subtopic),
              );

              for (const sec of guideSections) {
                if (sec.subtopic_filter && populatedSubtopics.has(sec.subtopic_filter)) {
                  populated++;
                  if (sec.is_required) populatedRequired++;
                }
              }
            }
          }

          statsMap.set(guide.id, {
            total_sections: total,
            populated_sections: populated,
            required_sections: required,
            populated_required: populatedRequired,
          });
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
}

/** POST /api/guides — create a guide */
export async function POST(request: NextRequest) {
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
      console.error('Failed to create guide:', error);
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
}
