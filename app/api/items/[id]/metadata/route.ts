import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { z } from 'zod';
import { FALLBACK_LAYERS } from '@/lib/client-config';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 30;

const layerValues = FALLBACK_LAYERS.map((l) => l.key);

const MetadataUpdateSchema = z
  .object({
    layer: z
      .enum(layerValues as [string, ...string[]])
      .nullable()
      .optional(),
    topic_id: z.string().max(200).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one metadata field required',
  });

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
    const parsed = MetadataUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid metadata' },
        { status: 400 },
      );
    }

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
      await supabase
        .from('content_items')
        .update(columnUpdates)
        .eq('id', id);
    }

    // Fetch updated metadata to return
    const { data: updated } = await supabase
      .from('content_items')
      .select('metadata, layer')
      .eq('id', id)
      .single();

    return NextResponse.json({ metadata: updated?.metadata ?? {}, layer: (updated as Record<string, unknown> | null)?.layer ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update metadata') },
      { status: 500 },
    );
  }
}
