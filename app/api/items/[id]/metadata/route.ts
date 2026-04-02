import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ItemMetadataUpdateSchema } from '@/lib/validation/schemas';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 30;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;
    const { id } = await params;

    const body = await request.json();
    const parsed = parseBody(ItemMetadataUpdateSchema, body);
    if (!parsed.success) return parsed.response;

    // Build metadata to merge — strip undefined values, keep nulls for deletion
    // Promoted fields (layer) go to columns, not JSONB
    const newMetadata: Record<string, unknown> = {};
    const columnUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        if (key === 'layer') {
          columnUpdates.layer = value;
        } else {
          newMetadata[key] = value;
        }
      }
    }

    // Merge remaining JSONB metadata (excludes promoted fields)
    if (Object.keys(newMetadata).length > 0) {
      const { error: mergeError } = await supabase.rpc('merge_item_metadata', {
        p_item_id: id,
        p_new_data: newMetadata as unknown as Json,
      });

      if (mergeError) {
        const isNotFound =
          mergeError.message?.includes('not found') ||
          mergeError.code === 'PGRST116';
        if (isNotFound) {
          return NextResponse.json(
            { error: 'Item not found' },
            { status: 404 },
          );
        }
        return NextResponse.json(
          { error: safeErrorMessage(mergeError, 'Failed to update metadata') },
          { status: 500 },
        );
      }
    }

    // Update promoted column fields directly
    if (Object.keys(columnUpdates).length > 0) {
      await supabase.from('content_items').update(columnUpdates).eq('id', id);
    }

    // Fetch updated metadata to return
    const { data: updated } = await supabase
      .from('content_items')
      .select('metadata, layer')
      .eq('id', id)
      .single();

    return NextResponse.json({
      metadata: updated?.metadata ?? {},
      layer: (updated as Record<string, unknown> | null)?.layer ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update metadata') },
      { status: 500 },
    );
  }
}
