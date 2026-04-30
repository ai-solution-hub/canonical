import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { guideUpdateSchema } from '@/lib/validation/guide-schemas';
import { checkRateLimit } from '@/lib/rate-limit';
import { rateLimitResponse } from '@/lib/auth';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

const SLUG_RE = /^[a-z0-9-]+$/;

/** GET /api/guides/[slug] — get guide with content via RPC */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { slug } = await params;
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid guide slug' },
        { status: 400 },
      );
    }

    // Fetch guide metadata
    const { data: guide, error: guideError } = await supabase
      .from('guides')
      .select(
        'id, slug, name, description, guide_type, domain_filter, icon, color, display_order, is_published, created_by, created_at, updated_at',
      )
      .eq('slug', slug)
      .single();

    if (guideError || !guide) {
      if (guideError?.code === 'PGRST116') {
        return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
      }
      logger.error({ err: guideError }, 'Failed to fetch guide');
      return NextResponse.json(
        { error: 'Failed to fetch guide' },
        { status: 500 },
      );
    }

    // Fetch guide content via RPC
    const { data: rows, error: rpcError } = await supabase.rpc(
      'get_guide_content',
      { p_guide_slug: slug },
    );

    if (rpcError) {
      logger.error({ err: rpcError }, 'Failed to fetch guide content');
      return NextResponse.json(
        { error: 'Failed to fetch guide content' },
        { status: 500 },
      );
    }

    // Group results by section_id
    const sectionsMap = new Map<
      string,
      {
        section_id: string;
        section_name: string;
        section_description: string | null;
        section_order: number;
        expected_layer: string | null;
        subtopic_filter: string | null;
        is_required: boolean;
        content_items: Array<{
          content_id: string;
          content_title: string;
          content_type: string;
          content_layer: string | null;
          content_brief: string | null;
          content_freshness: string | null;
          content_verified_at: string | null;
          content_captured_date: string | null;
        }>;
      }
    >();

    for (const row of rows ?? []) {
      if (!sectionsMap.has(row.section_id)) {
        sectionsMap.set(row.section_id, {
          section_id: row.section_id,
          section_name: row.section_name,
          section_description: row.section_description,
          section_order: row.section_order,
          expected_layer: row.expected_layer,
          subtopic_filter: row.subtopic_filter,
          is_required: row.is_required,
          content_items: [],
        });
      }

      // Only add content items if there is one (LEFT JOIN may produce NULLs)
      if (row.content_id) {
        sectionsMap.get(row.section_id)!.content_items.push({
          content_id: row.content_id,
          content_title: row.content_title,
          content_type: row.content_type,
          content_layer: row.content_layer,
          content_brief: row.content_brief,
          content_freshness: row.content_freshness,
          content_verified_at: row.content_verified_at,
          content_captured_date: row.content_captured_date,
        });
      }
    }

    // Sort sections by display order
    const sections = Array.from(sectionsMap.values()).sort(
      (a, b) => a.section_order - b.section_order,
    );

    return NextResponse.json({ guide, sections });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch guide') },
      { status: 500 },
    );
  }
}

/** PATCH /api/guides/[slug] — update a guide */
export async function PATCH(
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

    const rl = checkRateLimit(`guides-update:${user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(guideUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const updates = { ...parsed.data, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('guides')
      .update(updates)
      .eq('slug', slug)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A guide with that slug already exists' },
          { status: 409 },
        );
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
      }
      logger.error({ err: error }, 'Failed to update guide');
      return NextResponse.json(
        { error: 'Failed to update guide' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update guide') },
      { status: 500 },
    );
  }
}

/** DELETE /api/guides/[slug] — delete a guide (admin only) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { slug } = await params;
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid guide slug' },
        { status: 400 },
      );
    }

    const { error } = await supabase.from('guides').delete().eq('slug', slug);

    if (error) {
      logger.error({ err: error }, 'Failed to delete guide');
      return NextResponse.json(
        { error: 'Failed to delete guide' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete guide') },
      { status: 500 },
    );
  }
}
