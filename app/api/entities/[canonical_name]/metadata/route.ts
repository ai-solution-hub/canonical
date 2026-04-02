import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { EntityMetadataUpdateSchema } from '@/lib/validation/schemas';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 30;

/**
 * PATCH /api/entities/[canonical_name]/metadata — update entity metadata.
 *
 * Updates the metadata JSONB column on the first entity_mentions row
 * matching the given canonical_name. This stores certification-level
 * properties (version, issuing_body, expiry_date, scope, etc.) that
 * are entity-level rather than mention-level.
 *
 * Auth: editor or admin.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ canonical_name: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['editor', 'admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { canonical_name } = await params;
    const decodedName = decodeURIComponent(canonical_name);

    if (!decodedName || decodedName.trim().length === 0) {
      return NextResponse.json(
        { error: 'canonical_name is required' },
        { status: 400 },
      );
    }

    // Parse and validate request body
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = parseBody(EntityMetadataUpdateSchema, raw);
    if (!parsed.success) return parsed.response;
    const metadata = parsed.data;

    // Find the first entity_mentions row for this canonical name
    const { data: existing, error: findError } = await supabase
      .from('entity_mentions')
      .select('id, metadata')
      .eq('canonical_name', decodedName)
      .limit(1)
      .single();

    if (findError || !existing) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    // Merge new metadata with existing (shallow merge — new keys override)
    const currentMetadata =
      (existing.metadata as Record<string, unknown>) ?? {};
    const mergedMetadata = { ...currentMetadata, ...metadata };

    // Update the row
    const { data: updated, error: updateError } = await supabase
      .from('entity_mentions')
      .update({ metadata: mergedMetadata as Json })
      .eq('id', existing.id)
      .select('id, canonical_name, entity_type, metadata')
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: safeErrorMessage(updateError, 'Failed to update metadata') },
        { status: 500 },
      );
    }

    // Reverse bridge: propagate expiry_date to linked content items
    // Only for entity types where expiry dates are entity-level (cert, reg, standard)
    const entityExpiry = mergedMetadata.expiry_date as string | undefined;
    if (entityExpiry !== undefined) {
      try {
        const { data: entityInfo } = await supabase
          .from('entity_mentions')
          .select('entity_type, content_item_id')
          .eq('canonical_name', decodedName);

        if (entityInfo && entityInfo.length > 0) {
          const entityType = entityInfo[0].entity_type;
          const propagateTypes = ['certification', 'regulation', 'standard'];

          if (propagateTypes.includes(entityType)) {
            const contentIds = [
              ...new Set(
                entityInfo
                  .map((e) => e.content_item_id)
                  .filter(Boolean) as string[],
              ),
            ];

            if (contentIds.length > 0) {
              const updatePayload: Record<string, unknown> = {
                expiry_date: entityExpiry || null,
              };
              if (entityExpiry) {
                updatePayload.lifecycle_type = 'date_bound';
              }
              await supabase
                .from('content_items')
                .update(updatePayload)
                .in('id', contentIds);
            }
          }
        }
      } catch (bridgeErr) {
        console.error('Reverse bridge propagation failed:', bridgeErr);
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update entity metadata') },
      { status: 500 },
    );
  }
}
