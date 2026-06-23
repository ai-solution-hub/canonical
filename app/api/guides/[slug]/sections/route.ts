import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import {
  buildGuideSectionSchema,
  guideSectionsReorderSchema,
} from '@/lib/validation/guide-schemas';
import { fetchActiveLayerKeys } from '@/lib/validation/layer-schemas';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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
    logger.error({ err: error }, 'resolveGuideId failed');
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

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
  ) => {
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

      const guideResult = await resolveGuideId(supabase, slug);
      if (!guideResult.ok) return guideResolutionResponse(guideResult);
      const guide = { id: guideResult.id };

      const { data, error } = await supabase
        .from('guide_sections')
        .select('*')
        .eq('guide_id', guide.id)
        .order('display_order');

      if (error) {
        logger.error({ err: error }, 'Failed to fetch guide sections');
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
  },
);

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
  ) => {
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

      let layerKeys: string[];
      try {
        layerKeys = await fetchActiveLayerKeys(supabase);
      } catch (err) {
        return NextResponse.json(
          {
            error: 'Layer vocabulary unavailable',
            detail: safeErrorMessage(err, 'Layer vocabulary unavailable'),
          },
          { status: 503 },
        );
      }
      const schema = buildGuideSectionSchema(layerKeys);

      const raw = await request.json();
      const parsed = parseBody(schema, raw);
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
        logger.error({ err: error }, 'Failed to create guide section');
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
  },
);

export const PUT = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
  ) => {
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

      const rl = checkRateLimit(
        `guide-sections-reorder:${user.id}`,
        20,
        60_000,
      );
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
        logger.error({ err: failed.error }, 'Failed to reorder guide sections');
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
  },
);
