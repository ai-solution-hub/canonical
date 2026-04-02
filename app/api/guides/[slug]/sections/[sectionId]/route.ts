import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { guideSectionUpdateSchema } from '@/lib/validation/guide-schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { rateLimitResponse } from '@/lib/auth';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]+$/;

/** PATCH /api/guides/[slug]/sections/[sectionId] — update a section */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; sectionId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { slug, sectionId } = await params;
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid guide slug' },
        { status: 400 },
      );
    }
    if (!UUID_RE.test(sectionId)) {
      return NextResponse.json(
        { error: 'Invalid section ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const rl = checkRateLimit(`guide-section-update:${user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(guideSectionUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    // Verify section belongs to the correct guide
    const { data: guide } = await supabase
      .from('guides')
      .select('id')
      .eq('slug', slug)
      .single();

    if (!guide) {
      return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
    }

    const updates = { ...parsed.data, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('guide_sections')
      .update(updates)
      .eq('id', sectionId)
      .eq('guide_id', guide.id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Section not found' },
          { status: 404 },
        );
      }
      console.error('Failed to update guide section:', error);
      return NextResponse.json(
        { error: 'Failed to update guide section' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update guide section') },
      { status: 500 },
    );
  }
}

/** DELETE /api/guides/[slug]/sections/[sectionId] — delete a section */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; sectionId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { slug, sectionId } = await params;
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid guide slug' },
        { status: 400 },
      );
    }
    if (!UUID_RE.test(sectionId)) {
      return NextResponse.json(
        { error: 'Invalid section ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Verify section belongs to the correct guide
    const { data: guide } = await supabase
      .from('guides')
      .select('id')
      .eq('slug', slug)
      .single();

    if (!guide) {
      return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('guide_sections')
      .delete()
      .eq('id', sectionId)
      .eq('guide_id', guide.id);

    if (error) {
      console.error('Failed to delete guide section:', error);
      return NextResponse.json(
        { error: 'Failed to delete guide section' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete guide section') },
      { status: 500 },
    );
  }
}
