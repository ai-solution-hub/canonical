import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { enqueueTaxonomySync } from '@/lib/taxonomy/sync-trigger';
import { parseBody } from '@/lib/validation';
import { LayerReorderSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * PUT /api/layers/reorder
 *
 * Batch update display_order for multiple layers. Admin-only.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(LayerReorderSchema, raw);
    if (!parsed.success) return parsed.response;

    const { layers } = parsed.data;
    const now = new Date().toISOString();

    // Update each layer's display_order
    const results = await Promise.all(
      layers.map(({ id, display_order }) =>
        supabase
          .from('layer_vocabulary')
          .update({ display_order, updated_at: now })
          .eq('id', id),
      ),
    );

    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Some layers failed to reorder' },
        { status: 500 },
      );
    }

    enqueueTaxonomySync();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to reorder layers') },
      { status: 500 },
    );
  }
}
