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
    if (!rl.allowed) return rateLimitResponse();

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
