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
    const newMetadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        newMetadata[key] = value;
      }
    }

    // Use atomic merge RPC to avoid read-modify-write race conditions
    const { error: mergeError } = await supabase.rpc('merge_item_metadata', {
      p_item_id: id,
      p_new_data: newMetadata as unknown as Json,
    });

    if (mergeError) {
      // RPC returns error if item not found (no rows updated)
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

    // Also update the dedicated layer column (Phase 2 dual-write)
    if ('layer' in newMetadata) {
      await supabase
        .from('content_items')
        .update({ layer: newMetadata.layer as string | null } as Record<string, unknown>)
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
