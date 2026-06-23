import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { sb } from '@/lib/supabase/safe';
import { enqueueTaxonomySync } from '@/lib/taxonomy/sync-trigger';
import { parseBody } from '@/lib/validation';
import { LayerCreateSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const LayerRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  display_order: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

const LayersGetResponseSchema = z.array(LayerRowSchema);

export const GET = defineRoute(LayersGetResponseSchema, async () => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('layer_vocabulary')
      .select(
        'id, key, label, description, display_order, is_active, created_at, updated_at',
      )
      .order('display_order', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch layers' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch layers') },
      { status: 500 },
    );
  }
});

// POST returns the inserted layer row (same shape as the GET list element).
export const POST = defineRoute(
  LayerRowSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const raw = await request.json();
      const parsed = parseBody(LayerCreateSchema, raw);
      if (!parsed.success) return parsed.response;

      const { key, label, description, display_order } = parsed.data;

      // Auto-assign display_order if not provided
      let order = display_order;
      if (order === undefined) {
        const maxRow = await sb(
          supabase
            .from('layer_vocabulary')
            .select('display_order')
            .order('display_order', { ascending: false })
            .limit(1)
            .maybeSingle(),
          'layer_vocabulary.maxDisplayOrder',
        );
        order = (maxRow?.display_order ?? 0) + 10;
      }

      const { data, error } = await supabase
        .from('layer_vocabulary')
        .insert({
          key,
          label,
          description: description ?? null,
          display_order: order,
          is_active: true,
        })
        .select(
          'id, key, label, description, display_order, is_active, created_at, updated_at',
        )
        .single();

      if (error) {
        // Check for unique constraint violation on key
        if (error.code === '23505') {
          return NextResponse.json(
            { error: `A layer with key '${key}' already exists` },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: 'Failed to create layer' },
          { status: 500 },
        );
      }

      enqueueTaxonomySync();
      return NextResponse.json(data, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create layer') },
        { status: 500 },
      );
    }
  },
);
