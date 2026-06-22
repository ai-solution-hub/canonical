import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { fetchActiveLayerKeys } from '@/lib/validation/layer-schemas';
import { buildItemMetadataUpdateSchema } from '@/lib/validation/schemas';
import type { Database, Json } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type ContentItemUpdate =
  Database['public']['Tables']['content_items']['Update'];

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;
      const { id } = await params;

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
      const schema = buildItemMetadataUpdateSchema(layerKeys);

      const body = await request.json();
      const parsed = parseBody(schema, body);
      if (!parsed.success) return parsed.response;

      // Build metadata to merge — strip undefined values, keep nulls for deletion
      // Promoted fields (layer) go to columns, not JSONB
      const newMetadata: Record<string, unknown> = {};
      const columnUpdates: ContentItemUpdate = {};
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
        const { error: mergeError } = await supabase.rpc(
          'merge_item_metadata',
          {
            p_item_id: id,
            p_new_data: newMetadata as unknown as Json,
          },
        );

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
            {
              error: safeErrorMessage(mergeError, 'Failed to update metadata'),
            },
            { status: 500 },
          );
        }
      }

      // Update promoted column fields directly
      if (Object.keys(columnUpdates).length > 0) {
        const { error: columnError } = await supabase
          .from('content_items')
          .update(columnUpdates)
          .eq('id', id);

        if (columnError) {
          logger.error(
            { err: columnError },
            'Failed to update promoted metadata columns',
          );
          return NextResponse.json(
            {
              error: safeErrorMessage(
                columnError,
                'Failed to update metadata columns',
              ),
            },
            { status: 500 },
          );
        }
      }

      // Fetch updated metadata to return. If this re-fetch errors we cannot
      // safely echo the saved state — returning `{ metadata: {}, layer: null }`
      // would mislead the client into thinking the user just cleared all
      // metadata. The mutation already succeeded, so return a minimal success
      // response with a warning rather than failing the request.
      const { data: updated, error: fetchError } = await supabase
        .from('content_items')
        .select('metadata, layer')
        .eq('id', id)
        .single();

      if (fetchError) {
        logger.error(
          { err: fetchError },
          'Failed to re-fetch item metadata after update',
        );
        return NextResponse.json({
          success: true,
          warnings: [
            'Metadata saved, but the fresh values could not be re-fetched. Reload to see the latest state.',
          ],
        });
      }

      return NextResponse.json({
        metadata: updated?.metadata ?? {},
        layer: updated?.layer ?? null,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update metadata') },
        { status: 500 },
      );
    }
  },
);
