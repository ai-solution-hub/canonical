import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse, getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { guideSectionSchema, guideSectionsReorderSchema } from '@/lib/validation/guide-schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { rateLimitResponse } from '@/lib/auth';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

export const maxDuration = 30;

const SLUG_RE = /^[a-z0-9-]+$/;

/** Resolve guide slug to guide ID */
async function resolveGuideId(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('guides')
    .select('id')
    .eq('slug', slug)
    .single();
  return data;
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

    const guide = await resolveGuideId(supabase, slug);
    if (!guide) {
      return NextResponse.json(
        { error: 'Guide not found' },
        { status: 404 },
      );
    }

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
    if (!rl.allowed) return rateLimitResponse();

    const guide = await resolveGuideId(supabase, slug);
    if (!guide) {
      return NextResponse.json(
        { error: 'Guide not found' },
        { status: 404 },
      );
    }

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
    if (!rl.allowed) return rateLimitResponse();

    const guide = await resolveGuideId(supabase, slug);
    if (!guide) {
      return NextResponse.json(
        { error: 'Guide not found' },
        { status: 404 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(guideSectionsReorderSchema, raw);
    if (!parsed.success) return parsed.response;

    // Update each section's display_order
    const updates = parsed.data.sections.map((section) =>
      supabase
        .from('guide_sections')
        .update({ display_order: section.display_order, updated_at: new Date().toISOString() })
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
