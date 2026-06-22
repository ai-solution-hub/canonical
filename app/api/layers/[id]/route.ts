import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { enqueueTaxonomySync } from '@/lib/taxonomy/sync-trigger';
import { parseBody } from '@/lib/validation';
import { LayerUpdateSchema } from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';

type LayerVocabularyUpdate =
  Database['public']['Tables']['layer_vocabulary']['Update'];

export const maxDuration = 30;

/**
 * PATCH /api/layers/:id
 *
 * Update an existing layer. Admin-only.
 * The `key` field is not updatable (would break existing content).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;
    const { id } = await params;

    const raw = await request.json();
    const parsed = parseBody(LayerUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const updates: LayerVocabularyUpdate = {};
    if (parsed.data.label !== undefined) updates.label = parsed.data.label;
    if (parsed.data.description !== undefined)
      updates.description = parsed.data.description;
    if (parsed.data.display_order !== undefined)
      updates.display_order = parsed.data.display_order;
    if (parsed.data.is_active !== undefined)
      updates.is_active = parsed.data.is_active;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('layer_vocabulary')
      .update(updates)
      .eq('id', id)
      .select(
        'id, key, label, description, display_order, is_active, created_at, updated_at',
      )
      .single();

    if (error) {
      // PGRST116 = no rows found
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to update layer') },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
    }

    enqueueTaxonomySync();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update layer') },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/layers/:id
 *
 * Delete a layer. Admin-only.
 * Guarded: rejects if any content_items have this layer assigned.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;
    const { id } = await params;

    // First, look up the layer key
    const { data: layer, error: lookupError } = await supabase
      .from('layer_vocabulary')
      .select('key')
      .eq('id', id)
      .single();

    if (lookupError || !layer) {
      return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
    }

    // Check if any content items use this layer key
    const { count, error: countError } = await supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('layer', layer.key);

    if (countError) {
      return NextResponse.json(
        { error: 'Failed to check layer usage' },
        { status: 500 },
      );
    }

    if (count && count > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete layer '${layer.key}' -- ${count} content item${count === 1 ? ' is' : 's are'} assigned to it. Deactivate instead.`,
          count,
        },
        { status: 409 },
      );
    }

    // Safe to delete
    const { error: deleteError } = await supabase
      .from('layer_vocabulary')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json(
        { error: safeErrorMessage(deleteError, 'Failed to delete layer') },
        { status: 500 },
      );
    }

    enqueueTaxonomySync();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete layer') },
      { status: 500 },
    );
  }
}
