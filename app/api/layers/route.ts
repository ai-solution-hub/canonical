import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { enqueueTaxonomySync } from '@/lib/taxonomy/sync-trigger';
import { parseBody } from '@/lib/validation';
import { LayerCreateSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/layers
 *
 * List all layers including inactive (admin-only).
 * Used by the admin UI to manage layer vocabulary.
 */
export async function GET() {
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
}

/**
 * POST /api/layers
 *
 * Create a new layer. Admin-only.
 */
export async function POST(request: NextRequest) {
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
}
