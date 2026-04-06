import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  guideSectionSchema,
  guideSectionsReorderSchema,
} from '@/lib/validation/guide-schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { rateLimitResponse } from '@/lib/auth';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

export const maxDuration = 30;

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Resolve guide slug to guide ID.
 *
 * Distinguishes between "no row" (legitimate 404) and "DB error"
 * (5xx) so callers do not return a misleading "Guide not found" message
 * for transient database failures.
 */
async function resolveGuideId(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<
  | { ok: true; id: string }
  | { ok: false; status: 404 }
  | { ok: false; status: 500; error: string }
> {
  const { data, error } = await supabase
    .from('guides')
    .select('id')
    .eq('slug', slug)
    .single();

  if (error) {
    // PGRST116 is PostgREST's "no rows returned" — surface as 404.
    // Any other error is a genuine DB failure and must surface as 500
    // so callers can distinguish a missing guide from a transient glitch.
    if (error.code === 'PGRST116') {
      return { ok: false, status: 404 };
    }
    console.error('resolveGuideId failed:', error);
    return { ok: false, status: 500, error: error.message };
  }
  if (!data) return { ok: false, status: 404 };
  return { ok: true, id: data.id };
}

function guideResolutionResponse(
  result:
    | { ok: false; status: 404 }
    | { ok: false; status: 500; error: string },
): NextResponse {
  if (result.status === 404) {
    return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
  }
  return NextResponse.json(
    { error: 'Failed to resolve guide', details: result.error },
    { status: 500 },
  );
}

/** GET /api/guides/[slug]/sections — list sections for a guide */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { slug } = await params;
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid guide slug' },
        { status: 400 },
      );
    }

    const guideResult = await resolveGuideId(supabase, slug);
    if (!guideResult.ok) return guideResolutionResponse(guideResult);
    const guide = { id: guideResult.id };

    const { data, error } = await supabase
      .from('guide_sections')
      .select('*')
      .eq('guide_id', guide.id)
      .order('display_order');

    if (error) {
      console.error('Failed to fetch guide sections:', error);
      return NextResponse.json(
        { error: 'Failed to fetch guide sections' },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch guide sections') },
      { status: 500 },
    );
  }
}

/** POST /api/guides/[slug]/sections — create a section */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { slug } = await params;
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid guide slug' },
        { status: 400 },
      );
    }

    const rl = checkRateLimit(`guide-sections-create:${user.id}`, 50, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const guideResult = await resolveGuideId(supabase, slug);
    if (!guideResult.ok) return guideResolutionResponse(guideResult);
    const guide = { id: guideResult.id };

    const raw = await request.json();
    const parsed = parseBody(guideSectionSchema, raw);
    if (!parsed.success) return parsed.response;

    const { data, error } = await supabase
      .from('guide_sections')
      .insert({
        ...parsed.data,
        guide_id: guide.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create guide section:', error);
      return NextResponse.json(
        { error: 'Failed to create guide section' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create guide section') },
      { status: 500 },
    );
  }
}

/** PUT /api/guides/[slug]/sections — reorder sections */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { slug } = await params;
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid guide slug' },
        { status: 400 },
      );
    }

    const rl = checkRateLimit(`guide-sections-reorder:${user.id}`, 20, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const guideResult = await resolveGuideId(supabase, slug);
    if (!guideResult.ok) return guideResolutionResponse(guideResult);
    const guide = { id: guideResult.id };

    const raw = await request.json();
    const parsed = parseBody(guideSectionsReorderSchema, raw);
    if (!parsed.success) return parsed.response;

    // Update each section's display_order
    const updates = parsed.data.sections.map((section) =>
      supabase
        .from('guide_sections')
        .update({
          display_order: section.display_order,
          updated_at: new Date().toISOString(),
        })
        .eq('id', section.id)
        .eq('guide_id', guide.id),
    );

    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      console.error('Failed to reorder guide sections:', failed.error);
      return NextResponse.json(
        { error: 'Failed to reorder guide sections' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to reorder guide sections') },
      { status: 500 },
    );
  }
}
