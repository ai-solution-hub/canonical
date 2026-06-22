import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { buildGuideSectionUpdateSchema } from '@/lib/validation/guide-schemas';
import { fetchActiveLayerKeys } from '@/lib/validation/layer-schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]+$/;

// TODO(OPS-T1): author ResponseSchema
export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ slug: string; sectionId: string }> },
  ) => {
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
      const schema = buildGuideSectionUpdateSchema(layerKeys);

      const raw = await request.json();
      const parsed = parseBody(schema, raw);
      if (!parsed.success) return parsed.response;

      // Verify section belongs to the correct guide
      const { data: guide, error: guideError } = await supabase
        .from('guides')
        .select('id')
        .eq('slug', slug)
        .single();

      if (guideError) {
        if (guideError.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Guide not found' },
            { status: 404 },
          );
        }
        logger.error({ err: guideError }, 'Guide lookup failed');
        return NextResponse.json(
          { error: 'Failed to resolve guide', details: guideError.message },
          { status: 500 },
        );
      }
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
        logger.error({ err: error }, 'Failed to update guide section');
        return NextResponse.json(
          { error: 'Failed to update guide section' },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Section not found' },
          { status: 404 },
        );
      }

      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update guide section') },
        { status: 500 },
      );
    }
  },
);

// TODO(OPS-T1): author ResponseSchema
export const DELETE = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ slug: string; sectionId: string }> },
  ) => {
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
      const { data: guide, error: guideError } = await supabase
        .from('guides')
        .select('id')
        .eq('slug', slug)
        .single();

      if (guideError) {
        if (guideError.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Guide not found' },
            { status: 404 },
          );
        }
        logger.error({ err: guideError }, 'Guide lookup failed');
        return NextResponse.json(
          { error: 'Failed to resolve guide', details: guideError.message },
          { status: 500 },
        );
      }
      if (!guide) {
        return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
      }

      const { error } = await supabase
        .from('guide_sections')
        .delete()
        .eq('id', sectionId)
        .eq('guide_id', guide.id);

      if (error) {
        logger.error({ err: error }, 'Failed to delete guide section');
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
  },
);
